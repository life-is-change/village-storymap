(function () {
  function requireSupabase(deps) {
    const client = deps.getSupabaseClient();
    if (!client) throw new Error("当前未配置 Supabase。");
    return client;
  }

  function ensureCommunityGameReady(deps) {
    if (!deps.getCommunityGameTablesReady()) {
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
  }

  const api = {
    async fetchCommunityTaskPhotos(deps, taskId) {
      if (!taskId) return [];
      return deps.fetchObjectPhotos(
        deps.getCommunityTaskPhotoObjectCode(taskId),
        deps.COMMUNITY_TASK_PHOTO_OBJECT_TYPE
      );
    },

    async listTaskVerifications(deps, taskId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !deps.getCommunityGameTablesReady() || !taskId) return [];
      const { data, error } = await supabaseClient
        .from(deps.TASK_VERIFICATIONS_TABLE)
        .select("id, verifier_name, result, note, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });

      if (error) {
        if (deps.isCommunityGameTableMissingError(error)) {
          deps.setCommunityGameTablesReady(false);
          return [];
        }
        console.warn("读取任务核实记录失败：", error);
        return [];
      }

      return data || [];
    },

    summarizeTaskVerifications(_deps, records) {
      const rows = Array.isArray(records) ? records : [];
      let approveCount = 0;
      let rejectCount = 0;
      rows.forEach((item) => {
        if (item?.result === "approve") approveCount += 1;
        if (item?.result === "reject") rejectCount += 1;
      });
      return { approveCount, rejectCount, totalCount: rows.length };
    },

    async listCommunityTasks(deps, spaceId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !deps.getCommunityGameTablesReady()) return [];

      const { data, error } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .select("*")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) {
        if (deps.isCommunityGameTableMissingError(error)) {
          deps.setCommunityGameTablesReady(false);
          console.warn("社区任务表不存在，请先执行 SQL：", error);
          return [];
        }
        console.warn("读取社区任务失败：", error);
        return [];
      }
      return data || [];
    },

    async listCommunityTasksCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getCommunityTasksCache();
      if (!force && cache.has(key)) {
        return cache.get(key);
      }
      const rows = await api.listCommunityTasks(deps, spaceId);
      cache.set(key, rows);
      return rows;
    },

    async createCommunityTask(deps, { spaceId, reporterName, lng, lat, category = "garbage", description = "" }) {
      const supabaseClient = requireSupabase(deps);
      ensureCommunityGameReady(deps);

      const safeReporter = String(reporterName || "").trim();
      const safeCategory = String(category || "garbage").trim() || "garbage";
      const safeDescription = String(description || "").trim();
      if (!safeReporter) throw new Error("请先确认账号后再上报任务。");
      if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) throw new Error("任务坐标无效。");
      if (!safeDescription) throw new Error("任务描述不能为空。");

      const payload = {
        space_id: spaceId,
        reporter_name: safeReporter,
        category: safeCategory,
        description: safeDescription,
        status: "pending",
        lng: Number(lng),
        lat: Number(lat),
        geom: {
          type: "Point",
          coordinates: [Number(lng), Number(lat)]
        },
        verify_count: 0,
        settled_at: null
      };

      const { data, error } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        if (deps.isCommunityGameTableMissingError(error)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw error;
      }

      deps.invalidateCommunityTaskCache(spaceId);
      return data;
    },

    async awardCommunityPoints(deps, { userName, delta, reason, taskId, spaceId }) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !userName || !Number.isFinite(delta) || delta === 0) {
        return { awarded: 0, capped: false };
      }

      let finalDelta = Number(delta);
      let capped = false;

      if (finalDelta > 0) {
        const { startIso, endIso } = deps.getTodayTimeRangeIso();
        const { data: todayRows, error: todayError } = await supabaseClient
          .from(deps.POINTS_LEDGER_TABLE)
          .select("delta")
          .eq("user_name", userName)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .limit(5000);

        if (todayError) {
          if (deps.isCommunityGameTableMissingError(todayError)) {
            deps.setCommunityGameTablesReady(false);
            throw new Error("社区任务功能未启用，请先执行 SQL。");
          }
          console.warn("读取当日积分失败，已按无上限继续：", todayError);
        } else {
          const todayPositive = (todayRows || []).reduce((sum, row) => {
            const value = Number(row?.delta || 0);
            return sum + (value > 0 ? value : 0);
          }, 0);
          const remaining = Math.max(0, deps.COMMUNITY_DAILY_POINTS_CAP - todayPositive);
          if (remaining <= 0) {
            return { awarded: 0, capped: true };
          }
          if (finalDelta > remaining) {
            finalDelta = remaining;
            capped = true;
          }
        }
      }

      const { error: ledgerError } = await supabaseClient
        .from(deps.POINTS_LEDGER_TABLE)
        .insert({
          user_name: userName,
          task_id: taskId,
          space_id: spaceId,
          delta: finalDelta,
          reason
        });

      if (ledgerError) {
        if (deps.isCommunityGameTableMissingError(ledgerError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw ledgerError;
      }

      const { data: oldRow, error: fetchError } = await supabaseClient
        .from(deps.USER_STATS_TABLE)
        .select("*")
        .eq("user_name", userName)
        .maybeSingle();

      if (fetchError && !deps.isCommunityGameTableMissingError(fetchError)) throw fetchError;
      if (fetchError && deps.isCommunityGameTableMissingError(fetchError)) {
        deps.setCommunityGameTablesReady(false);
        throw new Error("社区任务功能未启用，请先执行 SQL。");
      }

      const totalPoints = Number(oldRow?.total_points || 0) + finalDelta;
      const reportsCount = Number(oldRow?.reports_count || 0) + (reason.includes("上报") ? 1 : 0);
      const verifyCount = Number(oldRow?.verify_count || 0) + (reason.includes("核实") ? 1 : 0);

      const { error: upsertError } = await supabaseClient
        .from(deps.USER_STATS_TABLE)
        .upsert(
          {
            user_name: userName,
            total_points: totalPoints,
            reports_count: reportsCount,
            verify_count: verifyCount,
            level: Math.max(1, Math.floor(totalPoints / 100) + 1),
            updated_at: new Date().toISOString()
          },
          { onConflict: "user_name" }
        );

      if (upsertError) {
        if (deps.isCommunityGameTableMissingError(upsertError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw upsertError;
      }

      return { awarded: finalDelta, capped };
    },

    async verifyCommunityTask(deps, { taskRow, verifierName, result, note }) {
      const supabaseClient = requireSupabase(deps);
      ensureCommunityGameReady(deps);
      if (!taskRow?.id) throw new Error("任务无效。");
      if (!verifierName) throw new Error("请先确认账号。");
      if (!["approve", "reject"].includes(result)) throw new Error("核实结果无效。");

      const { data: latestTask, error: latestError } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .select("*")
        .eq("id", taskRow.id)
        .maybeSingle();

      if (latestError) {
        if (deps.isCommunityGameTableMissingError(latestError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw latestError;
      }

      if (!latestTask) throw new Error("任务不存在或已删除。");
      if (latestTask.reporter_name === verifierName) throw new Error("不能核实自己上报的任务。");
      if (latestTask.status !== "pending") throw new Error("该任务已结束，不能重复核实。");

      const { data: existsRows, error: existsError } = await supabaseClient
        .from(deps.TASK_VERIFICATIONS_TABLE)
        .select("id")
        .eq("task_id", latestTask.id)
        .eq("verifier_name", verifierName)
        .limit(1);

      if (existsError) {
        if (deps.isCommunityGameTableMissingError(existsError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw existsError;
      }

      if (Array.isArray(existsRows) && existsRows.length > 0) {
        throw new Error("你已核实过该任务。");
      }

      const { error: insertError } = await supabaseClient
        .from(deps.TASK_VERIFICATIONS_TABLE)
        .insert({
          task_id: latestTask.id,
          verifier_name: verifierName,
          result,
          note: note || ""
        });

      if (insertError) {
        if (deps.isCommunityGameTableMissingError(insertError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw insertError;
      }

      const verificationRows = await api.listTaskVerifications(deps, latestTask.id);
      const summary = api.summarizeTaskVerifications(deps, verificationRows);
      const verifyCount = summary.totalCount;
      let nextStatus = "pending";
      const isAdminVerifier = verifierName === "管理员";
      if (isAdminVerifier) {
        nextStatus = result === "approve" ? "verified" : "rejected";
      } else if (summary.approveCount >= deps.COMMUNITY_VERIFY_APPROVE_THRESHOLD) {
        nextStatus = "verified";
      } else if (summary.rejectCount >= deps.COMMUNITY_VERIFY_REJECT_THRESHOLD) {
        nextStatus = "rejected";
      }

      const isSettled = nextStatus === "verified" || nextStatus === "rejected";
      const { data: updatedTask, error: updateError } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .update({
          status: nextStatus,
          verify_count: verifyCount,
          verifier_name: verifierName,
          verified_at: isSettled ? new Date().toISOString() : latestTask.verified_at,
          settled_at: isSettled ? new Date().toISOString() : latestTask.settled_at
        })
        .eq("id", latestTask.id)
        .select("*")
        .single();

      if (updateError) {
        if (deps.isCommunityGameTableMissingError(updateError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw updateError;
      }

      await api.awardCommunityPoints(deps, {
        userName: verifierName,
        delta: 2,
        reason: "任务核实奖励",
        taskId: latestTask.id,
        spaceId: latestTask.space_id
      });

      if (latestTask.status === "pending" && nextStatus === "verified") {
        await api.awardCommunityPoints(deps, {
          userName: latestTask.reporter_name,
          delta: 5,
          reason: "任务核实通过（上报奖励）",
          taskId: latestTask.id,
          spaceId: latestTask.space_id
        });
      } else if (latestTask.status === "pending" && nextStatus === "rejected") {
        await api.awardCommunityPoints(deps, {
          userName: latestTask.reporter_name,
          delta: -2,
          reason: "任务被驳回（上报扣分）",
          taskId: latestTask.id,
          spaceId: latestTask.space_id
        });
      }

      deps.invalidateCommunityTaskCache(latestTask.space_id);
      return updatedTask;
    },

    async transitionCommunityTaskStatus(deps, { taskRow, operatorName, nextStatus }) {
      const supabaseClient = requireSupabase(deps);
      ensureCommunityGameReady(deps);
      if (!taskRow?.id) throw new Error("任务无效。");
      if (!operatorName) throw new Error("请先确认账号。");

      const { data: latestTask, error: latestError } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .select("*")
        .eq("id", taskRow.id)
        .maybeSingle();

      if (latestError) {
        if (deps.isCommunityGameTableMissingError(latestError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw latestError;
      }

      if (!latestTask) throw new Error("任务不存在或已删除。");

      const allowedTransitions = {
        verified: ["resolved"],
        resolved: ["archived"]
      };
      const current = String(latestTask.status || "pending");
      const allowedNext = allowedTransitions[current] || [];
      if (!allowedNext.includes(nextStatus)) throw new Error("当前状态不支持该操作。");
      if (operatorName !== latestTask.reporter_name && operatorName !== "管理员") {
        throw new Error("仅上报人或管理员可执行该操作。");
      }

      const nowIso = new Date().toISOString();
      const { data: updatedTask, error: updateError } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .update({
          status: nextStatus,
          settled_at: nextStatus === "resolved" || nextStatus === "archived" ? nowIso : latestTask.settled_at
        })
        .eq("id", latestTask.id)
        .select("*")
        .single();

      if (updateError) {
        if (deps.isCommunityGameTableMissingError(updateError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请先执行 SQL。");
        }
        throw updateError;
      }

      if (nextStatus === "resolved") {
        await api.awardCommunityPoints(deps, {
          userName: operatorName,
          delta: 3,
          reason: "任务处理完成奖励",
          taskId: latestTask.id,
          spaceId: latestTask.space_id
        });
      }

      deps.invalidateCommunityTaskCache(latestTask.space_id);
      return updatedTask;
    },

    async getCurrentUserStats(deps, userName) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !deps.getCommunityGameTablesReady() || !userName) return null;
      const { data, error } = await supabaseClient
        .from(deps.USER_STATS_TABLE)
        .select("*")
        .eq("user_name", userName)
        .maybeSingle();

      if (error) {
        if (deps.isCommunityGameTableMissingError(error)) {
          deps.setCommunityGameTablesReady(false);
          return null;
        }
        console.warn("读取积分统计失败：", error);
        return null;
      }
      return data || null;
    },

    async showCommunityTaskInfo(deps, taskRow) {
      if (!taskRow) return;
      const verificationList = await api.listTaskVerifications(deps, taskRow.id);
      const verificationSummary = api.summarizeTaskVerifications(deps, verificationList);
      const photoList = await api.fetchCommunityTaskPhotos(deps, taskRow.id);
      const currentUserName = deps.getCurrentUserName();
      const hasVoted = verificationList.some((row) => row.verifier_name === currentUserName);
      const statusMap = {
        pending: "待核实",
        verified: "已核实",
        resolved: "已处理",
        archived: "已归档",
        rejected: "已驳回"
      };
      const canVerify =
        !!currentUserName &&
        currentUserName !== taskRow.reporter_name &&
        taskRow.status === "pending" &&
        !hasVoted;
      const canResolve =
        !!currentUserName &&
        taskRow.status === "verified" &&
        (currentUserName === taskRow.reporter_name || currentUserName === "管理员");
      const canArchive =
        !!currentUserName &&
        taskRow.status === "resolved" &&
        (currentUserName === taskRow.reporter_name || currentUserName === "管理员");
      const canManageTaskPhotos =
        !!currentUserName &&
        (currentUserName === taskRow.reporter_name || currentUserName === "管理员");

      const photoPreviewHtml = photoList.length
        ? `
      <div class="task-photo-strip">
        ${photoList.map((item, index) => `
          <div class="task-photo-item">
            <a href="${deps.escapeHtml(item.photo_url || "")}" target="_blank" rel="noopener" class="task-photo-thumb-link">
              <img class="task-photo-thumb" src="${deps.escapeHtml(item.photo_url || "")}" alt="任务照片${index + 1}" />
            </a>
            ${
              canManageTaskPhotos
                ? `<button type="button" class="task-photo-remove-btn" data-task-photo-id="${Number(item.id)}">删除</button>`
                : ""
            }
          </div>
        `).join("")}
      </div>
    `
        : `<div class="task-photo-tip">暂无任务照片</div>`;

      const infoPanel = deps.getInfoPanel();
      infoPanel.classList.remove("empty");
      infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">社区任务</h3>
      <div class="house-row"><span class="house-label">任务类型：</span>${deps.escapeHtml(deps.getCommunityTaskTypeMeta(taskRow.category).label)}</div>
      <div class="house-row"><span class="house-label">状态：</span>${deps.escapeHtml(statusMap[taskRow.status] || taskRow.status || "待核实")}</div>
      <div class="house-row"><span class="house-label">上报人：</span>${deps.escapeHtml(taskRow.reporter_name || "未知")}</div>
      <div class="house-row"><span class="house-label">描述：</span>${deps.escapeHtml(taskRow.description || "（无）")}</div>
      <div class="house-row"><span class="house-label">时间：</span>${deps.escapeHtml(deps.formatDateTime(taskRow.created_at))}</div>
      <div class="house-row"><span class="house-label">核实次数：</span>${Number(taskRow.verify_count || 0)}</div>
      <div class="house-row"><span class="house-label">核实进度：</span>通过 ${verificationSummary.approveCount}/${deps.COMMUNITY_VERIFY_APPROVE_THRESHOLD}，驳回 ${verificationSummary.rejectCount}/${deps.COMMUNITY_VERIFY_REJECT_THRESHOLD}</div>
      <div class="house-row"><span class="house-label">任务照片：</span>${photoList.length} 张</div>
      ${photoPreviewHtml}
      <div class="toolbar-row toolbar-row-center" style="margin-top:6px; gap:8px; flex-wrap:wrap;">
        <button id="taskPhotoAddBtn" class="task-action-btn" type="button" ${canManageTaskPhotos ? "" : "disabled"}>补充/更正照片</button>
      </div>
      <div class="toolbar-row toolbar-row-center" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
        <button id="taskVerifyApproveBtn" class="task-action-btn task-action-approve" type="button" ${canVerify ? "" : "disabled"}>核实通过 +2</button>
        <button id="taskVerifyRejectBtn" class="task-action-btn task-action-reject" type="button" ${canVerify ? "" : "disabled"}>核实驳回 +2</button>
        <button id="taskMarkResolvedBtn" class="task-action-btn task-action-resolve" type="button" ${canResolve ? "" : "disabled"}>标记已处理 +3</button>
        <button id="taskArchiveBtn" class="task-action-btn task-action-archive" type="button" ${canArchive ? "" : "disabled"}>归档任务</button>
      </div>
      <div class="house-row" style="margin-top:8px;color:#607080;">
        规则：垃圾/道路/排水上报必须带照片；管理员可单人结案，其他账号需至少2人同向核实；每日最多获得 +${deps.COMMUNITY_DAILY_POINTS_CAP} 积分。
      </div>
    </div>
  `;

      const addPhotoBtn = document.getElementById("taskPhotoAddBtn");
      const approveBtn = document.getElementById("taskVerifyApproveBtn");
      const rejectBtn = document.getElementById("taskVerifyRejectBtn");
      const resolvedBtn = document.getElementById("taskMarkResolvedBtn");
      const archiveBtn = document.getElementById("taskArchiveBtn");

      addPhotoBtn?.addEventListener("click", async () => {
        if (!canManageTaskPhotos) {
          deps.showToast("仅上报人或管理员可编辑任务照片。", "error");
          return;
        }
        const file = await deps.pickImageFile();
        if (!file) return;
        try {
          await deps.uploadObjectPhoto(file, deps.getCommunityTaskPhotoObjectCode(taskRow.id), deps.COMMUNITY_TASK_PHOTO_OBJECT_TYPE, deps.getCurrentUserName());
          const rows = await api.listCommunityTasksCached(deps, deps.getCurrentSpaceId(), { force: true });
          const latest = rows.find((r) => r.id === taskRow.id) || taskRow;
          await api.showCommunityTaskInfo(deps, latest);
          deps.showToast("任务照片已更新。", "success");
        } catch (error) {
          console.error(error);
          deps.showToast(error?.message || "照片上传失败，请稍后重试。", "error");
        }
      });

      const photoDeleteButtons = document.querySelectorAll("[data-task-photo-id]");
      photoDeleteButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!canManageTaskPhotos) {
            deps.showToast("仅上报人或管理员可编辑任务照片。", "error");
            return;
          }
          const photoId = Number(btn.getAttribute("data-task-photo-id"));
          const record = photoList.find((item) => Number(item.id) === photoId);
          if (!record) return;
          const ok = await deps.customConfirm("确认删除这张任务照片吗？", {
            title: "删除任务照片",
            okText: "删除",
            cancelText: "取消",
            isDanger: true
          });
          if (!ok) return;
          try {
            await deps.deleteObjectPhoto(record);
            const rows = await api.listCommunityTasksCached(deps, deps.getCurrentSpaceId(), { force: true });
            const latest = rows.find((r) => r.id === taskRow.id) || taskRow;
            await api.showCommunityTaskInfo(deps, latest);
            deps.showToast("任务照片已删除。", "success");
          } catch (error) {
            console.error(error);
            deps.showToast(error?.message || "删除失败，请稍后重试。", "error");
          }
        });
      });

      const bindVerify = (result) => async () => {
        if (!deps.getCurrentUserName()) {
          deps.showToast("请先确认账号后再核实。", "error");
          return;
        }
        try {
          const note = await deps.customPrompt("可填写核实备注（可选）", "", "核实备注", { requireNonEmpty: false, maxLength: 120 });
          if (note === null) return;
          await api.verifyCommunityTask(deps, {
            taskRow,
            verifierName: deps.getCurrentUserName(),
            result,
            note: String(note || "").trim()
          });
          await deps.refresh2DOverlay();
          const rows = await api.listCommunityTasksCached(deps, deps.getCurrentSpaceId(), { force: true });
          const latest = rows.find((r) => r.id === taskRow.id) || taskRow;
          await api.showCommunityTaskInfo(deps, latest);
          await deps.refreshCommunityScoreBadge();
          deps.showToast("核实提交成功。", "success");
        } catch (error) {
          console.error(error);
          deps.showToast(error?.message || "核实失败，请稍后重试。", "error");
        }
      };
      approveBtn?.addEventListener("click", bindVerify("approve"));
      rejectBtn?.addEventListener("click", bindVerify("reject"));

      resolvedBtn?.addEventListener("click", async () => {
        if (!deps.getCurrentUserName()) {
          deps.showToast("请先确认账号。", "error");
          return;
        }
        const file = await deps.pickImageFile();
        if (!file) {
          deps.showToast("标记已处理时必须上传处理后照片。", "error");
          return;
        }
        try {
          await deps.uploadObjectPhoto(file, deps.getCommunityTaskPhotoObjectCode(taskRow.id), deps.COMMUNITY_TASK_PHOTO_OBJECT_TYPE, deps.getCurrentUserName());
          await api.transitionCommunityTaskStatus(deps, {
            taskRow,
            operatorName: deps.getCurrentUserName(),
            nextStatus: "resolved"
          });
          await deps.refresh2DOverlay();
          const rows = await api.listCommunityTasksCached(deps, deps.getCurrentSpaceId(), { force: true });
          const latest = rows.find((r) => r.id === taskRow.id) || { ...taskRow, status: "resolved" };
          await api.showCommunityTaskInfo(deps, latest);
          await deps.refreshCommunityScoreBadge();
          deps.showToast("任务已标记为“已处理”。", "success");
        } catch (error) {
          console.error(error);
          deps.showToast(error?.message || "操作失败，请稍后重试。", "error");
        }
      });

      archiveBtn?.addEventListener("click", async () => {
        if (!deps.getCurrentUserName()) {
          deps.showToast("请先确认账号。", "error");
          return;
        }
        try {
          await api.transitionCommunityTaskStatus(deps, {
            taskRow,
            operatorName: deps.getCurrentUserName(),
            nextStatus: "archived"
          });
          await deps.refresh2DOverlay();
          const rows = await api.listCommunityTasksCached(deps, deps.getCurrentSpaceId(), { force: true });
          const latest = rows.find((r) => r.id === taskRow.id) || { ...taskRow, status: "archived" };
          await api.showCommunityTaskInfo(deps, latest);
          deps.showToast("任务已归档。", "success");
        } catch (error) {
          console.error(error);
          deps.showToast(error?.message || "归档失败，请稍后重试。", "error");
        }
      });
    }
  };

  window.CommunityTasksModule = api;
})();
