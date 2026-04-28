(function () {
  const DEFAULT_MODEL_URI =
    "https://cdn.jsdelivr.net/gh/CesiumGS/cesium@1.118/Apps/SampleData/models/CesiumMan/Cesium_Man.glb";

  const DEFAULT_MOVE_SPEED_MPS = 2.8;
  const DEFAULT_SPRINT_MULTIPLIER = 1.7;
  const DEFAULT_MOUSE_SENSITIVITY = 0.0022;

  const DEFAULT_CAMERA_BACK_METERS = 4.6;
  const DEFAULT_CAMERA_RIGHT_METERS = 1.05;
  const DEFAULT_CAMERA_HEIGHT_METERS = 2.1;
  const DEFAULT_LOOK_AHEAD_METERS = 8.0;
  const DEFAULT_LOOK_HEIGHT_METERS = 1.6;
  const DEFAULT_LOOK_RIGHT_METERS = 0.35;

  const MIN_PITCH = Cesium.Math.toRadians(-65);
  const MAX_PITCH = Cesium.Math.toRadians(35);
  const RADIUS_METERS = Cesium.Ellipsoid.WGS84.maximumRadius;

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

  function resolveGroundHeight(viewer, cartographic) {
    if (!viewer || !cartographic) return 0;
    const globe = viewer.scene?.globe;
    if (!globe || typeof globe.getHeight !== "function") return 0;
    const sampled = globe.getHeight(new Cesium.Cartographic(cartographic.longitude, cartographic.latitude, 0));
    return Number.isFinite(sampled) ? Math.max(0, sampled) : 0;
  }

  function computeEastNorthOffset(localRightMeters, localForwardMeters, headingRad) {
    return {
      east: localRightMeters * Math.cos(headingRad) + localForwardMeters * Math.sin(headingRad),
      north: -localRightMeters * Math.sin(headingRad) + localForwardMeters * Math.cos(headingRad)
    };
  }

  function offsetCartographic(base, eastMeters, northMeters, upMeters) {
    const lat = clamp(
      base.latitude + northMeters / RADIUS_METERS,
      Cesium.Math.toRadians(-89.5),
      Cesium.Math.toRadians(89.5)
    );
    const cosLat = Math.max(1e-6, Math.cos(lat));
    const lon = base.longitude + eastMeters / (RADIUS_METERS * cosLat);
    const height = Math.max(0, (Number.isFinite(base.height) ? base.height : 0) + upMeters);
    return new Cesium.Cartographic(lon, lat, height);
  }

  function createController(options = {}) {
    const viewer = options.viewer;
    if (!viewer || typeof Cesium === "undefined") {
      throw new Error("VillageFirstPersonModule requires a valid Cesium viewer.");
    }

    const canvas = viewer.scene?.canvas;
    if (!canvas) {
      throw new Error("VillageFirstPersonModule cannot find viewer.scene.canvas.");
    }

    const getSpawnCartographic =
      typeof options.getSpawnCartographic === "function"
        ? options.getSpawnCartographic
        : () => cloneCartographic(viewer.camera?.positionCartographic);
    const canActivate = typeof options.canActivate === "function" ? options.canActivate : () => true;
    const is3DViewActive = typeof options.is3DViewActive === "function" ? options.is3DViewActive : () => true;
    const onStatusChange = typeof options.onStatusChange === "function" ? options.onStatusChange : null;

    const moveSpeedMps = Math.max(0.5, toSafeNumber(options.moveSpeedMps, DEFAULT_MOVE_SPEED_MPS));
    const sprintMultiplier = Math.max(1, toSafeNumber(options.sprintMultiplier, DEFAULT_SPRINT_MULTIPLIER));
    const mouseSensitivity = Math.max(0.0004, toSafeNumber(options.mouseSensitivity, DEFAULT_MOUSE_SENSITIVITY));

    const cameraBackMeters = Math.max(1.8, toSafeNumber(options.cameraBackMeters, DEFAULT_CAMERA_BACK_METERS));
    const cameraRightMeters = toSafeNumber(options.cameraRightMeters, DEFAULT_CAMERA_RIGHT_METERS);
    const cameraHeightMeters = Math.max(0.8, toSafeNumber(options.cameraHeightMeters, DEFAULT_CAMERA_HEIGHT_METERS));
    const lookAheadMeters = Math.max(2, toSafeNumber(options.lookAheadMeters, DEFAULT_LOOK_AHEAD_METERS));
    const lookHeightMeters = Math.max(0.5, toSafeNumber(options.lookHeightMeters, DEFAULT_LOOK_HEIGHT_METERS));
    const lookRightMeters = toSafeNumber(options.lookRightMeters, DEFAULT_LOOK_RIGHT_METERS);

    const characterModelUri = String(options.characterModelUri || DEFAULT_MODEL_URI).trim();

    let characterEntity = null;
    let bodyCartographic = null;
    let heading = Number.isFinite(viewer.camera?.heading) ? viewer.camera.heading : 0;
    let pitch = clamp(
      Number.isFinite(viewer.camera?.pitch) ? viewer.camera.pitch : Cesium.Math.toRadians(-12),
      MIN_PITCH,
      MAX_PITCH
    );

    let active = false;
    let pointerLocked = false;
    let hasPlacement = false;
    let rafId = 0;
    let lastFrameTs = 0;

    let controllerBackup = null;

    const keyState = {
      KeyW: false,
      KeyA: false,
      KeyS: false,
      KeyD: false,
      ShiftLeft: false,
      ShiftRight: false
    };

    function buildHintMessage(eligible, activeMode, locked) {
      if (!eligible) {
        return "Current space is planning mode. Shoulder camera is only available in base/current space.";
      }
      if (activeMode) {
        if (locked) {
          return "Shoulder camera active: W/A/S/D move, mouse look, Shift sprint, Esc unlock pointer.";
        }
        return "Shoulder camera enabled: click the 3D canvas to lock pointer and control the camera.";
      }
      return "Tip: click the character button to enter shoulder camera mode.";
    }

    function emitStatus(extra = {}) {
      const eligible = !!canActivate();
      const status = {
        active,
        eligible,
        pointerLocked,
        message: buildHintMessage(eligible, active, pointerLocked),
        ...extra
      };
      if (onStatusChange) {
        onStatusChange(status);
      }
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

    function ensureCharacterEntity() {
      if (characterEntity || !viewer) return characterEntity;

      const entityConfig = {
        id: "__village_first_person_character__",
        show: false,
        position: Cesium.Cartesian3.fromRadians(0, 0, 0),
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.fromRadians(0, 0, 0),
          new Cesium.HeadingPitchRoll(0, 0, 0)
        ),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(1.5, 6000)
      };

      if (characterModelUri) {
        entityConfig.model = {
          uri: characterModelUri,
          scale: 1.0,
          minimumPixelSize: 32,
          maximumScale: 2.0,
          runAnimations: true
        };
      } else {
        entityConfig.ellipsoid = {
          radii: new Cesium.Cartesian3(0.35, 0.35, 0.95),
          material: Cesium.Color.fromCssColorString("#2f6928").withAlpha(0.88),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.95)
        };
      }

      characterEntity = viewer.entities.add(entityConfig);
      return characterEntity;
    }

    function syncCameraPose(playerPosition) {
      const cameraOffset = computeEastNorthOffset(cameraRightMeters, -cameraBackMeters, heading);
      const cameraCartographic = offsetCartographic(
        bodyCartographic,
        cameraOffset.east,
        cameraOffset.north,
        cameraHeightMeters
      );
      const cameraPosition = Cesium.Cartesian3.fromRadians(
        cameraCartographic.longitude,
        cameraCartographic.latitude,
        cameraCartographic.height
      );

      const lookOffset = computeEastNorthOffset(lookRightMeters, lookAheadMeters, heading);
      const lookUpMeters = lookHeightMeters + Math.tan(pitch) * lookAheadMeters;
      const lookCartographic = offsetCartographic(
        bodyCartographic,
        lookOffset.east,
        lookOffset.north,
        lookUpMeters
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
      up = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );

      viewer.camera.setView({
        destination: cameraPosition,
        orientation: {
          direction,
          up
        }
      });
      viewer.scene?.requestRender();
    }

    function commitPose(syncCamera) {
      if (!bodyCartographic) return;

      const groundHeight = resolveGroundHeight(viewer, bodyCartographic);
      bodyCartographic.height = Number.isFinite(groundHeight) ? groundHeight : bodyCartographic.height;

      const playerPosition = Cesium.Cartesian3.fromRadians(
        bodyCartographic.longitude,
        bodyCartographic.latitude,
        bodyCartographic.height
      );

      if (characterEntity) {
        characterEntity.position = playerPosition;
        characterEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
          playerPosition,
          new Cesium.HeadingPitchRoll(heading, 0, 0)
        );
      }

      if (syncCamera) {
        syncCameraPose(playerPosition);
      }
    }

    function placeAt(cartographic, syncCamera = false) {
      if (!cartographic) return false;
      bodyCartographic = cloneCartographic(cartographic);
      if (!bodyCartographic) return false;
      hasPlacement = true;
      commitPose(syncCamera);
      if (characterEntity) {
        characterEntity.show = !!canActivate();
      }
      viewer?.scene?.requestRender();
      return true;
    }

    function ensurePlacement(syncCamera = false) {
      if (bodyCartographic) {
        commitPose(syncCamera);
        return true;
      }

      const spawn = cloneCartographic(getSpawnCartographic());
      if (spawn) {
        return placeAt(spawn, syncCamera);
      }

      const fallback = cloneCartographic(viewer.camera?.positionCartographic);
      if (fallback) {
        return placeAt(fallback, syncCamera);
      }

      return false;
    }

    function requestPointerLock() {
      if (!active) return;
      if (document.pointerLockElement === canvas) return;
      if (typeof canvas.requestPointerLock === "function") {
        try {
          canvas.requestPointerLock();
        } catch (_) {}
      }
    }

    function releasePointerLock() {
      if (document.pointerLockElement !== canvas) return;
      if (typeof document.exitPointerLock === "function") {
        try {
          document.exitPointerLock();
        } catch (_) {}
      }
    }

    function resetKeyState() {
      Object.keys(keyState).forEach((key) => {
        keyState[key] = false;
      });
    }

    function onKeyDown(event) {
      if (!active) return;
      if (isTypingElement(event.target)) return;
      if (event.code in keyState) {
        keyState[event.code] = true;
        event.preventDefault();
      }
    }

    function onKeyUp(event) {
      if (!(event.code in keyState)) return;
      keyState[event.code] = false;
      if (active) {
        event.preventDefault();
      }
    }

    function onMouseMove(event) {
      if (!active) return;
      if (document.pointerLockElement !== canvas) return;

      heading += event.movementX * mouseSensitivity;
      pitch = clamp(pitch - event.movementY * mouseSensitivity, MIN_PITCH, MAX_PITCH);

      commitPose(true);
      viewer?.scene?.requestRender();
    }

    function onPointerLockChange() {
      pointerLocked = document.pointerLockElement === canvas;
      emitStatus();
    }

    function onCanvasClick() {
      if (!active) return;
      if (document.pointerLockElement !== canvas) {
        requestPointerLock();
      }
    }

    function bindActiveListeners() {
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("keyup", onKeyUp, true);
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("pointerlockchange", onPointerLockChange, true);
      window.addEventListener("blur", resetKeyState, true);
      canvas.addEventListener("click", onCanvasClick, true);
    }

    function unbindActiveListeners() {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("pointerlockchange", onPointerLockChange, true);
      window.removeEventListener("blur", resetKeyState, true);
      canvas.removeEventListener("click", onCanvasClick, true);
    }

    function applyMovement(deltaSeconds) {
      const forwardAxis = (keyState.KeyW ? 1 : 0) + (keyState.KeyS ? -1 : 0);
      const strafeAxis = (keyState.KeyD ? 1 : 0) + (keyState.KeyA ? -1 : 0);
      if (!forwardAxis && !strafeAxis) return;

      let speed = moveSpeedMps;
      if (keyState.ShiftLeft || keyState.ShiftRight) {
        speed *= sprintMultiplier;
      }

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

      applyMovement(deltaSeconds);
      commitPose(true);

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
      if (active) {
        return emitStatus();
      }

      if (!canActivate()) {
        return emitStatus({ active: false });
      }

      ensureCharacterEntity();
      if (!hasPlacement) {
        ensurePlacement(false);
      }

      heading = Number.isFinite(viewer.camera?.heading) ? viewer.camera.heading : heading;
      pitch = clamp(Number.isFinite(viewer.camera?.pitch) ? viewer.camera.pitch : pitch, MIN_PITCH, MAX_PITCH);

      active = true;
      if (characterEntity) {
        characterEntity.show = true;
      }

      setCesiumCameraControlsEnabled(false);
      bindActiveListeners();
      startLoop();
      requestPointerLock();
      return emitStatus();
    }

    function deactivate() {
      if (!active) {
        if (characterEntity) {
          characterEntity.show = !!canActivate();
        }
        return emitStatus({ active: false });
      }

      active = false;
      stopLoop();
      resetKeyState();
      releasePointerLock();
      unbindActiveListeners();
      setCesiumCameraControlsEnabled(true);
      pointerLocked = false;

      if (characterEntity) {
        characterEntity.show = !!canActivate();
      }
      viewer?.scene?.requestRender();

      return emitStatus({ active: false });
    }

    function syncSpace(options = {}) {
      const eligible = !!canActivate();
      ensureCharacterEntity();

      if (!eligible) {
        if (active) {
          deactivate();
        }
        if (characterEntity) {
          characterEntity.show = false;
        }
        return emitStatus({ active: false });
      }

      const shouldReposition = !!options.reposition || !hasPlacement;
      if (shouldReposition) {
        ensurePlacement(false);
      } else {
        commitPose(false);
      }

      if (characterEntity) {
        characterEntity.show = true;
      }
      viewer?.scene?.requestRender();
      return emitStatus();
    }

    function destroy() {
      deactivate();
      unbindActiveListeners();
      stopLoop();
      releasePointerLock();
      setCesiumCameraControlsEnabled(true);

      if (viewer && characterEntity) {
        try {
          viewer.entities.remove(characterEntity);
        } catch (_) {}
      }
      characterEntity = null;
      bodyCartographic = null;
      hasPlacement = false;
      controllerBackup = null;
    }

    return {
      activate,
      deactivate,
      destroy,
      syncSpace,
      isActive: () => active
    };
  }

  window.VillageFirstPersonModule = {
    createController
  };
})();
