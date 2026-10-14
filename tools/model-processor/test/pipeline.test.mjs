import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const pipelineUrl = new URL('../pipeline.mjs', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(directory) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = [], uvs = [], indices = [];
  const divisions = 32;
  for (let z = 0; z <= divisions; z++) {
    for (let x = 0; x <= divisions; x++) {
      positions.push(10 + x / divisions * 2, 3, 2 + z / divisions);
      uvs.push(x / divisions, z / divisions);
    }
  }
  for (let z = 0; z < divisions; z++) {
    for (let x = 0; x < divisions; x++) {
      const a = z * (divisions + 1) + x, b = a + divisions + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const texture = document.createTexture().setImage(await sharp({ create: {
    width: 2048, height: 1024, channels: 4, background: '#548956',
  } }).png().toBuffer()).setMimeType('image/png');
  const material = document.createMaterial().setBaseColorTexture(texture);
  const primitive = document.createPrimitive().setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer)).setMaterial(material);
  const mesh = document.createMesh().addPrimitive(primitive);
  document.createScene().addChild(document.createNode().setMesh(mesh));
  const input = path.join(directory, 'source.glb');
  await new NodeIO().write(input, document);
  return input;
}

test('CPU pipeline preserves original and writes readable, anchored LODs with resized textures', async (t) => {
  assert.ok(existsSync(pipelineUrl), 'CPU model pipeline must exist');
  const { processModel } = await import(pipelineUrl);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'village-model-processor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await fixture(directory);
  const original = await readFile(input);
  const output = path.join(directory, 'variants');
  const manifest = await processModel({ input, output, highTextureSize: 1024, lowTextureSize: 512 });
  assert.deepEqual(await readFile(input), original);
  assert.deepEqual(await readFile(path.join(output, manifest.original.url)), original);
  assert.equal(manifest.original.sha256, hash(original));
  assert.equal(manifest.processing.engine, 'cpu');
  assert.equal(manifest.variants.high.normalized, true);
  assert.equal(manifest.variants.low.anchor, 'bottom-center');
  assert.deepEqual(manifest.normalization.bounds.min, [-1, 0, -0.5]);
  assert.deepEqual(manifest.variants.high.footprint, [2, 1]);
  assert.deepEqual(manifest.variants.high.footprint, manifest.variants.low.footprint);
  assert.ok(manifest.variants.low.triangleCount < manifest.variants.high.triangleCount);
  const io = new NodeIO();
  const roots = [];
  for (const [name, limit] of [['high', 1024], ['low', 512]]) {
    const metadata = manifest.variants[name];
    const bytes = await readFile(path.join(output, metadata.url));
    assert.equal(metadata.bytes, bytes.length);
    assert.equal(metadata.sha256, hash(bytes));
    const document = await io.readBinary(bytes);
    assert.equal(document.getRoot().getExtras().villageModel.normalized, true);
    assert.equal(document.getRoot().listMeshes().length, 1);
    assert.equal(document.getRoot().listTextures().length, 1);
    assert.equal(document.getRoot().listExtensionsRequired().length, 0);
    roots.push(document.getRoot().listScenes()[0].listChildren().map((node) => node.getMatrix()));
    for (const texture of document.getRoot().listTextures()) {
      const image = await sharp(texture.getImage()).metadata();
      assert.ok(image.width <= limit && image.height <= limit);
    }
  }
  assert.deepEqual(roots[0], roots[1], 'LOD root transform must stay identical');
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')), manifest);
});

test('unsafe paths and invalid options never overwrite input or existing output', async (t) => {
  assert.ok(existsSync(pipelineUrl), 'CPU model pipeline must exist');
  const { processModel } = await import(pipelineUrl);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'village-model-paths-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await fixture(directory);
  const bytes = await readFile(input);
  await assert.rejects(processModel({ input, output: input }), /output|输出/i);
  await assert.rejects(processModel({ input, output: directory }), /exist|存在/i);
  const existing = path.join(directory, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'keep.txt'), 'keep');
  await assert.rejects(processModel({ input, output: existing }), /exist|存在/i);
  assert.equal(await readFile(path.join(existing, 'keep.txt'), 'utf8'), 'keep');
  const invalidOutput = path.join(directory, 'invalid-options');
  await assert.rejects(processModel({ input, output: invalidOutput, lowRatio: 0 }), /ratio/i);
  assert.equal(existsSync(invalidOutput), false);
  await assert.rejects(processModel({ input: directory, output: path.join(directory, 'directory-input') }), /GLB|file/i);
  assert.deepEqual(await readFile(input), bytes);
});

