(function () {
  const PHOTO_UPLOADER_MAP_KEY = "village_photo_uploader_map_v1";

  function normalizeIdentityName(deps, name) {
    if (deps && typeof deps.normalizeIdentityName === "function") {
      return deps.normalizeIdentityName(name);
    }
    return String(name || "").trim();
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

    async acquireSpaceEditLock(deps, spaceId, editorName) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !spaceId || !editorName) return { success: true };

      const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10分钟
      const lockCode = `__SPACE_LOCK__${spaceId}`;

      const { data: existing, error: fetchError } = await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .select("data, updated_at")
        .eq("object_code", lockCode)
        .eq("object_type", "space_lock")
        .maybeSingle();

      if (fetchError) {
        console.warn("查询空间编辑锁失败：", fetchError);
        return { success: false, reason: "查询失败" };
      }

      const now = Date.now();
      if (existing) {
        const lockedAt = new Date(existing.updated_at || existing.data?.locked_at || 0).getTime();
        const currentEditor = normalizeIdentityName(deps, existing.data?.editor_name || "");
        const selfEditor = normalizeIdentityName(deps, editorName);

        if (now - lockedAt < LOCK_TIMEOUT_MS && currentEditor && currentEditor !== selfEditor) {
          return { success: false, reason: "locked", editorName: currentEditor };
        }

        await supabaseClient
          .from(deps.OBJECT_EDITS_TABLE)
          .delete()
          .eq("object_code", lockCode)
          .eq("object_type", "space_lock");
      }

      await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .upsert(
          {
            object_code: lockCode,
            object_type: "space_lock",
            data: { editor_name: editorName, locked_at: new Date().toISOString() },
            updated_at: new Date().toISOString()
          },
          { onConflict: "object_code,object_type" }
        );

      return { success: true };
    },

    async releaseSpaceEditLock(deps, spaceId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient || !spaceId) return;

      const lockCode = `__SPACE_LOCK__${spaceId}`;
      await supabaseClient
        .from(deps.OBJECT_EDITS_TABLE)
        .delete()
        .eq("object_code", lockCode)
        .eq("object_type", "space_lock");
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

  };

  window.DataServiceModule = api;
})();
