(function () {
  // Animated drone body with embedded hover animation.
  const DEFAULT_MODEL_URI = "features/drone/assets/animated-drone.glb";
  // GPU/driver fallback when animated skinned model fails to render.
  const FALLBACK_MODEL_URI = "features/DJIA.glb";

  const DEFAULT_MOVE_SPEED_MPS = 8.0;
  const DEFAULT_VERTICAL_SPEED_MPS = 5.0;
  const DEFAULT_SPRINT_MULTIPLIER = 1.8;
  const DEFAULT_MOUSE_SENSITIVITY = 0.0025;

  const DEFAULT_DRONE_HEIGHT = 20.0;
  const MIN_DRONE_HEIGHT = 1.0;
  const MAX_DRONE_HEIGHT = 500.0;

  // animated-drone.glb is authored in meter-ish units; DJIA.glb uses a much larger scene scale.
  const DEFAULT_MODEL_SCALE = 5.0;
  const FALLBACK_MODEL_SCALE = 0.0035;
  // Keep the drone visible in third-person even at distance.
  const DEFAULT_MODEL_MIN_PIXEL_SIZE = 120.0;
  const DEFAULT_MODEL_ANIMATION_NAME = "hover";
  const MODEL_READY_TIMEOUT_MS = 10000;

  // Third-person drone follow camera (MC-like chase camera).
  const DEFAULT_CAMERA_BACK_METERS = 8.0;
  const DEFAULT_CAMERA_HEIGHT_METERS = 2.2;
  const DEFAULT_CAMERA_SIDE_METERS = 0.0;
  const DEFAULT_LOOK_AHEAD_METERS = 1.2;
  const DEFAULT_LOOK_HEIGHT_METERS = 1.2;

  // First-person drone camera.
  const DEFAULT_FIRST_PERSON_FORWARD_METERS = 1.2;
  const DEFAULT_FIRST_PERSON_HEIGHT_METERS = 1.0;
  const DEFAULT_FIRST_PERSON_LOOK_AHEAD_METERS = 30.0;
  const DEFAULT_THIRD_PERSON_MIN_BACK_METERS = 4.0;
  const DEFAULT_THIRD_PERSON_MAX_BACK_METERS = 20.0;
  const DEFAULT_THIRD_PERSON_ZOOM_STEP_METERS = 0.35;
  const THIRD_PERSON_MIN_PITCH = Cesium.Math.toRadians(-70);
  const THIRD_PERSON_MAX_PITCH = Cesium.Math.toRadians(55);

  const MIN_PITCH = Cesium.Math.toRadians(-80);
  const MAX_PITCH = Cesium.Math.toRadians(80);
  const RADIUS_METERS = Cesium.Ellipsoid.WGS84.maximumRadius;
  const TAU = Math.PI * 2;
  // Fallback procedural rotors (disabled by default).
  const ROTOR_SPIN_RATE_RAD_PER_SEC = 10.0;
  const DEFAULT_USE_PROCEDURAL_ROTORS = false;
  const ROTOR_HEIGHT_METERS = 0.32;
  const ROTOR_RADIUS_METERS = 0.56;
  const ROTOR_LAYOUT = [
    { right: -0.88, forward: 0.88, phase: 0, sign: 1 },
    { right: 0.88, forward: 0.88, phase: Math.PI * 0.5, sign: -1 },
    { right: 0.88, forward: -0.88, phase: Math.PI, sign: 1 },
    { right: -0.88, forward: -0.88, phase: Math.PI * 1.5, sign: -1 }
  ];
  const SHOW_DEBUG_ANCHOR = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isTypingElement(target) {
    if (!target || !target.tagName) return false;
    const tag = String(target.tagName).toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  function toSafeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function cloneCartographic(cartographic) {
    if (!cartographic) return null;
    return new Cesium.Cartographic(
      cartographic.longitude,
      cartographic.latitude,
      Number.isFinite(cartographic.height) ? cartographic.height : 0
    );
  }

  function resolveGroundHeight(viewer, cartographic, fallbackHeight) {
    if (!viewer || !cartographic) return 0;
    const globe = viewer.scene?.globe;
    const fallback = Number.isFinite(fallbackHeight) ? Math.max(0, fallbackHeight) : 0;
    if (!globe || typeof globe.getHeight !== "function") return fallback;
    const sampled = globe.getHeight(new Cesium.Cartographic(cartographic.longitude, cartographic.latitude, 0));
    return Number.isFinite(sampled) ? Math.max(0, sampled) : fallback;
  }

  function computeEastNorthOffset(localRightMeters, localForwardMeters, headingRad) {
    return {
      east: localRightMeters * Math.cos(headingRad) + localForwardMeters * Math.sin(headingRad),
      north: -localRightMeters * Math.sin(headingRad) + localForwardMeters * Math.cos(headingRad)
    };
  }

  function offsetCartographic(base, eastMeters, northMeters, upMeters) {
    const lat = clamp(base.latitude + northMeters / RADIUS_METERS, Cesium.Math.toRadians(-89.5), Cesium.Math.toRadians(89.5));
    const cosLat = Math.max(1e-6, Math.cos(lat));
    const lon = base.longitude + eastMeters / (RADIUS_METERS * cosLat);
    const height = Math.max(0, (Number.isFinite(base.height) ? base.height : 0) + upMeters);
    return new Cesium.Cartographic(lon, lat, height);
  }

  function createController(options) {
    options = options || {};
    const viewer = options.viewer;
    if (!viewer || typeof Cesium === "undefined") {
      throw new Error("VillageDroneModule requires a valid Cesium viewer.");
    }

    const canvas = viewer.scene?.canvas;
    if (!canvas) {
      throw new Error("VillageDroneModule cannot find viewer.scene.canvas.");
    }

    const getSpawnCartographic = typeof options.getSpawnCartographic === "function"
      ? options.getSpawnCartographic
      : function () { return cloneCartographic(viewer.camera?.positionCartographic); };
    const canActivate = typeof options.canActivate === "function" ? options.canActivate : function () { return true; };
    const is3DViewActive = typeof options.is3DViewActive === "function" ? options.is3DViewActive : function () { return true; };
    const onStatusChange = typeof options.onStatusChange === "function" ? options.onStatusChange : null;

    const moveSpeedMps = Math.max(0.5, toSafeNumber(options.moveSpeedMps, DEFAULT_MOVE_SPEED_MPS));
    const verticalSpeedMps = Math.max(0.5, toSafeNumber(options.verticalSpeedMps, DEFAULT_VERTICAL_SPEED_MPS));
    const sprintMultiplier = Math.max(1, toSafeNumber(options.sprintMultiplier, DEFAULT_SPRINT_MULTIPLIER));
    const mouseSensitivity = Math.max(0.0004, toSafeNumber(options.mouseSensitivity, DEFAULT_MOUSE_SENSITIVITY));
    const initialHeight = Math.max(MIN_DRONE_HEIGHT, toSafeNumber(options.initialHeight, DEFAULT_DRONE_HEIGHT));

    const cameraBackMeters = Math.max(1.2, toSafeNumber(options.cameraBackMeters, DEFAULT_CAMERA_BACK_METERS));
    const cameraHeightMeters = Math.max(1, toSafeNumber(options.cameraHeightMeters, DEFAULT_CAMERA_HEIGHT_METERS));
    const cameraSideMeters = toSafeNumber(options.cameraSideMeters, DEFAULT_CAMERA_SIDE_METERS);
    const lookAheadMeters = Math.max(0, toSafeNumber(options.lookAheadMeters, DEFAULT_LOOK_AHEAD_METERS));
    const lookHeightMeters = toSafeNumber(options.lookHeightMeters, DEFAULT_LOOK_HEIGHT_METERS);
    const thirdPersonMinBackMeters = Math.max(1.2, toSafeNumber(options.thirdPersonMinBackMeters, DEFAULT_THIRD_PERSON_MIN_BACK_METERS));
    const thirdPersonMaxBackMeters = Math.max(thirdPersonMinBackMeters + 0.2, toSafeNumber(options.thirdPersonMaxBackMeters, DEFAULT_THIRD_PERSON_MAX_BACK_METERS));
    const thirdPersonZoomStepMeters = Math.max(0.05, toSafeNumber(options.thirdPersonZoomStepMeters, DEFAULT_THIRD_PERSON_ZOOM_STEP_METERS));

    const firstPersonForwardMeters = Math.max(0.1, toSafeNumber(options.firstPersonForwardMeters, DEFAULT_FIRST_PERSON_FORWARD_METERS));
    const firstPersonHeightMeters = Math.max(0, toSafeNumber(options.firstPersonHeightMeters, DEFAULT_FIRST_PERSON_HEIGHT_METERS));
    const firstPersonLookAheadMeters = Math.max(5, toSafeNumber(options.firstPersonLookAheadMeters, DEFAULT_FIRST_PERSON_LOOK_AHEAD_METERS));

    const modelScale = Math.max(0.0001, toSafeNumber(options.modelScale, DEFAULT_MODEL_SCALE));
    const modelMinPixelSize = Math.max(0, toSafeNumber(options.modelMinPixelSize, DEFAULT_MODEL_MIN_PIXEL_SIZE));
    const modelAnimationName = String(options.modelAnimationName ?? DEFAULT_MODEL_ANIMATION_NAME).trim();
    const showModelInFirstPerson = !!options.showModelInFirstPerson;
    const useModelPrimitive = !!options.useModelPrimitive;

    const droneModelUri = String(options.droneModelUri || DEFAULT_MODEL_URI).trim();
    let useProceduralRotors = !!(options.useProceduralRotors ?? DEFAULT_USE_PROCEDURAL_ROTORS);
    let fallbackSwitched = false;
    let modelAnimationStarted = false;
    let modelLoadFailed = false;
    let droneModelPrimitive = null;
    let droneModelPrimitivePromise = null;

    let droneEntity = null;
    let rotorEntities = [];
    let rotorTipEntities = [];
    let rotorCrossEntities = [];
    let rotorSpinRadians = 0;
    let bodyCartographic = null;
    let heading = Number.isFinite(viewer.camera?.heading) ? viewer.camera.heading : 0;
    let pitch = clamp(Number.isFinite(viewer.camera?.pitch) ? viewer.camera.pitch : Cesium.Math.toRadians(-20), MIN_PITCH, MAX_PITCH);

    let active = false;
    let pointerLocked = false;
    let hasPlacement = false;
    let activationStartedAtMs = 0;
    let cameraMode = String(options.cameraMode || "third").toLowerCase() === "first" ? "first" : "third";
    let cameraBackDistanceMeters = clamp(cameraBackMeters, thirdPersonMinBackMeters, thirdPersonMaxBackMeters);
    let rafId = 0;
    let lastFrameTs = 0;
    let controllerBackup = null;
    const wheelListenerOptions = { capture: true, passive: false };

    const keyState = {
      KeyW: false, KeyA: false, KeyS: false, KeyD: false,
      Space: false, ControlLeft: false, ControlRight: false,
      ShiftLeft: false, ShiftRight: false
    };

    function buildHintMessage(eligible, activeMode, locked, mode) {
      const modeLabel = mode === "first" ? "first-person" : "third-person";
      if (!eligible) return "Drone mode is only available in current/base space.";
      if (activeMode) {
        if (locked) return "Drone (" + modeLabel + "): WASD move, Space up, Ctrl down, mouse look, Shift sprint, V switch view, Esc unlock pointer.";
        return "Drone (" + modeLabel + ") enabled: click 3D canvas to lock pointer, press V to switch view.";
      }
      return "Tip: click drone button to enter drone mode.";
    }

    function emitStatus(extra) {
      extra = extra || {};
      const eligible = !!canActivate();
      const status = {
        active: active,
        eligible: eligible,
        pointerLocked: pointerLocked,
        cameraMode: cameraMode,
        thirdPersonDistanceMeters: cameraBackDistanceMeters,
        message: buildHintMessage(eligible, active, pointerLocked, cameraMode)
      };
      Object.keys(extra || {}).forEach(function (k) { status[k] = extra[k]; });
      if (onStatusChange) onStatusChange(status);
      return status;
    }

    function setCesiumCameraControlsEnabled(enabled) {
      const cameraController = viewer.scene?.screenSpaceCameraController;
      if (!cameraController) return;
      if (!enabled) {
        controllerBackup = {
          enableInputs: cameraController.enableInputs,
          enableTranslate: cameraController.enableTranslate,
          enableRotate: cameraController.enableRotate,
          enableTilt: cameraController.enableTilt,
          enableLook: cameraController.enableLook,
          enableZoom: cameraController.enableZoom
        };
        cameraController.enableInputs = false;
        cameraController.enableTranslate = false;
        cameraController.enableRotate = false;
        cameraController.enableTilt = false;
        cameraController.enableLook = false;
        cameraController.enableZoom = false;
        return;
      }
      if (controllerBackup) {
        cameraController.enableInputs = controllerBackup.enableInputs;
        cameraController.enableTranslate = controllerBackup.enableTranslate;
        cameraController.enableRotate = controllerBackup.enableRotate;
        cameraController.enableTilt = controllerBackup.enableTilt;
        cameraController.enableLook = controllerBackup.enableLook;
        cameraController.enableZoom = controllerBackup.enableZoom;
      } else {
        cameraController.enableInputs = true;
        cameraController.enableTranslate = true;
        cameraController.enableRotate = true;
        cameraController.enableTilt = true;
        cameraController.enableLook = true;
        cameraController.enableZoom = true;
      }
    }

    function ensureDroneEntity() {
      if (droneEntity || !viewer) return droneEntity;
      const entityConfig = {
        id: "__village_drone__",
        show: false,
        position: Cesium.Cartesian3.fromRadians(0, 0, 0),
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.fromRadians(0, 0, 0),
          new Cesium.HeadingPitchRoll(0, 0, 0)
        ),
        // Keep drone always renderable regardless of camera distance.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, Number.MAX_VALUE),
        // Visual fallback marker is hidden by default to avoid confusion with real model.
        ellipsoid: {
          show: false,
          radii: new Cesium.Cartesian3(0.65, 0.65, 0.28),
          material: Cesium.Color.fromCssColorString("#00bcd4").withAlpha(0.18),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#00e5ff"),
          outlineWidth: 1
        }
      };
      if (droneModelUri && !useModelPrimitive) {
        console.log("[Drone] loading model:", droneModelUri, "with scale:", modelScale);
        entityConfig.model = {
          uri: droneModelUri,
          scale: modelScale,
          // Keep drone visible in third-person, but still allow natural scale in first-person.
          minimumPixelSize: Math.max(60, modelMinPixelSize),
          maximumScale: 5000,
          // For animated GLBs, enable auto-play so Cesium runs the embedded
          // animation clips immediately; manual animation start via internal
          // API (_modelHash) is fragile and often fails with skinned models.
          runAnimations: true,
          clampAnimations: true,
          incrementallyLoadTextures: false,
          // Some exported animated models have inconsistent face winding in Cesium;
          // disabling back-face culling makes them render instead of disappearing.
          backFaceCulling: false,
          // Keep default material colors; disable silhouette to avoid dot-like artifacts.
          color: Cesium.Color.WHITE,
          colorBlendMode: Cesium.ColorBlendMode.MIX,
          colorBlendAmount: 0.0,
          silhouetteSize: 0.0
        };
      }
      droneEntity = viewer.entities.add(entityConfig);
      if (useModelPrimitive) ensureModelPrimitive();
      if (useProceduralRotors) ensureRotorEntities();
      console.log("[Drone] entity created");
      return droneEntity;
    }

    function buildDroneModelMatrix(position) {
      return Cesium.Transforms.headingPitchRollToFixedFrame(
        position,
        new Cesium.HeadingPitchRoll(heading, 0, 0)
      );
    }

    function getCurrentDronePosition() {
      if (!bodyCartographic) return Cesium.Cartesian3.fromRadians(0, 0, 0);
      return Cesium.Cartesian3.fromRadians(
        bodyCartographic.longitude,
        bodyCartographic.latitude,
        bodyCartographic.height
      );
    }

    function updateModelPrimitivePose(position) {
      if (!droneModelPrimitive || fallbackSwitched) return;
      try {
        droneModelPrimitive.modelMatrix = buildDroneModelMatrix(position || getCurrentDronePosition());
      } catch (error) {
        console.warn("[Drone] failed to update model primitive pose:", error);
      }
    }

    function ensureModelPrimitive() {
      if (!useModelPrimitive || !droneModelUri || droneModelPrimitive || droneModelPrimitivePromise || modelLoadFailed) {
        return droneModelPrimitive;
      }

      console.log("[Drone] loading primitive model:", droneModelUri, "with scale:", modelScale);
      const initialPosition = getCurrentDronePosition();
      droneModelPrimitivePromise = Cesium.Model.fromGltfAsync({
        url: droneModelUri,
        modelMatrix: buildDroneModelMatrix(initialPosition),
        scale: modelScale,
        minimumPixelSize: Math.max(60, modelMinPixelSize),
        maximumScale: 5000,
        incrementallyLoadTextures: false,
        runAnimations: false,
        clampAnimations: true,
        backFaceCulling: false,
        color: Cesium.Color.WHITE,
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.0,
        silhouetteColor: Cesium.Color.fromCssColorString("#facc15"),
        silhouetteSize: 0.0
      })
        .then(function (model) {
          droneModelPrimitive = viewer.scene.primitives.add(model);
          droneModelPrimitivePromise = null;
          updateModelPrimitivePose();
          setDroneEntityVisibility();
          viewer?.scene?.requestRender();
          console.log("[Drone] primitive model ready");
          return model;
        })
        .catch(function (error) {
          droneModelPrimitivePromise = null;
          modelLoadFailed = true;
          console.warn("[Drone] primitive model failed:", error);
          switchToFallbackModel("primitiveLoadFailed");
          return null;
        });

      return null;
    }

    function ensureRotorEntities() {
      if (!useProceduralRotors) return;
      if (!viewer || rotorEntities.length || rotorCrossEntities.length || rotorTipEntities.length) return;
      rotorEntities = ROTOR_LAYOUT.map(function (_, idx) {
        return viewer.entities.add({
          id: "__village_drone_rotor_" + idx + "__",
          show: false,
          polyline: {
            positions: [Cesium.Cartesian3.fromRadians(0, 0, 0), Cesium.Cartesian3.fromRadians(0, 0, 0)],
            width: 5,
            material: Cesium.Color.fromCssColorString("#dbeafe").withAlpha(0.95),
            depthFailMaterial: Cesium.Color.fromCssColorString("#dbeafe").withAlpha(0.95),
            clampToGround: false
          }
        });
      });

      rotorCrossEntities = ROTOR_LAYOUT.map(function (_, idx) {
        return viewer.entities.add({
          id: "__village_drone_rotor_cross_" + idx + "__",
          show: false,
          polyline: {
            positions: [Cesium.Cartesian3.fromRadians(0, 0, 0), Cesium.Cartesian3.fromRadians(0, 0, 0)],
            width: 4,
            material: Cesium.Color.fromCssColorString("#93c5fd").withAlpha(0.88),
            depthFailMaterial: Cesium.Color.fromCssColorString("#93c5fd").withAlpha(0.88),
            clampToGround: false
          }
        });
      });

      // Keep legacy array empty so previous cleanup loops remain safe.
      rotorTipEntities = [];
    }

    function setDroneEntityVisibility() {
      if (!droneEntity) return;
      const eligible = !!canActivate();
      const setRotorShow = function (show) {
        if (!useProceduralRotors) return;
        rotorEntities.forEach(function (entity) { entity.show = !!show; });
        rotorCrossEntities.forEach(function (entity) { entity.show = !!show; });
      };
      const setModelShow = function (show) {
        if (droneModelPrimitive) droneModelPrimitive.show = !!show;
        if (droneEntity?.model) droneEntity.show = !!show;
        else droneEntity.show = false;
      };
      if (!eligible) {
        setModelShow(false);
        setRotorShow(false);
        return;
      }
      if (!active) {
        setModelShow(true);
        setRotorShow(false);
        return;
      }
      const showDroneBody = cameraMode !== "first" || showModelInFirstPerson;
      setModelShow(showDroneBody);
      setRotorShow(showDroneBody);
    }

    function updateRotorVisuals() {
      if (!useProceduralRotors) return;
      if (!bodyCartographic || !rotorEntities.length) return;
      for (let i = 0; i < rotorEntities.length; i += 1) {
        const rotor = ROTOR_LAYOUT[i];
        const centerOffset = computeEastNorthOffset(rotor.right, rotor.forward, heading);
        const centerCarto = offsetCartographic(
          bodyCartographic,
          centerOffset.east,
          centerOffset.north,
          ROTOR_HEIGHT_METERS
        );

        const angle = heading + rotor.phase + rotor.sign * rotorSpinRadians;
        const aOffset = computeEastNorthOffset(0, ROTOR_RADIUS_METERS, angle);
        const bOffset = computeEastNorthOffset(0, -ROTOR_RADIUS_METERS, angle);

        const aCarto = offsetCartographic(centerCarto, aOffset.east, aOffset.north, 0);
        const bCarto = offsetCartographic(centerCarto, bOffset.east, bOffset.north, 0);

        rotorEntities[i].polyline.positions = [
          Cesium.Cartesian3.fromRadians(aCarto.longitude, aCarto.latitude, aCarto.height),
          Cesium.Cartesian3.fromRadians(bCarto.longitude, bCarto.latitude, bCarto.height)
        ];
        if (rotorCrossEntities[i]) {
          const cOffset = computeEastNorthOffset(ROTOR_RADIUS_METERS, 0, angle);
          const dOffset = computeEastNorthOffset(-ROTOR_RADIUS_METERS, 0, angle);
          const cCarto = offsetCartographic(centerCarto, cOffset.east, cOffset.north, 0);
          const dCarto = offsetCartographic(centerCarto, dOffset.east, dOffset.north, 0);
          rotorCrossEntities[i].polyline.positions = [
            Cesium.Cartesian3.fromRadians(cCarto.longitude, cCarto.latitude, cCarto.height),
            Cesium.Cartesian3.fromRadians(dCarto.longitude, dCarto.latitude, dCarto.height)
          ];
        }
      }
    }

    function findModelVisualizerEntry() {
      const visualizers = viewer?.dataSourceDisplay?.defaultDataSource?._visualizers;
      if (!Array.isArray(visualizers) || !droneEntity?.id) return null;
      for (let i = 0; i < visualizers.length; i += 1) {
        const hash = visualizers[i]?._modelHash;
        if (hash && hash[droneEntity.id]) return hash[droneEntity.id];
      }
      return null;
    }

    function switchToFallbackModel(reason) {
      if (fallbackSwitched) return;
      fallbackSwitched = true;
      useProceduralRotors = true;
      ensureRotorEntities();
      if (droneModelPrimitive) {
        try { viewer.scene.primitives.remove(droneModelPrimitive); } catch (e) {}
        droneModelPrimitive = null;
      }
      if (!droneEntity) ensureDroneEntity();
      droneEntity.model = {
        uri: FALLBACK_MODEL_URI,
        scale: FALLBACK_MODEL_SCALE,
        runAnimations: false,
        clampAnimations: false,
        minimumPixelSize: Math.max(80, modelMinPixelSize),
        maximumScale: 5000
      };
      modelAnimationStarted = false;
      console.warn("[Drone] fallback model enabled:", reason);
      viewer?.scene?.requestRender();
    }

    function startConfiguredModelAnimation(modelPrimitive) {
      if (modelAnimationStarted || fallbackSwitched || !modelPrimitive || !modelAnimationName) return;
      if (!modelPrimitive.ready) return;
      const animations = modelPrimitive.activeAnimations;
      if (!animations || typeof animations.add !== "function") return;
      try {
        if (typeof animations.removeAll === "function") animations.removeAll();
        animations.add({
          name: modelAnimationName,
          loop: Cesium.ModelAnimationLoop.REPEAT
        });
        modelAnimationStarted = true;
        console.log("[Drone] animation started:", modelAnimationName);
      } catch (error) {
        console.warn("[Drone] failed to start animation:", modelAnimationName, error);
      }
    }

    function monitorModelHealth() {
      if (!active || fallbackSwitched) return;
      if (useModelPrimitive) {
        if (droneModelPrimitive?.ready) {
          startConfiguredModelAnimation(droneModelPrimitive);
          return;
        }
        if (modelLoadFailed) {
          switchToFallbackModel("primitiveLoadFailed");
          return;
        }
        if (activationStartedAtMs > 0 && Date.now() - activationStartedAtMs > MODEL_READY_TIMEOUT_MS) {
          switchToFallbackModel("primitiveModelNotReadyTimeout");
        }
        return;
      }
      const entry = findModelVisualizerEntry();
      if (entry?.modelPrimitive?.ready) {
        startConfiguredModelAnimation(entry.modelPrimitive);
        return;
      }
      if (entry?.loadFailed) {
        switchToFallbackModel("loadFailed");
        return;
      }
      if (activationStartedAtMs > 0 && Date.now() - activationStartedAtMs > MODEL_READY_TIMEOUT_MS) {
        switchToFallbackModel("modelNotReadyTimeout");
      }
    }

    function syncCameraPose() {
      if (!bodyCartographic) return;

      let cameraCartographic = null;
      let lookCartographic = null;

      if (cameraMode === "first") {
        const firstOffset = computeEastNorthOffset(0, firstPersonForwardMeters, heading);
        cameraCartographic = offsetCartographic(
          bodyCartographic,
          firstOffset.east,
          firstOffset.north,
          firstPersonHeightMeters
        );

        const firstLookOffset = computeEastNorthOffset(0, firstPersonLookAheadMeters, heading);
        const firstLookUpMeters = firstPersonHeightMeters + Math.tan(pitch) * firstPersonLookAheadMeters;
        lookCartographic = offsetCartographic(
          bodyCartographic,
          firstLookOffset.east,
          firstLookOffset.north,
          firstLookUpMeters
        );
      } else {
        // MC-like third-person chase: orbit around drone with pitch + yaw.
        const thirdPitch = clamp(pitch, THIRD_PERSON_MIN_PITCH, THIRD_PERSON_MAX_PITCH);
        const horizontalBackMeters = cameraBackDistanceMeters * Math.cos(thirdPitch);
        const verticalOffsetMeters = cameraHeightMeters - cameraBackDistanceMeters * Math.sin(thirdPitch);
        const cameraOffset = computeEastNorthOffset(cameraSideMeters, -horizontalBackMeters, heading);
        cameraCartographic = offsetCartographic(
          bodyCartographic,
          cameraOffset.east,
          cameraOffset.north,
          verticalOffsetMeters
        );

        // Third-person must always keep drone body in frame (MC-like), so
        // the look target is anchored on the drone itself instead of a far look-ahead point.
        lookCartographic = offsetCartographic(
          bodyCartographic,
          0,
          0,
          lookHeightMeters
        );
      }

      const cameraPosition = Cesium.Cartesian3.fromRadians(
        cameraCartographic.longitude,
        cameraCartographic.latitude,
        cameraCartographic.height
      );
      const lookTarget = Cesium.Cartesian3.fromRadians(
        lookCartographic.longitude,
        lookCartographic.latitude,
        lookCartographic.height
      );

      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(lookTarget, cameraPosition, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );

      let up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(cameraPosition, new Cesium.Cartesian3());
      let right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitudeSquared(right) < 1e-8) {
        up = new Cesium.Cartesian3(0, 0, 1);
        right = Cesium.Cartesian3.cross(direction, up, right);
      }
      right = Cesium.Cartesian3.normalize(right, right);
      up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());

      viewer.camera.setView({ destination: cameraPosition, orientation: { direction: direction, up: up } });
      viewer.scene?.requestRender();
    }

    function commitPose(syncCamera) {
      if (!bodyCartographic) return;
      const fallbackGround = Number.isFinite(bodyCartographic.height) ? Math.max(0, bodyCartographic.height - MIN_DRONE_HEIGHT) : 0;
      const groundHeight = resolveGroundHeight(viewer, bodyCartographic, fallbackGround);
      const minAllowedHeight = groundHeight + MIN_DRONE_HEIGHT;
      const maxAllowedHeight = Math.max(groundHeight + MAX_DRONE_HEIGHT, minAllowedHeight);
      bodyCartographic.height = clamp(bodyCartographic.height, minAllowedHeight, maxAllowedHeight);

      const dronePosition = Cesium.Cartesian3.fromRadians(bodyCartographic.longitude, bodyCartographic.latitude, bodyCartographic.height);
      if (droneEntity) {
        droneEntity.position = dronePosition;
        // Keep drone body stable: follow yaw only, decouple camera pitch from model pitch.
        droneEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
          dronePosition,
          new Cesium.HeadingPitchRoll(heading, 0, 0)
        );
      }
      updateModelPrimitivePose(dronePosition);
      updateRotorVisuals();
      setDroneEntityVisibility();
      if (syncCamera) syncCameraPose();
    }

    function placeAt(cartographic, syncCamera) {
      if (!cartographic) return false;
      bodyCartographic = cloneCartographic(cartographic);
      if (!bodyCartographic) return false;
      const spawnBaseHeight = Number.isFinite(cartographic.height) ? Math.max(0, cartographic.height) : 0;
      const groundHeight = resolveGroundHeight(viewer, bodyCartographic, spawnBaseHeight);
      bodyCartographic.height = Math.max(groundHeight + initialHeight, spawnBaseHeight + 2.0);
      hasPlacement = true;
      commitPose(syncCamera);
      setDroneEntityVisibility();
      viewer?.scene?.requestRender();
      return true;
    }

    function ensurePlacement(syncCamera) {
      if (bodyCartographic) {
        commitPose(syncCamera);
        return true;
      }
      const spawn = cloneCartographic(getSpawnCartographic());
      if (spawn) return placeAt(spawn, syncCamera);
      const fallback = cloneCartographic(viewer.camera?.positionCartographic);
      if (fallback) return placeAt(fallback, syncCamera);
      return false;
    }

    function requestPointerLock() {
      if (!active) return;
      if (document.pointerLockElement === canvas) return;
      if (typeof canvas.requestPointerLock === "function") {
        try { canvas.requestPointerLock(); } catch (e) {}
      }
    }

    function releasePointerLock() {
      if (document.pointerLockElement !== canvas) return;
      if (typeof document.exitPointerLock === "function") {
        try { document.exitPointerLock(); } catch (e) {}
      }
    }

    function resetKeyState() {
      Object.keys(keyState).forEach(function (k) { keyState[k] = false; });
    }

    function toggleCameraMode(nextMode) {
      const resolvedMode = nextMode === "first" || nextMode === "third"
        ? nextMode
        : (cameraMode === "third" ? "first" : "third");
      if (resolvedMode === cameraMode) return emitStatus();
      cameraMode = resolvedMode;
      if (hasPlacement) {
        commitPose(true);
      } else {
        setDroneEntityVisibility();
      }
      viewer?.scene?.requestRender();
      return emitStatus();
    }

    function onKeyDown(event) {
      if (!active) return;
      if (isTypingElement(event.target)) return;
      if (event.code === "KeyV") {
        toggleCameraMode();
        event.preventDefault();
        return;
      }
      if (event.code in keyState) {
        keyState[event.code] = true;
        event.preventDefault();
      }
    }

    function onKeyUp(event) {
      if (!(event.code in keyState)) return;
      keyState[event.code] = false;
      if (active) event.preventDefault();
    }

    function onMouseMove(event) {
      if (!active) return;
      if (document.pointerLockElement !== canvas) return;
      heading += event.movementX * mouseSensitivity;
      pitch = clamp(pitch - event.movementY * mouseSensitivity, MIN_PITCH, MAX_PITCH);
      commitPose(true);
      viewer?.scene?.requestRender();
    }

    function onMouseWheel(event) {
      if (!active) return;
      if (cameraMode !== "third") return;
      const direction = event.deltaY > 0 ? 1 : -1;
      if (!Number.isFinite(direction) || direction === 0) return;
      const nextDistance = clamp(
        cameraBackDistanceMeters + direction * thirdPersonZoomStepMeters,
        thirdPersonMinBackMeters,
        thirdPersonMaxBackMeters
      );
      if (Math.abs(nextDistance - cameraBackDistanceMeters) < 1e-6) {
        event.preventDefault();
        return;
      }
      cameraBackDistanceMeters = nextDistance;
      commitPose(true);
      emitStatus();
      event.preventDefault();
    }

    function onPointerLockChange() {
      pointerLocked = document.pointerLockElement === canvas;
      emitStatus();
    }

    function onCanvasClick() {
      if (!active) return;
      if (document.pointerLockElement !== canvas) requestPointerLock();
    }

    function bindActiveListeners() {
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("keyup", onKeyUp, true);
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("wheel", onMouseWheel, wheelListenerOptions);
      document.addEventListener("pointerlockchange", onPointerLockChange, true);
      window.addEventListener("blur", resetKeyState, true);
      canvas.addEventListener("click", onCanvasClick, true);
    }

    function unbindActiveListeners() {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("wheel", onMouseWheel, wheelListenerOptions);
      document.removeEventListener("pointerlockchange", onPointerLockChange, true);
      window.removeEventListener("blur", resetKeyState, true);
      canvas.removeEventListener("click", onCanvasClick, true);
    }

    function applyMovement(deltaSeconds) {
      const forwardAxis = (keyState.KeyW ? 1 : 0) + (keyState.KeyS ? -1 : 0);
      const strafeAxis = (keyState.KeyD ? 1 : 0) + (keyState.KeyA ? -1 : 0);
      const verticalAxis = (keyState.Space ? 1 : 0) + (keyState.ControlLeft || keyState.ControlRight ? -1 : 0);

      let speed = moveSpeedMps;
      let vertSpeed = verticalSpeedMps;
      if (keyState.ShiftLeft || keyState.ShiftRight) {
        speed *= sprintMultiplier;
        vertSpeed *= sprintMultiplier;
      }

      if (forwardAxis !== 0 || strafeAxis !== 0) {
        const axisLength = Math.hypot(forwardAxis, strafeAxis) || 1;
        const normalizedForward = forwardAxis / axisLength;
        const normalizedStrafe = strafeAxis / axisLength;
        const moveForwardMeters = normalizedForward * speed * deltaSeconds;
        const moveRightMeters = normalizedStrafe * speed * deltaSeconds;
        const moveOffset = computeEastNorthOffset(moveRightMeters, moveForwardMeters, heading);
        const moved = offsetCartographic(bodyCartographic, moveOffset.east, moveOffset.north, 0);
        bodyCartographic.longitude = moved.longitude;
        bodyCartographic.latitude = moved.latitude;
      }

      if (verticalAxis !== 0) {
        bodyCartographic.height += verticalAxis * vertSpeed * deltaSeconds;
      }
    }

    function runFrame(timestamp) {
      if (!active) {
        rafId = 0;
        return;
      }
      if (!is3DViewActive() || !canActivate()) {
        deactivate();
        return;
      }
      if (!ensurePlacement(false)) {
        rafId = requestAnimationFrame(runFrame);
        return;
      }
      const deltaSeconds = lastFrameTs ? Math.min(0.05, Math.max(0.001, (timestamp - lastFrameTs) / 1000)) : 1 / 60;
      lastFrameTs = timestamp;
      if (useProceduralRotors) {
        rotorSpinRadians = (rotorSpinRadians + deltaSeconds * ROTOR_SPIN_RATE_RAD_PER_SEC) % TAU;
      }
      applyMovement(deltaSeconds);
      commitPose(true);
      monitorModelHealth();
      viewer?.scene?.requestRender();
      rafId = requestAnimationFrame(runFrame);
    }

    function startLoop() {
      if (rafId) return;
      lastFrameTs = 0;
      rafId = requestAnimationFrame(runFrame);
    }

    function stopLoop() {
      if (!rafId) return;
      cancelAnimationFrame(rafId);
      rafId = 0;
      lastFrameTs = 0;
    }

    function activate() {
      if (active) return emitStatus();
      if (!canActivate()) return emitStatus({ active: false });
      ensureDroneEntity();
      if (!hasPlacement) ensurePlacement(false);
      heading = Number.isFinite(viewer.camera?.heading) ? viewer.camera.heading : heading;
      pitch = clamp(Number.isFinite(viewer.camera?.pitch) ? viewer.camera.pitch : pitch, MIN_PITCH, MAX_PITCH);
      active = true;
      activationStartedAtMs = Date.now();
      setDroneEntityVisibility();
      setCesiumCameraControlsEnabled(false);
      bindActiveListeners();
      startLoop();
      requestPointerLock();
      return emitStatus();
    }

    function deactivate() {
      if (!active) {
        setDroneEntityVisibility();
        return emitStatus({ active: false });
      }
      active = false;
      activationStartedAtMs = 0;
      stopLoop();
      resetKeyState();
      releasePointerLock();
      unbindActiveListeners();
      setCesiumCameraControlsEnabled(true);
      pointerLocked = false;
      setDroneEntityVisibility();
      viewer?.scene?.requestRender();
      return emitStatus({ active: false });
    }

    function syncSpace(options) {
      options = options || {};
      const eligible = !!canActivate();
      ensureDroneEntity();
      if (!eligible) {
        if (active) deactivate();
        if (droneEntity) droneEntity.show = false;
        return emitStatus({ active: false });
      }
      const shouldReposition = !!options.reposition || !hasPlacement;
      if (shouldReposition) {
        ensurePlacement(false);
      } else {
        commitPose(false);
      }
      setDroneEntityVisibility();
      viewer?.scene?.requestRender();
      return emitStatus();
    }

    function destroy() {
      deactivate();
      unbindActiveListeners();
      stopLoop();
      releasePointerLock();
      setCesiumCameraControlsEnabled(true);
      if (viewer && droneEntity) {
        try { viewer.entities.remove(droneEntity); } catch (e) {}
      }
      if (viewer && droneModelPrimitive) {
        try { viewer.scene.primitives.remove(droneModelPrimitive); } catch (e) {}
      }
      rotorEntities.forEach(function (entity) {
        if (!viewer || !entity) return;
        try { viewer.entities.remove(entity); } catch (e) {}
      });
      rotorCrossEntities.forEach(function (entity) {
        if (!viewer || !entity) return;
        try { viewer.entities.remove(entity); } catch (e) {}
      });
      rotorTipEntities.forEach(function (entity) {
        if (!viewer || !entity) return;
        try { viewer.entities.remove(entity); } catch (e) {}
      });
      rotorEntities = [];
      rotorCrossEntities = [];
      rotorTipEntities = [];
      droneModelPrimitive = null;
      droneModelPrimitivePromise = null;
      droneEntity = null;
      bodyCartographic = null;
      hasPlacement = false;
      activationStartedAtMs = 0;
      controllerBackup = null;
    }

    return {
      activate: activate,
      deactivate: deactivate,
      destroy: destroy,
      syncSpace: syncSpace,
      toggleCameraMode: toggleCameraMode,
      getCameraMode: function () { return cameraMode; },
      isActive: function () { return active; }
    };
  }

  window.VillageDroneModule = {
    createController: createController
  };
})();