test('malformed GLB and external texture input fail before creating output', async (t) => {
  const { processModel } = await import(pipelineUrl);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'village-model-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'invalid.glb');
  const output = path.join(directory, 'output');
  await writeFile(input, 'not a model');
  await assert.rejects(processModel({ input, output }), /GLB/i);
  assert.equal(existsSync(output), false);
  const valid = await fixture(directory);
  const normalizer = createRequire(import.meta.url)('../../../features/models/glb-normalization.js');
  const { json, binary } = normalizer.readGlb(await readFile(valid));
  json.images[0] = { uri: 'external-texture.png' };
  await writeFile(input, new Uint8Array(normalizer.writeGlb(json, binary)));
  await assert.rejects(processModel({ input, output }), /external resources/i);
  assert.equal(existsSync(output), false);
  delete json.images;
  json.extensionsUsed = ['UNSUPPORTED_appearance_extension'];
  await writeFile(input, new Uint8Array(normalizer.writeGlb(json, binary)));
  await assert.rejects(processModel({ input, output }), /Unsupported extension/i);
  assert.equal(existsSync(output), false);
});

test('Meshopt source is CPU decoded before normalization and original compressed bytes stay intact', async (t) => {
  const { processModel } = await import(pipelineUrl);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'village-model-meshopt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await fixture(directory);
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const document = await io.read(source);
  document.setLogger(new Logger(Logger.Verbosity.ERROR));
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const input = path.join(directory, 'compressed.glb');
  await io.write(input, document);
  const original = await readFile(input);
  const normalizer = createRequire(import.meta.url)('../../../features/models/glb-normalization.js');
  assert.ok(normalizer.readGlb(original).json.extensionsRequired.includes('EXT_meshopt_compression'));
  assert.throws(() => normalizer.normalizeGlb(original), /压缩|compressed|meshopt/i, 'Direct normalization must reject undecoded Meshopt bytes');
  const output = path.join(directory, 'variants');
  const manifest = await processModel({ input, output });
  assert.deepEqual(await readFile(input), original);
  assert.deepEqual(await readFile(path.join(output, 'original.glb')), original);
  assert.equal(manifest.original.sha256, hash(original));
  const roots = [];
  for (const name of ['high', 'low']) {
    const bytes = await readFile(path.join(output, manifest.variants[name].url));
    const { json } = normalizer.readGlb(bytes);
    assert.ok(!(json.extensionsUsed || []).includes('EXT_meshopt_compression'));
    assert.ok(!(json.extensionsRequired || []).includes('EXT_meshopt_compression'));
    assert.ok(!(json.bufferViews || []).some((view) => view.extensions?.EXT_meshopt_compression));
    const inspection = normalizer.inspectGlb(bytes);
    assert.equal(inspection.normalized, true);
    assert.ok(Math.abs(inspection.bounds.min[1]) < 1e-6);
    const decoded = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
    roots.push(decoded.getRoot().listScenes()[0].listChildren().map((node) => node.getMatrix()));
  }
  assert.deepEqual(roots[0], roots[1]);
  assert.ok(manifest.variants.low.triangleCount < manifest.variants.high.triangleCount);
});

test('POSITION morph input requires an exported static pose and never writes output', async (t) => {
  const { processModel } = await import(pipelineUrl);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'village-model-morph-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await fixture(directory);
  const io = new NodeIO();
  const document = await io.read(input);
  const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0];
  const position = primitive.getAttribute('POSITION');
  const deltas = new Float32Array(position.getCount() * 3);
  deltas[1] = 1;
  const target = document.createPrimitiveTarget().setAttribute('POSITION', document.createAccessor()
    .setType('VEC3').setArray(deltas).setBuffer(document.getRoot().listBuffers()[0]));
  primitive.addTarget(target);
  await io.write(input, document);
  const original = await readFile(input);
  const output = path.join(directory, 'variants');
  await assert.rejects(processModel({ input, output }), /static|静态|姿态|morph|形态/i);
  assert.deepEqual(await readFile(input), original);
  assert.equal(existsSync(output), false);
});
