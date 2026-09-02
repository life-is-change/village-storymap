(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TheoryPracticeContextModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const TASK_CONTEXTS = Object.freeze({
    house_observation: context("第一讲 · 民居观察", "plan2d", "current", ["building", "road"], false, "object_info", "选择一栋米埗村民居，观察它与道路、院落和公共空间的关系。"),
    settlement_elements: context("第一讲 · 聚落识别", "plan2d", "current", ["building", "road", "water"], true, "project_settings", "结合建筑、道路与水系识别米埗村的聚落组织，而不是只清点建筑数量。"),
    rural_system_classification: context("第一讲 · 乡村系统", "plan2d", "current", ["building", "road", "water"], true, "project_settings", "从生活、生产、生态、基础设施和社会活动五类系统理解米埗村。"),
    administrative_natural_village: context("第二讲 · 行政属性", "plan2d", "current", ["building", "road", "water"], true, "project_settings", "观察村庄边界、建筑组团和道路联系，辨析治理单元与日常生活单元。"),
    location_type: context("第二讲 · 区位类型", "plan2d", "current", ["road", "water"], true, "project_settings", "依据米埗村与良口镇、交通廊道和流溪河的关系判断区位类型。"),
    function_culture_type: context("第二讲 · 功能与文化", "plan2d", "current", ["building", "road", "water"], true, "object_info", "结合民宿、农业、滨水生态和岭南聚落特征判断米埗村的复合功能。"),
    hollow_village: context("第二讲 · 空心化识别", "plan2d", "current", ["building", "road"], true, "object_info", "从建筑使用、组团内部与外围建设关系中寻找空置或外新内旧的空间证据。"),
    planning_system: context("第三讲 · 规划体系", "plan2d", "current", ["building", "road", "water"], false, "project_settings", "把当前村庄尺度的地图对象与县、镇、村多层级规划关系对应起来。"),
    planning_features: context("第三讲 · 基本特性", "plan2d", "current", ["building", "road", "water", "contours"], true, "problem_marker", "选择米埗村中的具体问题，辨析整体性、层级性、集体性与地方适应性。"),
    planning_relationship: context("第三讲 · 关系辨析", "plan2d", "current", ["building", "road", "water"], true, "problem_marker", "围绕一个空间冲突标记问题，并分析涉及的主体、效率与公平关系。"),
    co_creation: context("第三讲 · 共同缔造", "plan2d", "current", ["building", "road", "water"], true, "class_discussion", "选择一个需要村民参与的议题，在班级讨论中形成共谋、共建、共管、共评、共享的思路。"),
    current_positioning: context("第四讲 · 现状与定位", "plan2d", "current", ["building", "road", "water", "contours"], true, "project_settings", "综合现状资源、建设短板和生态条件，提出米埗村的发展定位。"),
    function_industry_layout: context("第四讲 · 功能与产业", "plan2d", "current", ["road", "water", "contours"], true, "project_settings", "依据山水、道路和建设分布判断生产、生活、生态空间与产业节点。"),
    settlement_planning: context("第四讲 · 居民点规划", "plan2d", "group", ["building", "road"], true, "object_info", "识别需要保留、整治、改造或更新的居民点与农房，并在小组空间形成判断。"),
    road_public_service: context("第四讲 · 道路与公服", "plan2d", "group", ["building", "road"], true, "problem_marker", "检查道路骨架、断点和公共服务覆盖，在小组空间标记需要优化的位置。"),
    sanitation_landuse: context("第四讲 · 厕污垃与用地", "plan2d", "group", ["road", "water"], true, "problem_marker", "围绕污水、垃圾、环境卫生和用地冲突标记问题并提出管控建议。"),
    action_plan: context("第四讲 · 行动计划", "plan2d", "group", ["building", "road", "water"], true, "class_discussion", "把现状问题、发展定位和空间布局转化为近期行动项目与协作安排。"),
    design_principles: context("第五讲 · 三大原则", "plan2d", "current", ["building", "water", "contours"], true, "problem_marker", "从安全、尺度适宜和本土性三个方面识别米埗村需要设计改善的位置。"),
    large_scale_design: context("第五讲 · 千尺审势", "plan2d", "current", ["water", "contours"], true, "project_settings", "结合水系、等高线和遥感底图判断村庄山水格局、选址安全与生态联系。"),
    middle_scale_design: context("第五讲 · 百尺造形", "plan2d", "group", ["building", "road"], true, "object_info", "观察街巷、建筑组团和公共空间之间的关系，提出空间组织优化方向。"),
    small_scale_design: context("第五讲 · 十尺提质", "model3d", "group", ["building"], false, "object_info", "在三维场景中检查农房体量、日常生活空间和风貌细节，形成提质建议。"),
    design_path: context("第五讲 · 设计路径", "model3d", "group", ["building", "road", "water"], false, "object_info", "在小组方案中综合千尺、百尺和十尺三个尺度，检查设计方案的空间效果。"),
    house_construction: context("第六讲 · 农房建设", "model3d", "group", ["building"], false, "object_info", "选择一栋拟新建或改造农房，检查选址、体量、安全、审批与风貌协调问题。"),
    infrastructure_implementation: context("第六讲 · 基础设施", "plan2d", "group", ["road", "water"], true, "problem_marker", "识别给水、污水、垃圾和道路设施问题，并明确建设与运行维护要求。"),
    public_service_implementation: context("第六讲 · 公共服务", "plan2d", "group", ["building", "road"], true, "problem_marker", "检查教育、医疗、养老等服务的空间位置、可达性与覆盖不足区域。"),
    project_schedule: context("第六讲 · 项目时序", "plan2d", "group", ["building", "road", "water"], true, "class_discussion", "结合小组方案列出项目优先级、实施主体、建设时序和维护方式。"),
    evaluation_framework: context("第七讲 · 评价体系", "plan2d", "group", ["building", "road", "water"], true, "project_settings", "从空间合理性、公共服务、生态影响和实施可行性建立小组方案评价框架。"),
    evaluation_data_collection: context("第七讲 · 数据采集", "plan2d", "current", ["building", "road", "water"], true, "object_info", "利用地图对象、现场照片、问题标记和修改记录识别平台已有的评价证据。"),
    problem_evaluation: context("第七讲 · 问题评价", "plan2d", "current", ["building", "road", "water"], true, "problem_marker", "围绕农房、污水垃圾、道路出行和公共服务补充评价问题与空间证据。"),
    feedback_improvement: context("第七讲 · 整改反馈", "plan2d", "group", ["building", "road", "water"], true, "class_discussion", "选择一项评价问题，讨论整改措施、责任主体和成效跟踪方式。"),
    plan_assessment: context("第七讲 · 方案评价", "model3d", "group", ["building", "road", "water"], false, "object_info", "切换二维与三维检查小组方案，并形成有证据的评价与优化建议。")
  });

  function context(stageLabel, view, space, layers, basemapVisible, tool, instruction) {
    return Object.freeze({ stageLabel, view, space, layers: Object.freeze(layers), basemapVisible, tool, instruction });
  }

  function cleanText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function resolveTheoryPracticeMessage(message) {
    if (!message || message.type !== "village-theory-practice") return null;
    const payload = message.payload || {};
    const mapTask = cleanText(payload.mapTask, 80);
    const preset = TASK_CONTEXTS[mapTask];
    if (!preset) return null;
    return {
      lessonId: cleanText(payload.lessonId, 40),
      stepId: cleanText(payload.stepId, 80),
      mapTask,
      lessonTitle: cleanText(payload.lessonTitle, 120),
      taskTitle: cleanText(payload.taskTitle, 160),
      stageLabel: preset.stageLabel,
      view: preset.view,
      space: preset.space,
      layers: [...preset.layers],
      basemapVisible: preset.basemapVisible,
      tool: preset.tool,
      instruction: preset.instruction
    };
  }

  function getTheoryPracticePreset(mapTask) {
    const preset = TASK_CONTEXTS[cleanText(mapTask, 80)];
    return preset ? { ...preset, layers: [...preset.layers] } : null;
  }

  async function executeTheoryPracticeContext(contextValue, deps = {}) {
    if (!contextValue) return false;
    await deps.openWorkspace?.(contextValue.view, contextValue.space);
    await deps.applyWorkspace?.({
      layers: [...(contextValue.layers || [])],
      basemapVisible: Boolean(contextValue.basemapVisible)
    });
    await deps.openTool?.(contextValue.tool);
    deps.setContext?.(contextValue);
    deps.notify?.(contextValue.instruction);
    return true;
  }

  return { resolveTheoryPracticeMessage, getTheoryPracticePreset, executeTheoryPracticeContext };
});
