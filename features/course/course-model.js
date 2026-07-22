(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CourseModelModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_COURSE = Object.freeze({
    id: "mibu-village-planning",
    title: "米埗村规划实践",
    villageId: "mibu",
    villageName: "米埗村",
    stages: Object.freeze([
      { key: "group_join", kind: "preparation", title: "加入小组", taskIds: ["join-group"] },
      { key: "learning", kind: "preparation", title: "学习准备", taskIds: ["learning-ready"] },
      { key: "figure_ground", kind: "practice", title: "图底生产", taskIds: ["figure-ground-compose"] },
      { key: "survey", kind: "practice", title: "调研采集与现状校核", taskIds: ["survey-collect"] },
      { key: "diagnosis", kind: "practice", title: "现状诊断与课堂汇报", taskIds: ["diagnosis-list"] },
      { key: "design", kind: "practice", title: "方案设计与迭代", taskIds: ["design-workspace"] },
      { key: "submission", kind: "practice", title: "成果整理与提交", taskIds: ["submit-result"] }
    ]),
    tasks: Object.freeze([
      {
        id: "join-group",
        stageKey: "group_join",
        title: "加入课程小组",
        description: "输入老师提供的组码，加入线下已组成的小组。",
        action: "join_group",
        context: Object.freeze({
          outcomes: ["确认个人所属课程小组"],
          resources: ["教师提供的组码", "线下小组名单"],
          actions: ["输入组码并加入小组"]
        })
      },
      {
        id: "learning-ready",
        stageKey: "learning",
        title: "确认完成学习准备",
        description: "完成首页的理论学习、村庄信息阅读与讨论后确认本任务。",
        action: "confirm_learning",
        context: Object.freeze({
          outcomes: ["完成课程理论与村庄背景准备"],
          resources: ["教学目的", "理论学习", "村庄现状与问题"],
          actions: ["返回首页阅读", "确认学习准备状态"]
        })
      },
      {
        id: "figure-ground-compose",
        stageKey: "figure_ground",
        title: "个人图底生产与合成",
        description: "独立绘制研究范围，运行建筑识别、道路水系提取与等高线生成，预览后形成个人图底。",
        action: "open_geoprocessing",
        context: Object.freeze({
          outcomes: ["建筑、道路、水系和等高线个人图层", "完整图底生产过程记录"],
          resources: ["高分辨率遥感影像", "OpenStreetMap 广东快照", "Copernicus DEM GLO-30"],
          actions: ["绘制 AOI", "提交个人处理任务", "预览并核对五类成果"]
        })
      },
      {
        id: "survey-collect",
        stageKey: "survey",
        title: "调研采集与现状校核",
        description: "全班共同校核现状要素，上传并关联现场照片与调研说明。",
        action: "open_survey",
        context: Object.freeze({
          outcomes: ["校核后的现状要素", "已定位的调研照片与说明"],
          resources: ["现状建筑与道路", "现场照片", "调研备注"],
          actions: ["选择现状对象", "上传照片", "新增点状问题标记"]
        })
      },
      {
        id: "diagnosis-list",
        stageKey: "diagnosis",
        title: "现状诊断与课堂汇报",
        description: "共享问题标记、要素讨论和汇报结论，形成班级共同认识。",
        action: "open_diagnosis",
        context: Object.freeze({
          outcomes: ["现状问题清单", "课堂汇报结论与教师反馈"],
          resources: ["问题标记", "要素讨论", "调研照片与校核结果"],
          actions: ["查看问题分布", "补充讨论依据", "整理汇报结论"]
        })
      },
      {
        id: "design-workspace",
        stageKey: "design",
        title: "方案设计与迭代",
        description: "在小组规划空间中基于共同现状基线开展方案设计与版本迭代。",
        action: "open_workspace",
        context: Object.freeze({
          outcomes: ["小组方案草案", "可回溯的方案版本"],
          resources: ["冻结现状基线", "规划要素", "小组讨论记录"],
          actions: ["编辑方案要素", "切换 2D／3D 检查", "保存阶段版本"]
        })
      },
      {
        id: "submit-result",
        stageKey: "submission",
        title: "成果整理与提交",
        description: "确认最终方案版本，整理说明、附件、个人反思与小组成果。",
        action: "open_submission",
        context: Object.freeze({
          outcomes: ["小组最终成果", "方案说明与个人反思"],
          resources: ["最终方案版本", "成果附件", "教师反馈"],
          actions: ["确认提交版本", "整理附件与说明", "提交成果"]
        })
      }
    ])
  });

  function normalizeCourseState(state = {}) {
    const completedTaskIds = Array.isArray(state.completedTaskIds)
      ? state.completedTaskIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    return {
      ...state,
      completedTaskIds: [...new Set(completedTaskIds)]
    };
  }

  function getOrderedStages(course = DEFAULT_COURSE) {
    return Array.isArray(course?.stages) ? course.stages.map((stage) => ({ ...stage })) : [];
  }

  function getNextTask(course = DEFAULT_COURSE, state = {}) {
    const completed = new Set(normalizeCourseState(state).completedTaskIds);
    return (course?.tasks || []).find((task) => !completed.has(task.id)) || null;
  }

  function buildStudentKey(user = {}) {
    const studentId = String(user.student_id || user.studentId || "").trim();
    const name = String(user.name || "").trim();
    return `${studentId}::${name}`;
  }

  function canJoinGroup(group, currentMembership) {
    return Boolean(group && !group.locked && !currentMembership);
  }

  return {
    DEFAULT_COURSE,
    normalizeCourseState,
    getOrderedStages,
    getNextTask,
    buildStudentKey,
    canJoinGroup
  };
});
