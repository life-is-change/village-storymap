(function () {
  const LOCAL_LIKES_KEY = "village_comment_likes_v1";
  const COMMENT_LIKES_DB_DISABLED_KEY = "village_comment_likes_db_disabled_v1";
  const PHOTO_UPLOADER_MAP_KEY = "village_photo_uploader_map_v1";
  let commentLikesDbEnabled = null;

  function readLocalLikesMap() {
    try {
      const raw = localStorage.getItem(LOCAL_LIKES_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeLocalLikesMap(map) {
    localStorage.setItem(LOCAL_LIKES_KEY, JSON.stringify(map || {}));
  }

  function readJsonMap(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeJsonMap(key, map) {
    try {
      localStorage.setItem(key, JSON.stringify(map || {}));
    } catch (_) {
      // ignore localStorage write errors
    }
  }

  function readPhotoUploaderMap() {
    return readJsonMap(PHOTO_UPLOADER_MAP_KEY);
  }

  function rememberPhotoUploader(photoPath, photoUrl, uploaderName) {
    const safeUploader = String(uploaderName || "").trim();
    if (!safeUploader) return;

    const map = readPhotoUploaderMap();
    if (photoPath) map[`path:${photoPath}`] = safeUploader;
    if (photoUrl) map[`url:${photoUrl}`] = safeUploader;
    writeJsonMap(PHOTO_UPLOADER_MAP_KEY, map);
  }

  function forgetPhotoUploader(photoPath, photoUrl) {
    const map = readPhotoUploaderMap();
    if (photoPath) delete map[`path:${photoPath}`];
    if (photoUrl) delete map[`url:${photoUrl}`];
    writeJsonMap(PHOTO_UPLOADER_MAP_KEY, map);
  }

  function resolvePhotoUploader(item) {
    const direct = String(item?.uploaded_by || "").trim();
    if (direct) return direct;

    const map = readPhotoUploaderMap();
    const byPath = item?.photo_path ? map[`path:${item.photo_path}`] : "";
    if (byPath) return String(byPath).trim();

    const byUrl = item?.photo_url ? map[`url:${item.photo_url}`] : "";
    return String(byUrl || "").trim();
  }

  function isCommentLikesTableMissingError(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const status = Number(error.status);
    const message = String(error.message || "").toLowerCase();
    return (
      code === "PGRST205" ||
      code === "42P01" ||
      status === 404 ||
      (message.includes("comment_likes") && (message.includes("not found") || message.includes("does not exist")))
    );
  }

  function isCommentLikesDbDisabled() {
    if (commentLikesDbEnabled === null) {
      try {
        commentLikesDbEnabled = localStorage.getItem(COMMENT_LIKES_DB_DISABLED_KEY) !== "1";
      } catch (_) {
        commentLikesDbEnabled = true;
      }
    }
    return !commentLikesDbEnabled;
  }

  function disableCommentLikesDb() {
    commentLikesDbEnabled = false;
    try {
      localStorage.setItem(COMMENT_LIKES_DB_DISABLED_KEY, "1");
    } catch (_) {
      // ignore localStorage write errors
    }
  }

  function enableCommentLikesDb() {
    commentLikesDbEnabled = true;
    try {
      localStorage.removeItem(COMMENT_LIKES_DB_DISABLED_KEY);
    } catch (_) {
      // ignore localStorage write errors
    }
  }

  const api = {
    async fetchObjectEdits(deps, sourceCode, objectType) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !sourceCode || !objectType) return null;

      const { data, error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .select("data")
        .eq("object_code", sourceCode)
        .eq("object_type", objectType)
        .maybeSingle();

      if (error) {
        console.warn("读取对象编辑信息失败：", error);
        return null;
      }

      return data?.data || null;
    },

    async saveObjectEdits(deps, sourceCode, objectType, payload) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("当前未配置 Supabase。");
      }

      const { error } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .upsert(
          {
            object_code: sourceCode,
            object_type: objectType,
            data: payload,
            updated_at: new Date().toISOString()
          },
          { onConflict: "object_code,object_type" }
        );

      if (error) throw error;
    },

    async fetchObjectComments(deps, sourceCode, objectType) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !sourceCode || !objectType || !deps.getCommentsTableReady()) return [];

      const { data, error } = await supabaseClient
        .from(deps.OBJECT_COMMENTS_TABLE)
        .select("id, object_code, object_type, author_name, content, created_at")
        .eq("object_code", sourceCode)
        .eq("object_type", objectType)
        .order("created_at", { ascending: false })
        .limit(80);

      if (error) {
        if (deps.isCommentsTableMissingError(error)) {
          deps.setCommentsTableReady(false);
          console.warn("留言表不存在，请先创建 object_comments。", error);
          return [];
        }
        console.warn("读取留言失败：", error);
        return [];
      }

      return data || [];
    },

    async createObjectComment(deps, sourceCode, objectType, authorName, content) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("当前未配置 Supabase。");
      }
      if (!deps.getCommentsTableReady()) {
        throw new Error("留言表尚未创建，请先执行 SQL。");
      }

      const safeAuthor = String(authorName || "").trim();
      const safeContent = String(content || "").trim();
      if (!safeAuthor) throw new Error("请先确认账号后再留言。");
      if (!safeContent) throw new Error("留言内容不能为空。");

      const { error } = await supabaseClient
        .from(deps.OBJECT_COMMENTS_TABLE)
        .insert({
          object_code: sourceCode,
          object_type: objectType,
          author_name: safeAuthor,
          content: safeContent
        });

      if (error) {
        if (deps.isCommentsTableMissingError(error)) {
          deps.setCommentsTableReady(false);
          throw new Error("留言表尚未创建，请先执行 SQL。");
        }
        throw error;
      }
    },

    async fetchObjectPhotos(deps, sourceCode, objectType) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !sourceCode || !objectType) return [];

      const { data, error } = await supabaseClient
        .from(deps.OBJECT_PHOTOS_TABLE)
        .select("*")
        .eq("object_code", sourceCode)
        .eq("object_type", objectType);

      if (error) {
        console.warn("读取照片列表失败：", error);
        return [];
      }

      return (data || [])
        .map((item) => ({
          ...item,
          uploaded_at: item.uploaded_at || item.created_at || "",
          uploaded_by: resolvePhotoUploader(item)
        }))
        .sort((a, b) => {
          const ta = Date.parse(a.uploaded_at || "") || 0;
          const tb = Date.parse(b.uploaded_at || "") || 0;
          return tb - ta;
        });
    },

    async uploadObjectPhoto(deps, file, sourceCode, objectType, uploadedBy) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("当前未配置 Supabase。");
      }

      const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeCode = deps.normalizeCode(sourceCode || "object");
      const fileName = `${objectType}/${safeCode}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabaseClient.storage
        .from(deps.PHOTO_BUCKET)
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabaseClient.storage
        .from(deps.PHOTO_BUCKET)
        .getPublicUrl(fileName);

      const photoUrl = publicUrlData?.publicUrl || "";

      const insertPayload = {
        object_code: sourceCode,
        object_type: objectType,
        photo_url: photoUrl,
        photo_path: fileName,
        uploaded_by: uploadedBy || null
      };

      let { error: insertError } = await supabaseClient
        .from(deps.OBJECT_PHOTOS_TABLE)
        .insert(insertPayload);

      if (insertError && String(insertError.message || "").toLowerCase().includes("uploaded_by")) {
        const fallbackPayload = {
          object_code: sourceCode,
          object_type: objectType,
          photo_url: photoUrl,
          photo_path: fileName
        };
        const retry = await supabaseClient
          .from(deps.OBJECT_PHOTOS_TABLE)
          .insert(fallbackPayload);
        insertError = retry.error;
      }

      if (insertError) throw insertError;

      rememberPhotoUploader(fileName, photoUrl, uploadedBy);
      return { photoUrl, photoPath: fileName };
    },

    async deleteObjectPhoto(deps, photoRecord) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("当前未配置 Supabase。");
      }

      if (photoRecord.photo_path) {
        const { error: storageError } = await supabaseClient.storage
          .from(deps.PHOTO_BUCKET)
          .remove([photoRecord.photo_path]);

        if (storageError) {
          console.warn("删除存储文件失败：", storageError);
        }
      }

      const { error: deleteError } = await supabaseClient
        .from(deps.OBJECT_PHOTOS_TABLE)
        .delete()
        .eq("id", photoRecord.id);

      if (deleteError) throw deleteError;
      forgetPhotoUploader(photoRecord.photo_path, photoRecord.photo_url);
    },

    async fetchCommentLikes(deps) {
      const supabaseClient = deps.getSupabaseClient();
      const dbMap = {};

      if (supabaseClient && !isCommentLikesDbDisabled()) {
        try {
          const { data, error } = await supabaseClient
            .from("comment_likes")
            .select("comment_id, liker_name");

          if (error) {
            if (isCommentLikesTableMissingError(error)) {
              disableCommentLikesDb();
            }
          } else {
            enableCommentLikesDb();
            (data || []).forEach((row) => {
              if (!dbMap[row.comment_id]) dbMap[row.comment_id] = [];
              dbMap[row.comment_id].push(row.liker_name);
            });
          }
        } catch (error) {
          if (isCommentLikesTableMissingError(error)) {
            disableCommentLikesDb();
          }
        }
      }

      const localMap = readLocalLikesMap();
      Object.keys(localMap).forEach((cid) => {
        const arr = Array.isArray(localMap[cid]) ? localMap[cid] : [];
        if (!dbMap[cid]) dbMap[cid] = [];
        arr.forEach((name) => {
          if (!dbMap[cid].includes(name)) dbMap[cid].push(name);
        });
      });

      return dbMap;
    },

    async toggleCommentLike(deps, commentId, likerName) {
      const supabaseClient = deps.getSupabaseClient();
      if (!commentId || !likerName) {
        throw new Error("参数不足");
      }

      if (supabaseClient && !isCommentLikesDbDisabled()) {
        try {
          const { data: existsRows, error: existsError } = await supabaseClient
            .from("comment_likes")
            .select("id")
            .eq("comment_id", commentId)
            .eq("liker_name", likerName)
            .limit(1);

          if (existsError) {
            if (isCommentLikesTableMissingError(existsError)) {
              disableCommentLikesDb();
            }
            throw existsError;
          }

          if (existsRows && existsRows.length > 0) {
            const { error: removeError } = await supabaseClient
              .from("comment_likes")
              .delete()
              .eq("comment_id", commentId)
              .eq("liker_name", likerName);

            if (removeError) {
              if (isCommentLikesTableMissingError(removeError)) {
                disableCommentLikesDb();
              }
              throw removeError;
            }

            enableCommentLikesDb();
            return { liked: false };
          }

          const { error: insertError } = await supabaseClient
            .from("comment_likes")
            .insert({ comment_id: commentId, liker_name: likerName });

          if (insertError) {
            if (isCommentLikesTableMissingError(insertError)) {
              disableCommentLikesDb();
            }
            throw insertError;
          }

          enableCommentLikesDb();
          return { liked: true };
        } catch (error) {
          if (isCommentLikesTableMissingError(error)) {
            disableCommentLikesDb();
          }
          // fallback to local storage
        }
      }

      const map = readLocalLikesMap();
      const key = String(commentId);
      const arr = Array.isArray(map[key]) ? [...map[key]] : [];
      const idx = arr.indexOf(likerName);
      let liked;

      if (idx >= 0) {
        arr.splice(idx, 1);
        liked = false;
      } else {
        arr.push(likerName);
        liked = true;
      }

      if (arr.length) {
        map[key] = arr;
      } else {
        delete map[key];
      }

      writeLocalLikesMap(map);
      return { liked };
    }
  };

  window.DataServiceModule = api;
})();
