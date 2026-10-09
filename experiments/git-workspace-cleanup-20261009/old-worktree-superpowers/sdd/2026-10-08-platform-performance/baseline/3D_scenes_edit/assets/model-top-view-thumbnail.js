(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ModelTopViewThumbnailModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (!canvas?.toBlob) return reject(new Error("Canvas PNG export is unavailable"));
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas PNG export returned no data")), "image/png");
    });
  }

  function nextRenderedFrame(scene, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const remove = scene.postRender.addEventListener(() => {
        remove?.();
        clearTimeout(timer);
        resolve();
      });
      timer = setTimeout(() => {
        remove?.();
        reject(new Error("Timed out while rendering model top view"));
      }, timeoutMs);
      scene.requestRender?.();
    });
  }

  function waitForModelReady(model, scene, timeoutMs = 10000) {
    if (model?.ready) return Promise.resolve();
    if (!model?.readyEvent?.addEventListener) return nextRenderedFrame(scene, timeoutMs);
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer = null;
      let pump = null;
      let removeReady = null;
      let removeError = null;
      const cleanup = () => {
        removeReady?.();
        removeError?.();
        clearTimeout(timer);
        clearInterval(pump);
      };
      const succeed = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve();
      };
      const fail = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error || "Model failed to load")));
      };
      removeReady = model.readyEvent.addEventListener(succeed);
      removeError = model.errorEvent?.addEventListener?.(fail);
      timer = setTimeout(() => fail(new Error("Timed out while preparing model top view")), timeoutMs);
      // Model readiness is reached from Scene.update and may take several frames
      // while GPU resources are created, so keep the on-demand scene rendering.
      pump = setInterval(() => scene.requestRender?.(), 16);
      scene.requestRender?.();
    });
  }

  async function createCesiumRenderer(options) {
    const Cesium = options?.Cesium || globalThis.Cesium;
    const documentRef = options?.document || globalThis.document;
    if (!Cesium?.Viewer || !Cesium?.Model?.fromGltfAsync || !documentRef?.body) throw new Error("Cesium thumbnail renderer is unavailable");
    const size = Number(options?.size) || 256;
    const container = documentRef.createElement("div");
    Object.assign(container.style, {
      position: "fixed", left: "-10000px", top: "0", width: `${size}px`, height: `${size}px`,
      overflow: "hidden", pointerEvents: "none", opacity: "1"
    });
    documentRef.body.appendChild(container);
    const viewer = new Cesium.Viewer(container, {
      animation: false, baseLayerPicker: false, fullscreenButton: false, geocoder: false,
      homeButton: false, infoBox: false, sceneModePicker: false, selectionIndicator: false,
      timeline: false, navigationHelpButton: false, navigationInstructionsInitiallyVisible: false,
      scene3DOnly: true, requestRenderMode: true, shouldAnimate: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      contextOptions: { webgl: { alpha: true, preserveDrawingBuffer: true, antialias: true } }
    });
    const scene = viewer.scene;
    scene.backgroundColor = Cesium.Color.TRANSPARENT;
    if (scene.globe) scene.globe.show = false;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.fog) scene.fog.enabled = false;

    return {
      async render(url) {
        scene.primitives.removeAll();
        const origin = Cesium.Cartesian3.fromDegrees(0, 0, 0);
        const model = await Cesium.Model.fromGltfAsync({
          url,
          modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(origin),
          cull: false,
          incrementallyLoadTextures: false
        });
        scene.primitives.add(model);
        // A postRender can occur before Cesium 1.118 has created this model's
        // scene graph. boundingSphere is valid only after Model.readyEvent.
        await waitForModelReady(model, scene);
        const sphere = model.boundingSphere;
        const range = Math.max(Number(sphere?.radius) || 1, 0.25) * 2.35;
        viewer.camera.viewBoundingSphere(sphere, new Cesium.HeadingPitchRange(0, -Cesium.Math.PI_OVER_TWO, range));
        await nextRenderedFrame(scene);
        return canvasBlob(scene.canvas);
      },
      dispose() {
        viewer.destroy?.();
        container.remove?.();
      }
    };
  }

  function createModelTopViewThumbnailer(options) {
    const urlApi = options?.urlApi || globalThis.URL;
    const rendererFactory = options?.rendererFactory || (() => createCesiumRenderer(options));
    let rendererPromise = null;
    function getRenderer() {
      rendererPromise ||= Promise.resolve().then(rendererFactory);
      return rendererPromise;
    }
    return {
      async generate(file) {
        let url = null;
        try {
          if (!file || !urlApi?.createObjectURL) throw new Error("Model file URL is unavailable");
          url = urlApi.createObjectURL(file);
          const renderer = await getRenderer();
          const blob = await renderer.render(url);
          return { ok: true, blob };
        } catch (error) {
          return { ok: false, code: "TOP_VIEW_GENERATION_FAILED", message: error?.message || String(error), stack: error?.stack || null };
        } finally {
          if (url) urlApi.revokeObjectURL?.(url);
        }
      },
      async generateFromUrl(url) {
        try {
          const renderer = await getRenderer();
          return { ok: true, blob: await renderer.render(url) };
        } catch (error) {
          return { ok: false, code: "TOP_VIEW_GENERATION_FAILED", message: error?.message || String(error), stack: error?.stack || null };
        }
      },
      dispose() {
        const disposal = rendererPromise ? rendererPromise.then((renderer) => renderer?.dispose?.()).catch(() => {}) : Promise.resolve();
        rendererPromise = null;
        return disposal;
      }
    };
  }

  return { createModelTopViewThumbnailer, createCesiumRenderer };
});
