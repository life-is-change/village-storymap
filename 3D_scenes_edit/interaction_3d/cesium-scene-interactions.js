(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./cesium-ground-picker") : root.CesiumGroundPickerModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CesiumSceneInteractionsModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GroundPicker) {
  function createCesiumSceneInteractions(options) {
    const { Cesium, viewer } = options || {};
    const pickGround = options?.pickGround || ((screenPosition) => GroundPicker.pickGroundDegrees({ Cesium, viewer, screenPosition }));
    const previewPickGround = options?.previewPickGround || options?.pickGround || ((screenPosition) => GroundPicker.pickGroundDegrees({ Cesium, viewer, screenPosition, skipDepth: true }));
    const eventTypes = Cesium.ScreenSpaceEventType;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    const vertices = [];
    let activeTool = null;
    const previewEntities = [];
    let disposed = false;
    let currentAsset = null;
    let currentDocument = null;
    let dragId = null;
    let dragCoordinate = null;
    let boundaryEditOriginal = null;
    let selectedBoundaryVertex = null;
    let editedRoadId = null, roadGeometry = null, selectedRoadVertex = null, roadDragging = false, roadChanged = false, skipRoadClick = false;
    let moveStart = null, moveGeometry = null;
    const requestFrame = options?.requestAnimationFrame || globalThis.requestAnimationFrame?.bind(globalThis) || ((callback) => { callback(); return null; });
    const cancelFrame = options?.cancelAnimationFrame || globalThis.cancelAnimationFrame?.bind(globalThis) || (() => {});
    const placementPreviewIntervalMs = Math.max(16, Number(options?.placementPreviewIntervalMs) || 60);
    let placementPreviewFrame = null;
    let placementPreviewScheduled = false;
    let pendingPlacementPosition = null;
    let lastPlacementPreviewAt = -Infinity;

    function relativeToGround() {
      return Cesium.HeightReference?.RELATIVE_TO_GROUND;
    }

    function status(message, tone = "info") {
      options?.onStatus?.({ message, tone, tool: activeTool });
    }

    function clearActions() {
      for (const type of Object.values(eventTypes)) handler.removeInputAction?.(type);
    }

    function clearPreview() {
      while (previewEntities.length) viewer.entities.remove(previewEntities.pop());
    }

    function restoreCamera() {
      if (viewer.scene?.screenSpaceCameraController) viewer.scene.screenSpaceCameraController.enableInputs = true;
    }

    function updateBoundaryPreview() {
      clearPreview();
      if (!vertices.length) return;
      vertices.forEach((point, index) => {
        previewEntities.push(viewer.entities.add({
          id: `scene-edit-boundary-vertex-${index + 1}`,
          position: Cesium.Cartesian3.fromDegrees(point[0], point[1], 0.8),
          point: {
            pixelSize: 13,
            color: Cesium.Color.fromCssColorString("#ffb020"),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            disableDepthTestDistance: Infinity,
            heightReference: relativeToGround()
          },
          label: {
            text: String(index + 1),
            font: "700 13px system-ui",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Infinity,
            heightReference: relativeToGround()
          }
        }));
      });
      if (vertices.length < 2) return;
      const previewRing = vertices.length >= 3 ? [...vertices, vertices[0]] : vertices;
      const values = previewRing.flatMap((point) => point.slice(0, 2));
      previewEntities.push(viewer.entities.add({
        id: "scene-edit-boundary-preview",
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(values),
          width: 5,
          clampToGround: true,
          material: Cesium.Color.fromCssColorString("#19d3ff")
        }
      }));
    }

    function cancelPlacementPreview() {
      if (placementPreviewScheduled && placementPreviewFrame !== null) cancelFrame(placementPreviewFrame);
      placementPreviewFrame = null;
      placementPreviewScheduled = false;
      pendingPlacementPosition = null;
      lastPlacementPreviewAt = -Infinity;
    }

    function schedulePlacementPreview(screenPosition) {
      pendingPlacementPosition = screenPosition;
      if (placementPreviewScheduled) return;
      placementPreviewScheduled = true;
      placementPreviewFrame = requestFrame(function runPlacementPreview(frameTime) {
        placementPreviewFrame = null;
        placementPreviewScheduled = false;
        const timestamp = Number.isFinite(frameTime) ? frameTime : null;
        if (timestamp !== null && Number.isFinite(lastPlacementPreviewAt) && timestamp - lastPlacementPreviewAt < placementPreviewIntervalMs) {
          placementPreviewScheduled = true;
          placementPreviewFrame = requestFrame(runPlacementPreview);
          return;
        }
        const latestPosition = pendingPlacementPosition;
        pendingPlacementPosition = null;
        if (activeTool !== "place-asset" || !latestPosition) return;
        const point = previewPickGround(latestPosition);
        if (point) {
          lastPlacementPreviewAt = timestamp === null ? lastPlacementPreviewAt : timestamp;
          options?.previewAdapter?.setGhost?.(currentAsset, point);
        }
      });
    }

    function boundaryPickIndex(picked, prefix) {
      const value = String(picked?.id?.id || picked?.id || "");
      const match = value.match(new RegExp(`^scene-edit-boundary-${prefix}-(\\d+)$`));
      return match ? Number(match[1]) - 1 : -1;
    }

    function updateBoundaryEditPreview() {
      clearPreview();
      if (vertices.length < 2) return;
      vertices.forEach((point, index) => {
        previewEntities.push(viewer.entities.add({
          id: `scene-edit-boundary-handle-${index + 1}`,
          position: Cesium.Cartesian3.fromDegrees(point[0], point[1], 1),
          point: {
            pixelSize: selectedBoundaryVertex === index ? 17 : 14,
            color: Cesium.Color.fromCssColorString(selectedBoundaryVertex === index ? "#ff5f45" : "#ffb020"),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            disableDepthTestDistance: Infinity,
            heightReference: relativeToGround()
          },
          label: {
            text: String(index + 1), font: "700 13px system-ui", fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 4, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity,
            heightReference: relativeToGround()
          }
        }));
        const next = vertices[(index + 1) % vertices.length];
        previewEntities.push(viewer.entities.add({
          id: `scene-edit-boundary-segment-${index + 1}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([point[0], point[1], next[0], next[1]]),
            width: 6, clampToGround: true, material: Cesium.Color.fromCssColorString("#19d3ff")
          }
        }));
      });
    }

    function finishBoundary() {
      const unique = vertices.filter((point, index, values) =>
        values.findIndex((other) => other[0] === point[0] && other[1] === point[1]) === index
      );
      if (unique.length < 3) {
        status("公共空间边界至少需要 3 个点", "warning");
        return false;
      }
      const ring = unique.map((point) => point.slice(0, 2));
      ring.push(ring[0].slice());
      const result = options?.onBoundaryComplete?.({ type: "Polygon", coordinates: [ring] });
      if (result?.ok === false) { status(result.message || '范围未能保存，请调整边界后重试', 'warning'); return false; }
      vertices.length = 0;
      clearPreview();
      status("公共空间边界已确定", "success");
      return true;
    }

    function finishBoundaryEdit() {
      if (activeTool !== "edit-boundary") return false;
      const unique = vertices.filter((point, index, values) => values.findIndex((other) => other[0] === point[0] && other[1] === point[1]) === index);
      if (unique.length < 3) {
        status("公共空间边界至少需要 3 个点", "warning");
        return false;
      }
      const ring = unique.map((point) => point.slice(0, 2));
      ring.push(ring[0].slice());
      const result = options?.onBoundaryComplete?.({ type: "Polygon", coordinates: [ring] });
      if (result?.ok === false) { status(result.message || '范围未能保存，请调整边界后重试', 'warning'); return false; }
      boundaryEditOriginal = ring.map((point) => point.slice());
      vertices.length = 0;
      clearPreview();
      restoreCamera();
      selectedBoundaryVertex = null;
      status("设计范围调整已保存", "success");
      return true;
    }

    function cancelBoundaryEdit() {
      if (activeTool !== "edit-boundary") return false;
      vertices.length = 0;
      if (boundaryEditOriginal) vertices.push(...boundaryEditOriginal.slice(0, -1).map((point) => point.slice()));
      selectedBoundaryVertex = null;
      restoreCamera();
      updateBoundaryEditPreview();
      status("已取消本次范围调整");
      return true;
    }

    function deleteSelectedBoundaryVertex() {
      if (activeTool !== "edit-boundary" || selectedBoundaryVertex === null) return false;
      if (vertices.length <= 3) {
        status("设计范围至少保留 3 个点", "warning");
        return false;
      }
      vertices.splice(selectedBoundaryVertex, 1);
      selectedBoundaryVertex = null;
      updateBoundaryEditPreview();
      status("已删除边界点，完成后保存调整");
      return true;
    }

    function finishGeometry(tool) {
      const minimum = tool === "draw-surface" ? 3 : 2;
      const unique = vertices.filter((point, index, values) => values.findIndex((other) => other[0] === point[0] && other[1] === point[1]) === index);
      if (unique.length < minimum) {
        status(tool === "draw-surface" ? "区域至少需要 3 个点" : "线段至少需要 2 个点", "warning");
        return false;
      }
      const coordinates = unique.map((point) => point.slice(0, 2));
      const geometry = tool === "draw-surface"
        ? { type: "Polygon", coordinates: [[...coordinates, coordinates[0].slice()]] }
        : { type: "LineString", coordinates };
      const result = options?.onCreate?.({ tool, asset: currentAsset, geometry });
      if (result?.ok === false) { status(result.message || '未能创建场地，请检查范围与图层锁定状态', 'warning'); return false; }
      vertices.length = 0;
      clearPreview();
      status(`${currentAsset?.label || currentAsset?.displayName || "要素"}已绘制`, "success");
      return true;
    }

    function editableRoad(id) {
      const road=currentDocument?.objects?.find(o=>o.id===id&&o.kind==='line'&&o.category==='path');
      const layer=currentDocument?.layers?.find(l=>l.id===road?.layerId);
      return road&&layer?.locked!==true&&layer?.visible!==false?road:null;
    }
    const copyLine = geometry => ({type:'LineString',coordinates:geometry.coordinates.map(p=>p.slice())});
    function roadHandleIndex(picked,kind) {
      const id=String(picked?.id?.id||picked?.id||'');const match=id.match(new RegExp('^scene-edit-road-'+kind+'-(\\d+)$'));return match?Number(match[1])-1:-1;
    }
    function showRoadHandles() {
      clearPreview();if(!roadGeometry)return;
      const add=(point,id,label,size)=>previewEntities.push(viewer.entities.add({id,position:Cesium.Cartesian3.fromDegrees(point[0],point[1],.8),point:{pixelSize:size,color:Cesium.Color.fromCssColorString(label?'#ffe082':'#42a5f5'),outlineColor:Cesium.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Infinity,heightReference:relativeToGround()},...(label?{label:{text:label,font:'700 12px system-ui',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,disableDepthTestDistance:Infinity,heightReference:relativeToGround()}}:{})}));
      roadGeometry.coordinates.forEach((p,i)=>{add(p,'scene-edit-road-vertex-'+(i+1),String(i+1),selectedRoadVertex===i?17:13);if(i){const a=roadGeometry.coordinates[i-1];add([(a[0]+p[0])/2,(a[1]+p[1])/2],'scene-edit-road-midpoint-'+i,'',9);}});
    }
    function commitRoad(id,geometry) {
      const result=options?.onGeometryEdit?.({id,geometry:copyLine(geometry)});
      if (!result || result.ok===false) {
        options?.previewAdapter?.resetLinePreview?.(id);
        if(editedRoadId===id){const road=editableRoad(id);roadGeometry=road?copyLine(road.geometry):null;showRoadHandles();}
        status(result?.message||'道路未能修改，请检查范围与图层锁','warning');return false;
      }
      const actual=result.geometry||editableRoad(id)?.geometry||geometry;
      options?.previewAdapter?.previewLineGeometry?.(id,actual,{committed:true});
      if(editedRoadId===id){roadGeometry=copyLine(actual);showRoadHandles();}
      status('道路已更新；可继续编辑，或结束编辑。','success');return true;
    }
    function deleteRoadVertex() {
      if(activeTool!=='edit-road-nodes'||selectedRoadVertex===null||!roadGeometry)return false;
      if(roadGeometry.coordinates.length<=2){status('道路至少保留两个顶点','warning');return false;}
      const next=copyLine(roadGeometry);next.coordinates.splice(selectedRoadVertex,1);
      const ok=commitRoad(editedRoadId,next);if(ok){selectedRoadVertex=Math.min(selectedRoadVertex,next.coordinates.length-1);showRoadHandles();}return ok;
    }

    function activate(tool) {
      if (disposed) return { ok: false, code: "DISPOSED" };
      cancel();
      activeTool = tool || null;
      if (tool === "draw-boundary") {
        handler.setInputAction((event) => {
          const point = pickGround(event.position);
          if (!point) return status("未能定位到地面，请换一个位置", "warning");
          vertices.push(point);
          updateBoundaryPreview();
          status(`已选 ${vertices.length} 个边界点，右键完成`);
        }, eventTypes.LEFT_CLICK);
        handler.setInputAction(finishBoundary, eventTypes.RIGHT_CLICK);
        handler.setInputAction(finishBoundary, eventTypes.LEFT_DOUBLE_CLICK);
        status("请在三维场景中依次点击公共空间边界，右键完成");
      } else if (tool === "edit-boundary") {
        const ring = currentDocument?.selectionBoundary?.coordinates?.[0] || [];
        if (ring.length < 4) {
          status("当前还没有可调整的设计范围", "warning");
          return { ok: false, code: "BOUNDARY_REQUIRED" };
        }
        boundaryEditOriginal = ring.map((point) => point.slice());
        vertices.push(...ring.slice(0, -1).map((point) => point.slice()));
        updateBoundaryEditPreview();
        handler.setInputAction((event) => {
          const index = boundaryPickIndex(viewer.scene.pick?.(event.position), "handle");
          if (index < 0) return;
          selectedBoundaryVertex = index;
          if (viewer.scene?.screenSpaceCameraController) viewer.scene.screenSpaceCameraController.enableInputs = false;
          updateBoundaryEditPreview();
        }, eventTypes.LEFT_DOWN);
        handler.setInputAction((event) => {
          if (selectedBoundaryVertex === null || viewer.scene?.screenSpaceCameraController?.enableInputs !== false) return;
          const point = pickGround(event.endPosition);
          if (!point) return;
          vertices[selectedBoundaryVertex] = point;
          updateBoundaryEditPreview();
        }, eventTypes.MOUSE_MOVE);
        handler.setInputAction(() => {
          restoreCamera();
          if (selectedBoundaryVertex !== null) status(`已移动第 ${selectedBoundaryVertex + 1} 个边界点，完成后保存调整`);
        }, eventTypes.LEFT_UP);
        handler.setInputAction((event) => {
          const picked = viewer.scene.pick?.(event.position);
          const handleIndex = boundaryPickIndex(picked, "handle");
          if (handleIndex >= 0) {
            selectedBoundaryVertex = handleIndex;
            updateBoundaryEditPreview();
            return status(`已选择第 ${handleIndex + 1} 个边界点`);
          }
          const segmentIndex = boundaryPickIndex(picked, "segment");
          if (segmentIndex < 0) return;
          const point = pickGround(event.position);
          if (!point) return status("未能定位到地面，请换一个位置", "warning");
          vertices.splice(segmentIndex + 1, 0, point);
          selectedBoundaryVertex = segmentIndex + 1;
          updateBoundaryEditPreview();
          status(`已在边界边上增加第 ${selectedBoundaryVertex + 1} 个点`);
        }, eventTypes.LEFT_CLICK);
        handler.setInputAction(finishBoundaryEdit, eventTypes.RIGHT_CLICK);
        status("拖动编号点调整范围；点击青色边线增加点，完成后保存");
      } else if (tool === 'edit-road-nodes') {
        const road=(options?.getSelectedIds?.()||[]).map(editableRoad).find(Boolean);
        if(!road){status('请选择一条未锁定且可见的道路','warning');return {ok:false,code:'ROAD_REQUIRED'};}
        editedRoadId=road.id;roadGeometry=copyLine(road.geometry);showRoadHandles();
        handler.setInputAction(event=>{
          skipRoadClick=false;
          const index=roadHandleIndex(viewer.scene.pick?.(event.position),'vertex');if(index<0)return;
          selectedRoadVertex=index;roadDragging=true;roadChanged=false;showRoadHandles();
          if(viewer.scene?.screenSpaceCameraController)viewer.scene.screenSpaceCameraController.enableInputs=false;
        },eventTypes.LEFT_DOWN);
        handler.setInputAction(event=>{
          if(!roadDragging)return;const point=previewPickGround(event.endPosition);if(!point)return;
          const previous=roadGeometry.coordinates[selectedRoadVertex];roadChanged ||= previous[0]!==point[0]||previous[1]!==point[1];
          roadGeometry.coordinates[selectedRoadVertex]=point.slice(0,2);options?.previewAdapter?.previewLineGeometry?.(editedRoadId,roadGeometry);showRoadHandles();
        },eventTypes.MOUSE_MOVE);
        handler.setInputAction(()=>{if(!roadDragging)return;roadDragging=false;restoreCamera();if(roadChanged){skipRoadClick=true;commitRoad(editedRoadId,roadGeometry);}},eventTypes.LEFT_UP);
        handler.setInputAction(event=>{
          if(skipRoadClick){skipRoadClick=false;return;}
          const picked=viewer.scene.pick?.(event.position),index=roadHandleIndex(picked,'vertex');
          if(index>=0){selectedRoadVertex=index;showRoadHandles();return;}
          const midpoint=roadHandleIndex(picked,'midpoint');if(midpoint<0||midpoint>=roadGeometry.coordinates.length-1)return;
          const a=roadGeometry.coordinates[midpoint],b=roadGeometry.coordinates[midpoint+1],next=copyLine(roadGeometry);next.coordinates.splice(midpoint+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);selectedRoadVertex=midpoint+1;commitRoad(editedRoadId,next);
        },eventTypes.LEFT_CLICK);
        status('拖动编号顶点；点击蓝色中点加点；松开保存，结束编辑保留修改。');
      } else if (tool === "draw-line" || tool === "draw-surface") {
        handler.setInputAction((event) => {
          const point = pickGround(event.position);
          if (!point) return status("未能定位到地面，请换一个位置", "warning");
          vertices.push(point);
          updateBoundaryPreview();
          status(`已选 ${vertices.length} 个点，右键完成`);
        }, eventTypes.LEFT_CLICK);
        handler.setInputAction(() => finishGeometry(tool), eventTypes.RIGHT_CLICK);
        handler.setInputAction(() => finishGeometry(tool), eventTypes.LEFT_DOUBLE_CLICK);
        status(tool === "draw-surface" ? "依次点击区域边界，右键完成" : "依次点击线段节点，右键完成");
      } else if (tool === "place-asset") {
        if (!currentAsset) {
          status("请先从素材库选择一个组件", "warning");
          return { ok: false, code: "ASSET_REQUIRED" };
        }
        handler.setInputAction((event) => {
          schedulePlacementPreview(event.endPosition);
        }, eventTypes.MOUSE_MOVE);
        handler.setInputAction((event) => {
          cancelPlacementPreview();
          const point = pickGround(event.position);
          if (!point) return status("未能定位到地面，请换一个位置", "warning");
          options?.previewAdapter?.clearGhost?.();
          const result = options?.onPlace?.({ asset: currentAsset, coordinate: point.slice(0, 2) });
          if (result?.ok === false) return status(result.message || '组件未放置，请检查场地范围与图层锁', 'warning');
          status(`${currentAsset.label || currentAsset.displayName || currentAsset.name || currentAsset.category || "组件"}已放置`, "success");
        }, eventTypes.LEFT_CLICK);
        status("移动鼠标预览位置，单击地面放置组件");
      } else if (tool === "select") {
        handler.setInputAction((event) => {
          const picked = viewer.scene.pick?.(event.position);
          const id = options?.previewAdapter?.pickObjectId?.(picked) || null;
          const ids = id ? [id] : [];
          options?.previewAdapter?.select?.(ids);
          options?.onSelect?.(ids);
        }, eventTypes.LEFT_CLICK);
      } else if (tool === "move") {
        handler.setInputAction((event) => {
          const picked = viewer.scene.pick?.(event.position);
          dragId = options?.previewAdapter?.pickObjectId?.(picked) || null;
          dragCoordinate = null;
          if (!dragId) return;
          const road=editableRoad(dragId);moveStart=road?previewPickGround(event.position):null;moveGeometry=road?copyLine(road.geometry):null;
          options?.previewAdapter?.select?.([dragId]);
          options?.onSelect?.([dragId]);
          if (viewer.scene?.screenSpaceCameraController) viewer.scene.screenSpaceCameraController.enableInputs = false;
        }, eventTypes.LEFT_DOWN);
        handler.setInputAction((event) => {
          if (!dragId) return;
          const point = previewPickGround(event.endPosition);
          if (point) {
            dragCoordinate = point.slice(0, 2);
            if(moveGeometry&&moveStart){const dx=point[0]-moveStart[0],dy=point[1]-moveStart[1];options?.previewAdapter?.previewLineGeometry?.(dragId,{type:'LineString',coordinates:moveGeometry.coordinates.map(p=>[p[0]+dx,p[1]+dy,...p.slice(2)])});}
          }
        }, eventTypes.MOUSE_MOVE);
        handler.setInputAction(() => {
          const id = dragId;
          const coordinate = dragCoordinate;
          dragId = null;
          dragCoordinate = null;
          restoreCamera();
          if(id&&coordinate&&moveGeometry&&moveStart){const dx=coordinate[0]-moveStart[0],dy=coordinate[1]-moveStart[1];commitRoad(id,{type:'LineString',coordinates:moveGeometry.coordinates.map(p=>[p[0]+dx,p[1]+dy,...p.slice(2)])});}
          else if (id && coordinate&&!moveGeometry) options?.onMove?.({ id, coordinate });
          moveGeometry=null;moveStart=null;
        }, eventTypes.LEFT_UP);
        status("按住并拖动场景组件以调整位置");
      }
      return { ok: true, tool: activeTool };
    }

    function cancel() {
      if(editedRoadId)options?.previewAdapter?.resetLinePreview?.(editedRoadId);
      if(dragId&&moveGeometry)options?.previewAdapter?.resetLinePreview?.(dragId);
      cancelPlacementPreview();
      clearActions();
      vertices.length = 0;
      clearPreview();
      options?.previewAdapter?.clearGhost?.();
      restoreCamera();
      dragId = null;
      dragCoordinate = null;
      activeTool = null;
      boundaryEditOriginal = null;
      selectedBoundaryVertex = null;
      editedRoadId=null;roadGeometry=null;selectedRoadVertex=null;roadDragging=false;roadChanged=false;skipRoadClick=false;moveGeometry=null;moveStart=null;
    }

    function dispose() {
      if (disposed) return;
      cancel();
      handler.destroy?.();
      disposed = true;
    }

    return {
      activate, cancel, dispose, finishBoundary, finishBoundaryEdit, cancelBoundaryEdit, deleteSelectedBoundaryVertex, deleteRoadVertex,
      finishDrawing() { if (activeTool === 'draw-boundary') return finishBoundary(); if (activeTool === 'edit-boundary') return finishBoundaryEdit(); if (['draw-line','draw-surface'].includes(activeTool)) return finishGeometry(activeTool); return false; },
      setAsset(asset) { currentAsset = asset || null; },
      setDocument(document) {
        currentDocument = document || null;
        if(editedRoadId&&!roadDragging){const road=editableRoad(editedRoadId);if(road){roadGeometry=copyLine(road.geometry);selectedRoadVertex=selectedRoadVertex===null?null:Math.min(selectedRoadVertex,roadGeometry.coordinates.length-1);showRoadHandles();}else cancel();}
        return currentDocument;
      },
      getActiveTool: () => activeTool
    };
  }

  return { createCesiumSceneInteractions };
});
