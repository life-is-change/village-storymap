(function (root, factory) {
  const model =
    root?.CourseModelModule ||
    (typeof require === "function" ? require("../course/course-model.js") : null);
  const api = factory(model, root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CourseWorkbenchModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (model, root) {
  const DEFAULT_COURSE = model?.DEFAULT_COURSE;
  const getNextTask = model?.getNextTask;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getStageProgress(course, completedTaskIds) {
    const completed = new Set(completedTaskIds || []);
    return (course?.stages || []).map((stage, index) => {
      const taskIds = stage.taskIds || [];
      return {
        ...stage,
        index,
        complete: taskIds.length > 0 && taskIds.every((taskId) => completed.has(taskId))
      };
    });
  }

  function renderStageIcon(stageKey) {
    const paths = {
      group_join: '<circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="9" r="2.5"></circle><path d="M3.5 19c.6-3.2 2.5-5 5.5-5s4.9 1.8 5.5 5"></path><path d="M14.5 14.5c2.8-.3 4.8 1.2 5.5 4.5"></path>',
      learning: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"></path><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"></path>',
      survey: '<path d="M4 7h4l1.5-2h5L16 7h4v11H4z"></path><circle cx="12" cy="12.5" r="3"></circle>',
      diagnosis: '<path d="M12 3 3.5 19h17z"></path><path d="M12 9v4"></path><circle cx="12" cy="16.5" r=".7" fill="currentColor" stroke="none"></circle>',
      design: '<path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16z"></path><path d="m14.7 6.5 3 3"></path>',
      review: '<path d="M4 4h16v12H8l-4 4z"></path><path d="m9 10 2 2 4-4"></path>',
      submission: '<path d="M7 4h10v3h3v14H4V7h3z"></path><path d="M9 4h6v4H9z"></path><path d="m8 14 2.5 2.5L16 11"></path>'
    };
    return `<svg class="course-task-rail-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[stageKey] || paths.submission}</svg>`;
  }

  function renderTaskNavigation({ course = DEFAULT_COURSE, completedTaskIds = [], activeTaskId = "" }) {
    const activeTask = (course.tasks || []).find((task) => task.id === activeTaskId);
    return getStageProgress(course, completedTaskIds)
      .map((stage) => {
        const stageTaskId = stage.taskIds?.[0] || "";
        const isActive = activeTask?.stageKey === stage.key;
        const stateClass = stage.complete ? " is-complete" : isActive ? " is-active" : "";
        const stateText = stage.complete ? "已完成" : isActive ? "进行中" : "待完成";
        return `
          <button
            type="button"
            class="course-task-rail-item${stateClass}"
            data-course-task-id="${escapeHtml(stageTaskId)}"
            aria-label="${stage.index + 1}. ${escapeHtml(stage.title)}，${stateText}"
            title="${stage.index + 1}. ${escapeHtml(stage.title)}"
          >
            ${renderStageIcon(stage.key)}
            <span class="course-task-rail-number">${stage.complete ? "✓" : stage.index + 1}</span>
            <span class="course-task-rail-state" aria-hidden="true"></span>
          </button>
        `;
      })
      .join("");
  }

  function getTaskActionState({ task, context }) {
    if (task?.id === "join-group") return { type: "join_group" };
    if (task?.id === "design-workspace") {
      return {
        type: "workspace",
        viewModes: ["2d", "3d"],
        spaceId: context?.group?.spaceId || ""
      };
    }
    if (["survey-collect", "diagnosis-list", "review-plan"].includes(task?.id)) {
      return { type: "map_task", viewModes: ["2d"], spaceId: context?.group?.spaceId || "" };
    }
    return { type: "complete_task" };
  }

  function renderTaskActions(task, context, completedTaskIds) {
    const completed = new Set(completedTaskIds || []);
    const isComplete = completed.has(task.id);
    if (task.id === "join-group") return "";
    return `
      <button type="button" class="course-btn course-btn-primary" data-complete-task="${escapeHtml(task.id)}">
        ${isComplete ? "本阶段已完成" : "记录本阶段完成"}
      </button>
    `;
  }

  function renderTaskGuidance(task, context) {
    const guidance = {
      "learning-ready": [
        "返回首页完成理论学习内容。",
        "阅读当前村庄的现状与问题信息。",
        "与小组成员确认本次实践分工。"
      ],
      "survey-collect": [
        "在当前地图中定位调研对象或现场位置。",
        "点击对象后上传调研照片并填写说明。",
        "补充照片类型、时间和需要关注的问题。"
      ],
      "diagnosis-list": [
        "在地图上标记道路、排水、安全等现状问题。",
        "结合照片和对象属性补充问题依据。",
        "通过评论与回复整理小组问题清单。"
      ],
      "design-workspace": [
        "直接使用原菜单中的建筑、道路和空间编辑工具。",
        "通过平台原有视图开关在 2D 与 3D 间切换。",
        "所有编辑保存在当前公共空间或小组共享空间中。"
      ],
      "review-plan": [
        "检查规划要素的位置、属性和空间关系。",
        "针对具体对象填写评论和修改意见。",
        "完成组内复核后再记录本阶段完成。"
      ],
      "submit-result": [
        "确认当前空间为准备提交的最终方案版本。",
        "整理方案说明、主要调整内容和附件。",
        "完成个人反思并等待教师检查成果。"
      ]
    };

    if (task.id === "join-group") {
      if (context?.group) {
        return `
          <div class="course-group-status">
            <span>当前小组</span>
            <strong>${escapeHtml(context.group.name || "课程小组")}</strong>
            <small>组码：${escapeHtml(context.group.joinCode || "已加入")}</small>
          </div>
        `;
      }
      return `
        <form class="course-group-join" data-group-join-form>
          <label for="courseGroupCode">输入老师提供的组码</label>
          <input id="courseGroupCode" name="groupCode" maxlength="12" autocomplete="off" placeholder="例如 ABC123" required />
          <button type="submit" class="course-btn course-btn-primary">加入小组</button>
        </form>
      `;
    }

    const items = guidance[task.id] || [];
    return `
      <ol class="course-task-checklist">
        ${items.map((item, index) => `
          <li>
            <span>${index + 1}</span>
            <p>${escapeHtml(item)}</p>
          </li>
        `).join("")}
      </ol>
    `;
  }

  function renderDashboard({ course = DEFAULT_COURSE, user = {}, context = {}, nextTask = null, activeTaskId = "" }) {
    const progress = context.progress || { completedTaskIds: [] };
    const completedCount = progress.completedTaskIds?.length || 0;
    const totalCount = course.tasks?.length || 0;
    const percentage = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
    const activeTask =
      (course.tasks || []).find((task) => task.id === activeTaskId) || nextTask || course.tasks?.[0] || null;
    const group = context.group;
    const actorName = String(user.name || "未登录").trim();
    const activeStageIndex = Math.max(
      0,
      (course.stages || []).findIndex((stage) => stage.key === activeTask?.stageKey)
    );

    return `
      <div class="course-task-drawer-shell">
        <header class="course-task-drawer-header">
          <span class="course-eyebrow">${escapeHtml(course.title)}</span>
          <div class="course-task-drawer-title">
            <span>${activeStageIndex + 1}</span>
            <h2>${escapeHtml(activeTask?.title || "课程任务")}</h2>
          </div>
          <p>${escapeHtml(activeTask?.description || "从左侧选择一个课程阶段。")}</p>
        </header>

        <div class="course-task-progress" aria-label="课程进度 ${percentage}%">
          <div>
            <span>${escapeHtml(actorName)} · ${group ? escapeHtml(group.name) : "未加入小组"}</span>
            <strong>${completedCount}/${totalCount}</strong>
          </div>
          <span><i style="width:${percentage}%"></i></span>
        </div>

        <section class="course-task-drawer-body">
          ${activeTask ? renderTaskGuidance(activeTask, context) : ""}
        </section>

        <footer class="course-task-drawer-actions">
          ${activeTask ? renderTaskActions(activeTask, context, progress.completedTaskIds) : ""}
        </footer>
      </div>
    `;
  }

  function createCourseWorkbench(deps = {}) {
    const course = deps.course || DEFAULT_COURSE;
    const container = deps.container;
    const navContainer = deps.navContainer;
    const service = deps.service;
    const logger = deps.logger;
    let context = null;
    let activeTaskId = "";
    let bound = false;

    function getUser() {
      return deps.getUser?.() || {};
    }

    async function logAction(action, target, metadata) {
      if (!logger) return;
      await logger.record(action, target, metadata);
      logger.flush().catch(() => {});
    }

    function render() {
      const user = getUser();
      const progress = context?.progress || { completedTaskIds: [] };
      const nextTask = getNextTask(course, progress);
      if (!activeTaskId) activeTaskId = nextTask?.id || course.tasks?.[0]?.id || "";
      if (navContainer) {
        navContainer.innerHTML = renderTaskNavigation({
          course,
          completedTaskIds: progress.completedTaskIds,
          activeTaskId
        });
      }
      if (container) {
        container.innerHTML = renderDashboard({
          course,
          user,
          context: context || { group: null, progress },
          nextTask,
          activeTaskId
        });
      }
    }

    async function refresh() {
      const user = getUser();
      context = await service.loadContext(user);
      render();
      return context;
    }

    async function showDashboard() {
      await refresh();
      deps.onShow?.();
      return context;
    }

    async function showTask(taskId) {
      activeTaskId = String(taskId || "");
      render();
      await logAction("task_opened", { type: "task", id: activeTaskId }, {});
    }

    async function handleSubmit(event) {
      const form = event.target.closest?.("[data-group-join-form]");
      if (!form) return;
      event.preventDefault();
      const formData = new FormData(form);
      const groupCode = String(formData.get("groupCode") || "");
      try {
        context = await service.joinGroup(groupCode, getUser());
        await service.setTaskComplete("join-group", true, getUser());
        await logAction("group_joined", { type: "group", id: context.group?.id || "" }, {
          groupName: context.group?.name || ""
        });
        activeTaskId = "learning-ready";
        await refresh();
        deps.showToast?.(`已加入${context.group?.name || "小组"}`, "success");
      } catch (error) {
        deps.showToast?.(error?.message || "加入小组失败", "error");
      }
    }

    async function handleClick(event) {
      const taskButton = event.target.closest?.("[data-course-task-id]");
      if (taskButton) {
        deps.onTaskSelected?.();
        await showTask(taskButton.dataset.courseTaskId);
        return;
      }
      const completeButton = event.target.closest?.("[data-complete-task]");
      if (completeButton) {
        const taskId = completeButton.dataset.completeTask;
        await service.setTaskComplete(taskId, true, getUser());
        await logAction("task_completed", { type: "task", id: taskId }, {});
        const updated = await refresh();
        activeTaskId = getNextTask(course, updated.progress)?.id || taskId;
        render();
        deps.showToast?.("任务进度已更新", "success");
        return;
      }
    }

    function init() {
      if (!bound) {
        container?.addEventListener("submit", handleSubmit);
        container?.addEventListener("click", handleClick);
        navContainer?.addEventListener("click", handleClick);
        bound = true;
      }
      return refresh();
    }

    function destroy() {
      if (!bound) return;
      container?.removeEventListener("submit", handleSubmit);
      container?.removeEventListener("click", handleClick);
      navContainer?.removeEventListener("click", handleClick);
      bound = false;
    }

    return {
      init,
      refresh,
      showDashboard,
      showTask,
      destroy,
      getContext: () => context,
      getActiveTaskId: () => activeTaskId
    };
  }

  return {
    escapeHtml,
    getTaskActionState,
    renderTaskNavigation,
    renderDashboard,
    createCourseWorkbench
  };
});
