(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../domain/geometry-rules") : root.SceneGeometryRulesModule,
    typeof module === "object" && module.exports ? require("../../features/models/glb-normalization") : root.GlbNormalizationModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneAssetLibraryModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Geometry, Glb) {
  const LIMITS = Object.freeze({ model: 50 * 1024 * 1024, texture: 10 * 1024 * 1024, symbol: 5 * 1024 * 1024 });
  const TYPES = Object.freeze({
    model: { extensions: ["glb"], mime: ["model/gltf-binary"] },
    texture: { extensions: ["png", "jpg", "jpeg", "webp"], mime: ["image/png", "image/jpeg", "image/webp"] },
    symbol: { extensions: ["svg", "png"], mime: ["image/svg+xml", "image/png"] }
  });

  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new Error("Expected binary data");
  }

  function inspectGlbHeader(value) {
    const bytes = bytesOf(value);
    if (bytes.length < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== "glTF") throw new Error("INVALID_GLB_MAGIC");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(4, true);
    const declaredLength = view.getUint32(8, true);
    if (version !== 2 || declaredLength !== bytes.length) throw new Error("INVALID_GLB_HEADER");
    if (!Glb?.inspectGlb) throw new Error("模型归一化模块未加载，请刷新后重试。");
    return { version, declaredLength, ...Glb.inspectGlb(bytes) };
  }

  function extensionOf(name) {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  async function validateAssetFile(file, kind) {
    const rule = TYPES[kind];
    if (!rule) return { ok: false, code: "UNSUPPORTED_KIND", message: "Unsupported asset kind" };
    if (!file || typeof file.arrayBuffer !== "function" || !Number.isFinite(file.size) || file.size <= 0) return { ok: false, code: "EMPTY_FILE", message: "File is empty" };
    if (file.size > LIMITS[kind]) return { ok: false, code: "FILE_TOO_LARGE", message: `File exceeds ${LIMITS[kind]} bytes` };
    const extension = extensionOf(file.name);
    if (!rule.extensions.includes(extension)) return { ok: false, code: "UNSUPPORTED_EXTENSION", message: `.${extension || "?"} is not supported` };
    const mime = String(file.type || "").toLowerCase();
    const genericModelMime = kind === "model" && (!mime || mime === "application/octet-stream");
    if (!rule.mime.includes(mime) && !genericModelMime) return { ok: false, code: "MIME_MISMATCH", message: "File extension and MIME type do not match" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "model") {
      try {
        return { ok: true, kind, extension, inspection: {version:2,declaredLength:bytes.byteLength,...await Glb.inspectGlbAsync(bytes)} };
      } catch (error) {
        return { ok: false, code: "INVALID_GLB", message: error.message };
      }
    }
    if (kind === "symbol" && extension === "svg") {
      const source = new TextDecoder().decode(bytes);
      if (/<script\b|\bon\w+\s*=|javascript:|<foreignObject\b/i.test(source)) return { ok: false, code: "UNSAFE_SVG", message: "SVG contains executable content" };
    }
    return { ok: true, kind, extension };
  }

  function sanitizeDisplayName(value) {
    return String(value || "")
      .replace(/[<>/\\\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
  }

  function safeSegment(value, label) {
    const result = String(value || "").trim();
    if (!result || result.includes("/") || result.includes("\\") || result.includes("..")) throw new Error(`${label} is invalid`);
    return result;
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function buildStoragePath(options) {
    const scope = String(options?.scope || "");
    if (!['personal', 'group', 'course'].includes(scope)) throw new Error("scope is invalid");
    const ownerId = safeSegment(options?.ownerId, "ownerId");
    const extension = extensionOf(options?.fileName);
    if (!extension) throw new Error("fileName extension is required");
    const date = String(options?.date || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date is invalid");
    return `${scope}/${ownerId}/${date.slice(0, 7)}/${safeSegment(options?.uuid || randomId(), "uuid")}.${extension}`;
  }

  function normalizeAssetRecord(row) {
    if (!row) return null;
    return {
      id: row.id,
      courseId: row.course_id ?? row.courseId,
      groupId: row.group_id ?? row.groupId ?? null,
      ownerId: row.owner_id ?? row.ownerId,
      scope: row.scope_kind ?? row.scope,
      kind: row.kind,
      storagePath: row.storage_path ?? row.storagePath,
      displayName: row.display_name ?? row.displayName,
      mimeType: row.mime_type ?? row.mimeType,
      bytes: row.file_size ?? row.bytes,
      metadata: row.metadata || {},
      archivedAt: row.archived_at ?? row.archivedAt ?? null
    };
  }

  function toCatalogAsset(row) {
    const record = normalizeAssetRecord(row);
    if (!record) return null;
    const metadata = record.metadata || {};
    const size = Array.isArray(metadata.realSizeM) ? metadata.realSizeM
      : Array.isArray(metadata.measuredSizeM) ? metadata.measuredSizeM : [1, 1, 1];
    const placementKind = metadata.placementKind || (record.kind === "texture" ? "surface" : "asset");
    return {
      id: record.id,
      kind: placementKind,
      category: metadata.category || (placementKind === "surface" ? "paving" : "sculpture"),
      label: record.displayName,
      footprintM: [Number(size[0]) || 1, Number(size[1]) || 1],
      defaultHeightM: Number(size[2]) || (placementKind === "surface" ? .05 : 1),
      renderer: record.kind === "model" ? "glb" : record.kind,
      fileType: record.kind === "model" ? "glb" : record.kind,
      storagePath: record.storagePath,
      topViewPath: metadata.topViewPath || null,
      scope: record.scope,
      metadata
    };
  }

  function positive(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
    return number;
  }

  function calibrateAsset(asset, calibration) {
    const measured = asset?.metadata?.measuredSizeM || [1, 1, 1];
    const real = [positive(calibration?.widthM, "widthM"), positive(calibration?.depthM, "depthM"), positive(calibration?.heightM, "heightM")];
    if (measured.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error("measuredSizeM must be positive");
    return {
      ...asset,
      metadata: {
        ...(asset.metadata || {}),
        realSizeM: real,
        calibrationScale: real.map((value, index) => value / Number(measured[index])),
        headingCorrectionDeg: Number(calibration?.headingCorrectionDeg) || 0,
        groundOffsetM: Number(calibration?.groundOffsetM) || 0
      }
    };
  }

  function mapGeometryCoordinates(geometry, mapper) {
    function map(value) {
      if (Array.isArray(value) && typeof value[0] === "number") return mapper(value);
      return Array.isArray(value) ? value.map(map) : value;
    }
    return { ...geometry, coordinates: map(geometry.coordinates) };
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function createComponent(selection, origin, options) {
    if (!Array.isArray(selection) || !selection.length) throw new Error("Component selection is empty");
    return {
      id: options?.id || randomId(),
      name: sanitizeDisplayName(options?.name) || "未命名组件",
      coordinateSpace: "local-m",
      objects: selection.map((source) => {
        const object = clone(source);
        object.geometry = mapGeometryCoordinates(object.geometry, (position) => Geometry.toLocalMeters(position, origin));
        object.groupId = null;
        return object;
      }),
      assetRefs: [...new Set(selection.map((item) => item.properties?.assetRef).filter(Boolean))]
    };
  }

  function instantiateComponent(component, target, options) {
    const groupId = options?.groupId || randomId();
    const idFactory = options?.idFactory || (() => randomId());
    const objects = component.objects.map((source, index) => {
      const object = clone(source);
      object.id = idFactory(source.id, index);
      object.groupId = groupId;
      object.geometry = mapGeometryCoordinates(object.geometry, (point) => Geometry.fromLocalMeters(point, target));
      return object;
    });
    return { group: { id: groupId, name: component.name, objectIds: objects.map((object) => object.id) }, objects };
  }

  function createAssetLibrary(options) {
    const storage = options?.storage;
    const resolveAsset = options?.resolveAsset;
    const uploadBundle = options?.uploadBundle;
    const dataClient = options?.dataClient;
    const uuid = options?.uuid || randomId;
    const now = options?.now || (() => new Date());
    return {
      async upload(file, input) {
        const validation = await validateAssetFile(file, input.kind);
        if (!validation.ok) return validation;
        let normalized = null, lowNormalized = null, processing = null;
        if (input.kind === "model") {
          try {
            const units = { metersPerUnit: input.metersPerUnit ?? input.metadata?.metersPerUnit ?? 1 };
            const sourceBuffer = await file.arrayBuffer();
            if (input.lowFile) {
              normalized = await Glb.normalizeGlbAsync(sourceBuffer, units);
            } else {
              normalized = await Glb.createModelVariantsAsync(sourceBuffer, units);
              if (!normalized.lowBuffer || !normalized.lowInspection) throw new Error("自动轻量模型生成失败，请重新上传。");
              lowNormalized = { buffer: normalized.lowBuffer, inspection: normalized.lowInspection };
              processing = normalized.processing;
            }
            if (input.lowFile) {
              const lowValidation = await validateAssetFile(input.lowFile, "model");
              if (!lowValidation.ok) return { ...lowValidation, message: `低模：${lowValidation.message}` };
              const lowBuffer = await input.lowFile.arrayBuffer();
              const inspection = await Glb.inspectGlbAsync(lowBuffer);
              const high = normalized.inspection;
              function sameCoordinates(first, second) {
                return Array.isArray(first) && Array.isArray(second) && first.length === 3 && second.length === 3 &&
                  first.every((value, axis) => Number.isFinite(value) && Number.isFinite(second[axis]) &&
                    Math.abs(value - second[axis]) <= 1e-6 * Math.max(1, Math.abs(value), Math.abs(second[axis])));
              }
              if (!inspection.normalized || high.anchor !== "bottom-center" || inspection.anchor !== "bottom-center" ||
                high.normalization?.metersPerUnit !== inspection.normalization?.metersPerUnit ||
                !sameCoordinates(high.normalization?.originalCenter, inspection.normalization?.originalCenter) ||
                !sameCoordinates(high.normalization?.originalBounds?.min, inspection.normalization?.originalBounds?.min) ||
                !sameCoordinates(high.normalization?.originalBounds?.max, inspection.normalization?.originalBounds?.max)) {
                return { ok: false, code: "LOD_ANCHOR_MISMATCH", message: "轻量 GLB 必须保留同一原模型的标准化底部中心锚点。请同时选择 CPU 工具输出的 high.glb 与 low.glb。" };
              }
              // Simplification may shrink visual bounds; keep the tool's original
              // normalization transform and bytes rather than recentering the LOD.
              lowNormalized = { buffer: lowBuffer, inspection };
            }
            if (normalized.buffer.byteLength > LIMITS.model || lowNormalized?.buffer.byteLength > LIMITS.model) {
              return { ok: false, code: "FILE_TOO_LARGE", message: "处理后的模型不能超过 50 MB。" };
            }
          } catch (error) { return { ok: false, code: "INVALID_GLB", message: error.message }; }
        }
        function displayFile(buffer, name) {
          const blob = new Blob([buffer], { type: "model/gltf-binary" });
          Object.defineProperty(blob, "name", { value: name });
          return blob;
        }
        const display = normalized ? displayFile(normalized.buffer, file.name) : file;
        if (typeof uploadBundle === "function") {
          const bundleFiles = [{ role: "display", file: display }];
          if (normalized) bundleFiles.unshift({ role: "original", file });
          if (lowNormalized) {
            if (input.lowFile) bundleFiles.push({ role: "low-original", file: input.lowFile });
            bundleFiles.push({ role: "low", file: displayFile(lowNormalized.buffer, "low.glb") });
          }
          if (input.topViewBlob && input.kind === "model") bundleFiles.push({ role: "top", file: input.topViewBlob });
          const metadata = { ...(input.metadata || {}), inspection: normalized?.inspection || validation.inspection || null,
            measuredSizeM: normalized ? [normalized.inspection.bounds.size[0], normalized.inspection.bounds.size[2], normalized.inspection.bounds.size[1]] : input.metadata?.measuredSizeM || null,
            ...(normalized ? { normalized: true, anchor: normalized.inspection.anchor, bounds: normalized.inspection.bounds } : {}),
            ...(lowNormalized ? { lowInspection: lowNormalized.inspection } : {}), ...(processing ? { processing } : {}) };
          try { return await uploadBundle({ context: { courseId: input.courseId, groupId: input.groupId || null, scopeKind: input.scope, kind: input.kind },
            files: bundleFiles, record: { displayName: sanitizeDisplayName(input.displayName || file.name), metadata, license: input.license || "student-provided" } }); }
          catch { return { ok: false, code: "UPLOAD_FAILED", message: "UPLOAD_FAILED" }; }
        }
        const path = buildStoragePath({ scope: input.scope, ownerId: input.ownerId, fileName: file.name, uuid: uuid(), date: now().toISOString().slice(0, 10) });
        const originalPath = normalized ? path.replace(/\.glb$/i, ".original.glb") : null;
        const lowPath = lowNormalized ? path.replace(/\.glb$/i, ".low.glb") : null;
        const files = normalized ? [[originalPath, file], [path, display]] : [[path, file]];
        if (lowNormalized) {
          if (input.lowFile) files.push([lowPath.replace(/\.glb$/i, ".original.glb"), input.lowFile]);
          files.push([lowPath, displayFile(lowNormalized.buffer, input.lowFile?.name || file.name.replace(/\.glb$/i, ".low.glb"))]);
        }
        const uploadedPaths = [];
        async function rollback() { if (storage.remove && uploadedPaths.length) await storage.remove(uploadedPaths); }
        try {
          for (const [storagePath, data] of files) {
            const uploaded = await storage.upload(storagePath, data, { contentType: data.type || "model/gltf-binary", upsert: false });
            if (uploaded.error) { await rollback(); return { ok: false, code: "UPLOAD_FAILED", message: uploaded.error.message }; }
            uploadedPaths.push(storagePath);
          }
        } catch (error) { await rollback(); return { ok: false, code: "UPLOAD_FAILED", message: error.message }; }
        let topViewPath = null;
        let topViewStatus = input.topViewBlob ? "failed" : (input.metadata?.topViewStatus || null);
        if (input.topViewBlob && input.kind === "model") {
          topViewPath = path.replace(/\.[^.]+$/, ".top.png");
          let topViewUpload;
          try { topViewUpload = await storage.upload(topViewPath, input.topViewBlob, { contentType: "image/png", upsert: false }); }
          catch (error) { await rollback(); return { ok: false, code: "UPLOAD_FAILED", message: error.message }; }
          if (!topViewUpload.error) {
            uploadedPaths.push(topViewPath);
            topViewStatus = "ready";
          } else {
            topViewPath = null;
          }
        }
        const metadata = {
          ...(input.metadata || {}),
          inspection: normalized?.inspection || validation.inspection || null,
          measuredSizeM: normalized ? [normalized.inspection.bounds.size[0], normalized.inspection.bounds.size[2], normalized.inspection.bounds.size[1]] : input.metadata?.measuredSizeM || null,
          ...(normalized ? { normalized: true, anchor: normalized.inspection.anchor, bounds: normalized.inspection.bounds,
            originalStoragePath: originalPath, originalBytes: file.size } : {}),
          ...(lowNormalized ? { lowStoragePath: lowPath, lowInspection: lowNormalized.inspection } : {}),
          ...(processing ? { processing } : {}),
          ...(topViewStatus ? { topViewStatus } : {}),
          ...(topViewPath ? { topViewPath } : {})
        };
        let registered;
        try { registered = await dataClient.registerAsset({
          course_id: input.courseId,
          group_id: input.groupId || null,
          owner_id: input.ownerUserId || null,
          scope_kind: input.scope,
          kind: input.kind,
          storage_path: path,
          display_name: sanitizeDisplayName(input.displayName || file.name),
          mime_type: normalized ? "model/gltf-binary" : file.type,
          file_size: display.size,
          metadata,
          license: input.license || "student-provided"
        }); } catch (error) { await rollback(); return { ok: false, code: "REGISTER_FAILED", message: error.message }; }
        if (!registered.ok) await rollback();
        return registered;
      },
      async resolveUrl(asset, options = {}) {
        if (typeof resolveAsset === "function") return resolveAsset(asset.id, options.variant || "display");
        const record = normalizeAssetRecord(asset);
        const path = options.variant === "low" ? record?.metadata?.lowStoragePath : record?.storagePath;
        if (!path) return { ok: false, code: "MISSING_VARIANT", message: "模型版本不存在。" };
        const result = await storage.createSignedUrl(path, 3600);
        return result.error ? { ok: false, code: "SIGNED_URL_FAILED", message: result.error.message } : { ok: true, url: result.data.signedUrl };
      },
      publishToCourse(assetId) { return dataClient.publishAsset(assetId); },
      copySharedAsset(assetId, groupId) { return dataClient.copySharedAsset(assetId, groupId); },
      removeAsset(assetId) { return dataClient.archiveAsset(assetId); },
      saveComponent(component) { return dataClient.saveComponent(component); },
      publishComponent(componentId) { return dataClient.publishComponent(componentId); },
      copySharedComponent(componentId, groupId) { return dataClient.copySharedComponent(componentId, groupId); },
      removeComponent(componentId) { return dataClient.archiveComponent(componentId); }
    };
  }

  return {
    LIMITS,
    validateAssetFile,
    inspectGlbHeader,
    sanitizeDisplayName,
    buildStoragePath,
    normalizeAssetRecord,
    toCatalogAsset,
    calibrateAsset,
    createComponent,
    instantiateComponent,
    createAssetLibrary
  };
});
