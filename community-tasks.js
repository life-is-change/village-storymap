(function () {
  function requireSupabase(deps) {
    const client = deps.getSupabaseClient();
    if (!client) throw new Error("当前未配置 Supabase。");
    return client;
  }

  function ensureCommunityGameReady(deps) {
    if (!deps.getCommunityGameTablesReady()) {
      throw new Error("社区任务功能未启用，请联系管理员");
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

    async createCommunityTask(deps, { spaceId, reporterName, lng, lat, category = null, description = "" }) {
      const supabaseClient = requireSupabase(deps);
      ensureCommunityGameReady(deps);

      const safeReporter = String(reporterName || "").trim();
      const safeCategory = category ? String(category).trim() : "";
      const safeDescription = String(description || "").trim();
      if (!safeReporter) throw new Error("请先登录后再发布留言");
      if (!safeDescription) throw new Error("请填写留言内容");

      const hasCoord = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat));
      const payload = {
        space_id: spaceId,
        reporter_name: safeReporter,
        category: safeCategory,
        description: safeDescription,
        status: "pending",
        lng: hasCoord ? Number(lng) : null,
        lat: hasCoord ? Number(lat) : null,
        geom: hasCoord ? { type: "Point", coordinates: [Number(lng), Number(lat)] } : null,
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
          throw new Error("社区共建功能未启用，请联系管理员");
        }
        throw error;
      }

      deps.invalidateCommunityTaskCache(spaceId);
      return data;
    },

    async deleteCommunityMessage(deps, messageId) {
      const supabaseClient = requireSupabase(deps);
      ensureCommunityGameReady(deps);
      if (!messageId) throw new Error("留言无效");

      const { error } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .delete()
        .eq("id", messageId);

      if (error) {
        if (deps.isCommunityGameTableMissingError(error)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区共建功能未启用，请联系管理员");
        }
        throw error;
      }
      deps.invalidateCommunityTaskCache(deps.getCurrentSpaceId());
    },

    async fetchMessageReplies(deps, messageId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !messageId) return [];
      const { data, error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .select("data")
        .eq("object_code", `MSG_${messageId}`)
        .eq("object_type", "message_replies")
        .maybeSingle();

      if (error) {
        console.warn("读取追评失败：", error);
        return [];
      }
      return Array.isArray(data?.data?.replies) ? data.data.replies : [];
    },

    async addMessageReply(deps, { messageId, authorName, content }) {
      const supabaseClient = requireSupabase(deps);
      if (!supabaseClient || !messageId) throw new Error("参数不足");
      const safeAuthor = String(authorName || "").trim();
      const safeContent = String(content || "").trim();
      if (!safeAuthor) throw new Error("请先登录");
      if (!safeContent) throw new Error("请输入追评内容");

      const existing = await api.fetchMessageReplies(deps, messageId);
      const nextReplies = [
        ...existing,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          author: safeAuthor,
          content: safeContent,
          created_at: new Date().toISOString(),
          likers: []
        }
      ];

      const { error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .upsert(
          {
            object_code: `MSG_${messageId}`,
            object_type: "message_replies",
            data: { replies: nextReplies },
            updated_at: new Date().toISOString()
          },
          { onConflict: "object_code,object_type" }
        );

      if (error) throw error;
      return nextReplies;
    },

    async deleteMessageReply(deps, { messageId, replyId }) {
      const supabaseClient = requireSupabase(deps);
      if (!supabaseClient || !messageId || !replyId) throw new Error("参数不足");

      const replies = await api.fetchMessageReplies(deps, messageId);
      const nextReplies = replies.filter((r) => r.id !== replyId);

      const { error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .upsert(
          {
            object_code: `MSG_${messageId}`,
            object_type: "message_replies",
            data: { replies: nextReplies },
            updated_at: new Date().toISOString()
          },
          { onConflict: "object_code,object_type" }
        );

      if (error) throw error;
      return nextReplies;
    },

    async fetchMessageLikes(deps, messageId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !messageId) return [];
      const { data, error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .select("data")
        .eq("object_code", `MSG_${messageId}`)
        .eq("object_type", "message_likes")
        .maybeSingle();

      if (error) {
        console.warn("读取点赞失败：", error);
        return [];
      }
      return Array.isArray(data?.data?.likers) ? data.data.likers : [];
    },

    async toggleMessageLike(deps, { messageId, likerName }) {
      const supabaseClient = requireSupabase(deps);
      if (!supabaseClient || !messageId || !likerName) throw new Error("参数不足");
      const likers = await api.fetchMessageLikes(deps, messageId);
      const idx = likers.indexOf(likerName);
      let liked;
      if (idx >= 0) {
        likers.splice(idx, 1);
        liked = false;
      } else {
        likers.push(likerName);
        liked = true;
      }

      const { error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .upsert(
          {
            object_code: `MSG_${messageId}`,
            object_type: "message_likes",
            data: { likers },
            updated_at: new Date().toISOString()
          },
          { onConflict: "object_code,object_type" }
        );

      if (error) throw error;
      return { liked, count: likers.length };
    },

    async toggleReplyLike(deps, { messageId, replyId, likerName }) {
      const supabaseClient = requireSupabase(deps);
      if (!supabaseClient || !messageId || !replyId || !likerName) throw new Error("参数不足");

      const replies = await api.fetchMessageReplies(deps, messageId);
      const reply = replies.find((r) => r.id === replyId);
      if (!reply) throw new Error("追评不存在");

      const likers = Array.isArray(reply.likers) ? [...reply.likers] : [];
      const idx = likers.indexOf(likerName);
      let liked;
      if (idx >= 0) {
        likers.splice(idx, 1);
        liked = false;
      } else {
        likers.push(likerName);
        liked = true;
      }

      reply.likers = likers;

      const { error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .upsert(
          {
            object_code: `MSG_${messageId}`,
            object_type: "message_replies",
            data: { replies },
            updated_at: new Date().toISOString()
          },
          { onConflict: "object_code,object_type" }
        );

      if (error) throw error;
      return { liked, count: likers.length };
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
            throw new Error("社区任务功能未启用，请联系管理员");
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
          throw new Error("社区任务功能未启用，请联系管理员");
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
        throw new Error("社区任务功能未启用，请联系管理员");
      }

      const totalPoints = Number(oldRow?.total_points || 0) + finalDelta;
      const reportsCount = Number(oldRow?.reports_count || 0) + (reason.includes("创建") ? 1 : 0);

      const { error: upsertError } = await supabaseClient
        .from(deps.USER_STATS_TABLE)
        .upsert(
          {
            user_name: userName,
            total_points: totalPoints,
            reports_count: reportsCount,
            verify_count: Number(oldRow?.verify_count || 0),
            level: Math.max(1, Math.floor(totalPoints / 100) + 1),
            updated_at: new Date().toISOString()
          },
          { onConflict: "user_name" }
        );

      if (upsertError) {
        if (deps.isCommunityGameTableMissingError(upsertError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请联系管理员");
        }
        throw upsertError;
      }

      return { awarded: finalDelta, capped };
    },

    async transitionCommunityTaskStatus(deps, { taskRow, operatorName, nextStatus }) {
      const supabaseClient = requireSupabase(deps);
      ensureCommunityGameReady(deps);
      if (!taskRow?.id) throw new Error("任务无效。");
      if (!operatorName) throw new Error("请先登录");

      const { data: latestTask, error: latestError } = await supabaseClient
        .from(deps.COMMUNITY_TASKS_TABLE)
        .select("*")
        .eq("id", taskRow.id)
        .maybeSingle();

      if (latestError) {
        if (deps.isCommunityGameTableMissingError(latestError)) {
          deps.setCommunityGameTablesReady(false);
          throw new Error("社区任务功能未启用，请联系管理员");
        }
        throw latestError;
      }

      if (!latestTask) throw new Error("任务不存在或已删除。");

      const allowedTransitions = {
        pending: ["resolved"],
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
          throw new Error("社区任务功能未启用，请联系管理员");
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

  };

  window.CommunityTasksModule = api;
})();
