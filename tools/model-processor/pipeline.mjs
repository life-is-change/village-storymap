import { readFile, writeFile, mkdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { NodeIO, Logger, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const defaults = { highRatio: 1, lowRatio: 0.35, highTextureSize: 2048, lowTextureSize: 512, error: 0.01 };

function optionsFor(options) {
  const settings = { ...defaults, ...options };
  for (const key of ['highRatio', 'lowRatio']) {
    if (!Number.isFinite(settings[key]) || settings[key] <= 0 || settings[key] > 1) {
      throw new Error(`${key}: ratio must be greater than 0 and at most 1.`);
    }
  }
  for (const key of ['highTextureSize', 'lowTextureSize']) {
    if (!Number.isInteger(settings[key]) || settings[key] < 16 || settings[key] > 16384) {
      throw new Error(`${key}: texture size must be an integer between 16 and 16384.`);
    }
  }
  if (!Number.isFinite(settings.error) || settings.error < 0 || settings.error > 1) {
    throw new Error('error must be between 0 and 1 (fraction of mesh radius).');
  }
  if (settings.lowRatio > settings.highRatio || settings.lowTextureSize > settings.highTextureSize) {
    throw new Error('Low variant ratio and texture size must not exceed high variant settings.');
  }
  return settings;
}

function triangles(primitive) {
  const count = (primitive.getIndices() || primitive.getAttribute('POSITION'))?.getCount() || 0;
  if (primitive.getMode() === Primitive.Mode.TRIANGLES) return Math.floor(count / 3);
  if ([Primitive.Mode.TRIANGLE_STRIP, Primitive.Mode.TRIANGLE_FAN].includes(primitive.getMode())) return Math.max(0, count - 2);
  return 0;
}

function inspectDocument(document) {
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const { min, max } = scene ? getBounds(scene) : { min: [], max: [] };
  if (min.length !== 3 || ![...min, ...max].every(Number.isFinite) || !primitives.length) {
    throw new Error('GLB must contain a scene with finite mesh bounds.');
  }
  return {
    bounds: { min, max, size: min.map((value, axis) => max[axis] - value) },
    triangleCount: primitives.reduce((sum, primitive) => sum + triangles(primitive), 0),
    primitiveCount: primitives.length,
    textureCount: root.listTextures().length,
    textures: root.listTextures().map((texture) => ({ name: texture.getName(), mimeType: texture.getMimeType(), size: texture.getSize() })),
  };
}

function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('Input must be a complete binary GLB version 2 file.');
  }
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > bytes.length) throw new Error('Invalid GLB JSON chunk.');
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
  const supported = new Set(ALL_EXTENSIONS.map((extension) => extension.EXTENSION_NAME));
  for (const extension of json.extensionsUsed || []) {
    if (!supported.has(extension)) throw new Error(`Unsupported extension ${extension}; original is unchanged.`);
  }
  if ((json.extensionsUsed || []).includes('KHR_draco_mesh_compression')) {
    throw new Error('Draco input requires decoding before this pipeline; original is unchanged.');
  }
  if ((json.buffers || []).some((buffer) => buffer.uri) || (json.images || []).some((image) => image.uri && !image.uri.startsWith('data:'))) {
    throw new Error('GLB must embed all buffers and textures; external resources are not read.');
  }
}

