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
      { key: "group_join", title: "加入小组", taskIds: ["join-group"] },
      { key: "learning", title: "学习准备", taskIds: ["learning-ready"] },
      { key: "survey", title: "调研采集", taskIds: ["survey-collect"] },
      { key: "diagnosis", title: "现状诊断", taskIds: ["diagnosis-list"] },
      { key: "design", title: "方案设计", taskIds: ["design-workspace"] },
      { key: "review", title: "协作评审", taskIds: ["review-plan"] },
      { key: "submission", title: "成果提交", taskIds: ["submit-result"] }
    ]),
    tasks: Object.freeze([
      {
        id: "join-group",
        stageKey: "group_join",
        title: "加入课程小组",
        description: "输入老师提供的组码，加入线下已组成的小组。",
        action: "join_group"
      },
      {
        id: "learning-ready",
        stageKey: "learning",
        title: "确认完成学习准备",
        description: "完成首页的理论学习、村庄信息阅读与讨论后确认本任务。",
        action: "confirm_learning"
      },
      {
        id: "survey-collect",
        stageKey: "survey",
        title: "整理调研照片与备注",
        description: "上传现场照片，补充位置、类型与调研说明，形成小组资料库。",
        action: "open_survey"
      },
      {
        id: "diagnosis-list",
        stageKey: "diagnosis",
        title: "形成现状问题清单",
        description: "结合照片与地图对象提出问题，通过评论和回复形成小组判断。",
        action: "open_diagnosis"
      },
      {
        id: "design-workspace",
        stageKey: "design",
        title: "编辑小组规划方案",
        description: "进入共享规划空间，在同一数据上切换 2D 或 3D 视图开展设计。",
        action: "open_workspace"
      },
      {
        id: "review-plan",
        stageKey: "review",
        title: "开展小组协作评审",
        description: "检查成员贡献、讨论具体要素并汇总修改意见。",
        action: "open_review"
      },
      {
        id: "submit-result",
        stageKey: "submission",
        title: "提交小组成果",
        description: "确认最终方案版本，补充方案说明和个人反思。",
        action: "open_submission"
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
