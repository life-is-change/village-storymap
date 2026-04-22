(function () {
  const api = {
    getOlFeatureStyle(deps, feature, resolution) {
      const OL = deps.getOL();
      if (!OL) return null;

      const { Style, Fill, Stroke, Text } = OL;
      const CircleStyle = OL.CircleStyle || OL.Circle;
      const layerKey = feature.get("layerKey");
      const sourceCode = feature.get("sourceCode");
      const geomType = feature?.getGeometry?.()?.getType?.() || "";
      const isActive = deps.isActiveFeature(feature);
      const isHovered = deps.isHoveredFeature(feature);
      const isCommented = deps.hasFeatureComments(layerKey, sourceCode);
      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      const figureGroundMode = selectedLayers.includes("figureGround");
      const layerRenderZIndex = {
        [deps.VILLAGE_FILL_LAYER_KEY]: 0,
        elevationBands: 5,
        contours: 20,
        cropland: 70,
        openSpace: 75,
        water: 85,
        road: 100,
        building: 120,
        communityTask: 180
      };
      const featureZIndex = layerRenderZIndex[layerKey] ?? 60;

      let fill = "rgba(160,160,160,0.25)";
      let stroke = "rgba(90,90,90,0.95)";
      let strokeWidth = 2;
      let strokeLineDash = undefined;

      if (layerKey === "communityTask") {
        const taskRow = feature.get("taskRow") || {};
        const status = taskRow.status || "pending";
        let color = "#f59e0b";
        if (status === "verified") color = "#10b981";
        else if (status === "resolved") color = "#0ea5e9";
        else if (status === "archived") color = "#64748b";
        else if (status === "rejected") color = "#ef4444";
        if (isActive) color = "#1565c0";

        if (typeof CircleStyle !== "function") {
          return new Style({
            zIndex: featureZIndex,
            stroke: new Stroke({ color, width: 2 }),
            fill: new Fill({ color: `${color}66` })
          });
        }

        return new Style({
          zIndex: featureZIndex,
          image: new CircleStyle({
            radius: isHovered || isActive ? 8 : 7,
            fill: new Fill({ color: `${color}cc` }),
            stroke: new Stroke({ color: "#ffffff", width: 2 })
          })
        });
      }

      if (layerKey === deps.VILLAGE_FILL_LAYER_KEY) {
        return new Style({
          zIndex: featureZIndex,
          fill: new Fill({ color: deps.VILLAGE_FILL_COLOR }),
          stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 })
        });
      }

      if (layerKey === "elevationBands") {
        const pickNumber = (...vals) => {
          for (const v of vals) {
            const n = Number(v);
            if (Number.isFinite(n)) return n;
          }
          return NaN;
        };
        const elevMin = pickNumber(
          feature.get("ELEV_MIN"),
          feature.get("elev_min"),
          feature.get("MIN"),
          feature.get("min"),
          feature.get("value")
        );

        let fillColor = "rgba(225, 231, 222, 0.90)";
        if (Number.isFinite(elevMin)) {
          if (elevMin < 80) fillColor = "rgba(225, 231, 222, 0.90)";
          else if (elevMin < 100) fillColor = "rgba(191, 217, 186, 0.90)";
          else if (elevMin < 120) fillColor = "rgba(133, 199, 130, 0.90)";
          else if (elevMin < 140) fillColor = "rgba(62, 163, 84, 0.90)";
          else fillColor = "rgba(0, 104, 45, 0.92)";
        }

        return new Style({
          zIndex: featureZIndex,
          fill: new Fill({ color: fillColor }),
          stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 })
        });
      }

      const contourValueRaw =
        feature.get("ELEV") ??
        feature.get("elev") ??
        feature.get("ELEVATION") ??
        feature.get("elevation") ??
        feature.get("VALUE") ??
        feature.get("value") ??
        feature.get("CONTOUR") ??
        feature.get("contour");
      const contourValueNum = Number(contourValueRaw);
      const contourLabel = Number.isFinite(contourValueNum)
        ? String(Math.round(contourValueNum * 10) / 10)
        : (contourValueRaw != null ? String(contourValueRaw) : "");

      if (figureGroundMode) {
        if (layerKey === "building") {
          fill = "#000000";
          stroke = "#000000";
          strokeWidth = 1.2;
        } else if (layerKey === "road") {
          fill = "#9a9a9a";
          stroke = "#9a9a9a";
          strokeWidth = geomType.includes("Line") ? deps.getRoadDisplayStrokeWidth(feature, resolution) : 1.2;
        } else if (layerKey === "water") {
          fill = "#4a90ff";
          stroke = "#4a90ff";
          strokeWidth = 1.2;
        } else if (layerKey === "contours") {
          fill = "rgba(0,0,0,0)";
          stroke = "rgba(128, 136, 126, 0.38)";
          strokeWidth = 0.9;
          strokeLineDash = [3, 3];
        }
      } else {
        if (layerKey === "building") {
          fill = "rgba(255,70,70,0.30)";
          stroke = "rgba(210,50,50,0.95)";
        } else if (layerKey === "road") {
          fill = geomType.includes("Line") ? "rgba(0,0,0,0)" : "rgba(154,154,154,0.90)";
          stroke = "rgba(140,140,140,0.96)";
          strokeWidth = geomType.includes("Line") ? deps.getRoadDisplayStrokeWidth(feature, resolution) : 2.6;
        } else if (layerKey === "cropland") {
          fill = "rgba(186, 206, 76, 0.28)";
          stroke = "rgba(124, 146, 39, 0.95)";
          strokeWidth = 1.6;
          strokeLineDash = [6, 4];
        } else if (layerKey === "openSpace") {
          fill = "rgba(255, 193, 79, 0.30)";
          stroke = "rgba(230, 138, 0, 0.95)";
          strokeWidth = 1.8;
        } else if (layerKey === "water") {
          fill = "rgba(74, 144, 255, 0.90)";
          stroke = "rgba(74, 144, 255, 0.96)";
          strokeWidth = 1.2;
        } else if (layerKey === "contours") {
          fill = "rgba(0,0,0,0)";
          stroke = "rgba(128, 136, 126, 0.38)";
          strokeWidth = 0.9;
          strokeLineDash = [3, 3];
        }
      }

      if (!figureGroundMode && layerKey === "road" && geomType.includes("Line")) {
        const baseWidth = deps.getRoadDisplayStrokeWidth(feature, resolution);
        const smoothGeometry = deps.getSmoothedRoadLineGeometry(feature);
        let strokeColor = "rgba(154,154,154,0.96)";
        let strokeWidthRoad = Math.max(1.8, baseWidth);

        if (isActive) {
          strokeColor = "#1565c0";
          strokeWidthRoad = Math.max(2.4, baseWidth + 0.9);
        } else if (isHovered) {
          strokeColor = "#1e88e5";
          strokeWidthRoad = Math.max(2.2, baseWidth + 0.5);
        } else if (isCommented) {
          strokeColor = "#ff9800";
          strokeWidthRoad = Math.max(2.4, baseWidth + 0.9);
        }

        return new Style({
          zIndex: featureZIndex,
          geometry: smoothGeometry || undefined,
          stroke: new Stroke({
            color: strokeColor,
            width: strokeWidthRoad,
            lineCap: "round",
            lineJoin: "round"
          })
        });
      }

      if (isActive) {
        fill = "rgba(33,150,243,0.35)";
        stroke = "#1565c0";
        strokeWidth = 3.5;
      } else if (isHovered) {
        fill = "rgba(33,150,243,0.18)";
        stroke = "#42a5f5";
        strokeWidth = 2.8;
      } else if (isCommented) {
        if (layerKey === "road") {
          if (!geomType.includes("Line")) {
            fill = "rgba(30, 136, 229, 0.30)";
          }
          stroke = "#ff9800";
          strokeWidth = geomType.includes("Line")
            ? Math.max(deps.getRoadDisplayStrokeWidth(feature, resolution), 3.5)
            : 3.2;
        } else {
          fill = "rgba(255, 193, 7, 0.18)";
          stroke = "#ff9800";
          strokeWidth = 3.1;
        }
      }

      return new Style({
        zIndex: featureZIndex,
        fill: new Fill({ color: fill }),
        stroke: new Stroke({
          color: stroke,
          width: strokeWidth,
          lineDash: strokeLineDash
        }),
        text:
          layerKey === "contours" &&
          contourLabel &&
          typeof Text === "function" &&
          Number.isFinite(resolution) &&
          resolution <= 0.000075
            ? new Text({
                text: contourLabel,
                font: "10px 'Microsoft YaHei', 'PingFang SC', sans-serif",
                scale: Math.max(0.24, Math.min(0.68, 0.000043 / Math.max(resolution, 1e-9))),
                fill: new Fill({ color: "rgba(92, 100, 88, 0.58)" }),
                stroke: new Stroke({ color: "rgba(242, 246, 239, 0.75)", width: 1.1 }),
                overflow: true,
                placement: "line",
                repeat: 520
              })
            : undefined
      });
    }
  };

  window.MapStyleModule = api;
})();
