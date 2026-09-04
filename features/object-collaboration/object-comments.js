(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ObjectCommentsModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const INTERACTION_TYPE = "object_comment_interactions";

  function requireContext(deps) {
    const context = deps.getContext?.() || {};
    if (!context.teachingProjectId) throw new Error("PROJECT_CONTEXT_REQUIRED");
    if (!context.villageId) throw new Error("VILLAGE_CONTEXT_REQUIRED");
    if (!context.spaceId) throw new Error("SPACE_CONTEXT_REQUIRED");
    return context;
  }

  function normalizeInteractionData(value) {
    const data = value && typeof value === "object" ? value : {};
    return {
      likes: Array.from(new Set((Array.isArray(data.likes) ? data.likes : []).map((name) => String(name || "").trim()).filter(Boolean))),
      replies: (Array.isArray(data.replies) ? data.replies : []).filter((reply) => reply && reply.content)
    };
  }

  function toggleLike(data, actorName) {
    const next = normalizeInteractionData(data);
    const actor = String(actorName || "").trim();
    if (!actor) return next;
    const index = next.likes.indexOf(actor);
    if (index >= 0) next.likes.splice(index, 1);
    else next.likes.push(actor);
    return next;
  }

  function appendReply(data, authorName, content, now = new Date().toISOString()) {
    const next = normalizeInteractionData(data);
    const author = String(authorName || "").trim();
    const body = String(content || "").trim();
    if (!author || !body) return next;
    next.replies.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      author,
      content: body.slice(0, 200),
      created_at: now
    });
    return next;
  }

  async function readInteraction(client, editsTable, commentId, context) {
    const { data, error } = await client
      .from(editsTable)
      .select("data")
      .eq("object_code", `COMMENT_${commentId}`)
      .eq("object_type", INTERACTION_TYPE)
      .eq("teaching_project_id", context.teachingProjectId)
      .eq("village_id", context.villageId)
      .eq("space_id", context.spaceId)
      .maybeSingle();
    if (error) throw error;
    return normalizeInteractionData(data?.data);
  }

  async function writeInteraction(client, editsTable, commentId, data, context) {
    const payload = normalizeInteractionData(data);
    const { error } = await client.from(editsTable).upsert({
      object_code: `COMMENT_${commentId}`,
      object_type: INTERACTION_TYPE,
      data: payload,
      teaching_project_id: context.teachingProjectId,
      village_id: context.villageId,
      space_id: context.spaceId,
      updated_at: new Date().toISOString()
    }, { onConflict: "teaching_project_id,village_id,space_id,object_code,object_type" });
    if (error) throw error;
    return payload;
  }

  async function list(deps, objectCode, objectType) {
    const context = requireContext(deps);
    const client = deps.getClient();
    if (!client || !objectCode || !objectType) return [];
    const { data, error } = await client
      .from(deps.commentsTable)
      .select("id, object_code, object_type, author_name, content, created_at")
      .eq("object_code", objectCode)
      .eq("object_type", objectType)
      .eq("teaching_project_id", context.teachingProjectId)
      .eq("village_id", context.villageId)
      .eq("space_id", context.spaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Promise.all((data || []).map(async (comment) => ({
      ...comment,
      interaction: await readInteraction(client, deps.editsTable, comment.id, context).catch(() => normalizeInteractionData())
    })));
  }

  async function create(deps, { objectCode, objectType, authorName, content }) {
    const context = requireContext(deps);
    const client = deps.getClient();
    if (!client) throw new Error("当前未配置 Supabase。");
    const payload = {
      object_code: objectCode,
      object_type: objectType,
      author_name: String(authorName || "").trim(),
      content: String(content || "").trim().slice(0, 200),
      teaching_project_id: context.teachingProjectId,
      village_id: context.villageId,
      space_id: context.spaceId
    };
    const { data, error } = await client.from(deps.commentsTable).insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function like(deps, commentId, actorName) {
    const context = requireContext(deps);
    const client = deps.getClient();
    const current = await readInteraction(client, deps.editsTable, commentId, context);
    return writeInteraction(client, deps.editsTable, commentId, toggleLike(current, actorName), context);
  }

  async function reply(deps, commentId, authorName, content) {
    const context = requireContext(deps);
    const client = deps.getClient();
    const current = await readInteraction(client, deps.editsTable, commentId, context);
    return writeInteraction(client, deps.editsTable, commentId, appendReply(current, authorName, content), context);
  }

  return { INTERACTION_TYPE, normalizeInteractionData, toggleLike, appendReply, list, create, like, reply };
});