/** Writes a new output directory only. Original bytes are never modified. */
export async function processModel(options = {}) {
  const started = performance.now();
  const settings = optionsFor(options);
  if (!options.input || !options.output) throw new Error('Both input GLB file and output directory are required.');
  const input = await realpath(path.resolve(options.input));
  const output = path.resolve(options.output);
  const inputStat = await stat(input);
  if (!inputStat.isFile() || path.extname(input).toLowerCase() !== '.glb') throw new Error('Input must be a single GLB file.');
  if (input.toLowerCase() === output.toLowerCase()) throw new Error('Output must be a new directory, separate from input.');
  try {
    await stat(output);
    throw new Error('Output directory already exists; choose a new output directory to preserve existing files.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const original = await readFile(input);
  validateGlb(original);
  await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  // Decode first: shared normalization reads actual POSITION bytes, not compressed bounds.
  const decodedSource = await io.readBinary(original);
  decodedSource.setLogger(new Logger(Logger.Verbosity.ERROR));
  for (const extension of decodedSource.getRoot().listExtensionsUsed()) {
    if (['EXT_meshopt_compression', 'KHR_meshopt_compression'].includes(extension.extensionName)) extension.dispose();
  }
  const decodedBytes = await io.writeBinary(decodedSource);
  const normalizer = require('../../features/models/glb-normalization.js');
  const normalized = normalizer.normalizeGlb(decodedBytes.buffer.slice(decodedBytes.byteOffset, decodedBytes.byteOffset + decodedBytes.byteLength));
  if (!normalized?.buffer || !normalized.inspection?.normalized) throw new Error('Shared GLB normalizer did not return normalized model bytes.');
  const sourceDocument = await io.readBinary(new Uint8Array(normalized.buffer));
  const normalizedInspection = inspectDocument(sourceDocument);
  const variants = {};
  const pendingFiles = [];
  const warnings = [];
  for (const [name, ratio, textureMaxSize] of [['high', settings.highRatio, settings.highTextureSize], ['low', settings.lowRatio, settings.lowTextureSize]]) {
    // Read the same normalized source for each LOD: root scale and anchor never change.
    const document = await io.readBinary(new Uint8Array(normalized.buffer));
    document.setLogger(new Logger(Logger.Verbosity.ERROR));
    await document.transform(dedup(), weld());
    let skippedPrimitiveCount = 0;
    if (ratio < 1) {
      for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          // Keep complete small props and deformation data; never discard a primitive.
          if (triangles(primitive) < 32 || primitive.getAttribute('JOINTS_0') || primitive.listTargets().length) {
            skippedPrimitiveCount++;
            continue;
          }
          simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio, error: settings.error, lockBorder: true });
        }
      }
    }
    await document.transform(textureCompress({ encoder: sharp, resize: [textureMaxSize, textureMaxSize] }), dedup());
    const bytes = await io.writeBinary(document);
    const inspection = inspectDocument(await io.readBinary(bytes));
    if (ratio < 1 && inspection.triangleCount >= normalizedInspection.triangleCount) warnings.push(`${name}: simplification constrained by topology/error or preserved small/deforming primitives; triangle count unchanged.`);
    variants[name] = { url: `${name}.glb`, bytes: bytes.byteLength, sha256: sha256(bytes), ...inspection, normalized: true, anchor: 'bottom-center', footprint: [normalizedInspection.bounds.size[0], normalizedInspection.bounds.size[2]], height: normalizedInspection.bounds.size[1], ratio, textureMaxSize, skippedPrimitiveCount };
    pendingFiles.push([variants[name].url, bytes]);
  }
  const manifest = {
    schemaVersion: 1,
    id: path.basename(input, path.extname(input)),
    original: { url: 'original.glb', bytes: original.byteLength, sha256: sha256(original) },
    normalization: { ...normalized.inspection, ...normalizedInspection, normalized: true, anchor: 'bottom-center', footprint: [normalizedInspection.bounds.size[0], normalizedInspection.bounds.size[2]], height: normalizedInspection.bounds.size[1] },
    variants,
    processing: { engine: 'cpu', tool: 'gltf-transform/meshoptimizer/sharp', elapsedMs: Math.round(performance.now() - started), options: {
      highRatio: settings.highRatio, lowRatio: settings.lowRatio, highTextureSize: settings.highTextureSize, lowTextureSize: settings.lowTextureSize, error: settings.error,
    }, warnings },
  };
  // Complete CPU processing before reserving output. mkdir is exclusive even under races.
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(output, 'original.glb'), original, { flag: 'wx' });
  for (const [filename, bytes] of pendingFiles) await writeFile(path.join(output, filename), bytes, { flag: 'wx' });
  // Manifest is the completion marker; partial output after filesystem failure has no manifest.
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}
