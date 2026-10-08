import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const PROMPT = "把带透视的建筑实拍图转换成规整干净、轴线对齐、材质真实、无遮挡的标准建筑正立面投影；保持原建筑门窗、层数、色彩和材料，不增加虚构构件，背景为纯浅灰。";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function providerBase(workspaceId: string, region: string) {
  const host = region === "ap-southeast-1" ? "ap-southeast-1" : "cn-beijing";
  return `https://${workspaceId}.${host}.maas.aliyuncs.com/api/v1`;
}

function outputImageUrl(payload: any) {
  const content = payload?.output?.choices?.[0]?.message?.content || [];
  return content.find((item: any) => item?.image)?.image
    || payload?.output?.results?.[0]?.url
    || payload?.output?.task_result?.images?.[0]?.url
    || "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const apiKey = Deno.env.get("DASHSCOPE_API_KEY") || "";
  const workspaceId = Deno.env.get("DASHSCOPE_WORKSPACE_ID") || "";
  const region = Deno.env.get("DASHSCOPE_REGION") || "cn-beijing";
  const model = Deno.env.get("FACADE_CLOUD_MODEL") || "qwen-image-3.0";
  const configuredCost = Number.parseFloat(Deno.env.get("FACADE_CLOUD_ESTIMATED_COST_CNY") || "0");
  const estimatedCostCny = Number.isFinite(configuredCost) && configuredCost >= 0 ? configuredCost : 0;
  const enabled = (Deno.env.get("FACADE_CLOUD_ENABLED") || "false").toLowerCase() === "true";
  const available = enabled && Boolean(apiKey && workspaceId);
  const authorization = request.headers.get("Authorization") || "";
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
  });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  const body = await request.json().catch(() => ({}));
  if (body.action === "capability") {
    return json({ available, reason: available ? "" : "not_configured", provider: "dashscope", model: available ? model : "", estimatedCostCny });
  }
  if (!available) return json({ error: "CLOUD_FACADE_NOT_CONFIGURED" }, 503);

  if (body.action === "submit") {
    const photoId = Number(body.photoId);
    const courseId = String(body.courseId || "").trim();
    const spaceId = String(body.spaceId || "").trim();
    const objectCode = String(body.objectCode || "").trim();
    if (!Number.isSafeInteger(photoId) || !courseId || !spaceId || !objectCode) return json({ error: "INVALID_CONTEXT" }, 400);
    const { data: photo, error: photoError } = await caller.from("object_photos")
      .select("id,photo_url,object_code").eq("id", photoId).maybeSingle();
    if (photoError || !photo || String(photo.object_code) !== objectCode) return json({ error: "PHOTO_NOT_ACCESSIBLE" }, 403);

    const { data: run, error: runError } = await admin.from("cloud_facade_runs").insert({
      owner_id: authData.user.id, course_id: courseId, space_id: spaceId,
      object_code: objectCode, photo_id: photoId, model, estimated_cost_cny: estimatedCostCny
    }).select("id").single();
    if (runError) return json({ error: runError.message }, 500);

    const providerResponse = await fetch(`${providerBase(workspaceId, region)}/services/aigc/multimodal-generation/generation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-DashScope-Async": "enable" },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ image: photo.photo_url }, { text: PROMPT }] }] },
        parameters: { n: 1, prompt_extend: true, watermark: false }
      })
    });
    const providerPayload = await providerResponse.json().catch(() => ({}));
    const providerJobId = providerPayload?.output?.task_id || providerPayload?.task_id || "";
    if (!providerResponse.ok || !providerJobId) {
      await admin.from("cloud_facade_runs").update({ status: "failed", error_code: providerPayload?.code || String(providerResponse.status), error_message: providerPayload?.message || "提交失败", updated_at: new Date().toISOString() }).eq("id", run.id);
      return json({ error: providerPayload?.message || "PROVIDER_SUBMIT_FAILED" }, providerResponse.status || 502);
    }
    await admin.from("cloud_facade_runs").update({ provider_job_id: providerJobId, status: "queued", progress: 10, updated_at: new Date().toISOString() }).eq("id", run.id);
    return json({ runId: run.id, status: "queued" }, 202);
  }

  if (body.action === "poll") {
    const runId = String(body.runId || "");
    const { data: run, error: runError } = await caller.from("cloud_facade_runs").select("*").eq("id", runId).maybeSingle();
    if (runError || !run) return json({ error: "RUN_NOT_FOUND" }, 404);
    if (run.status === "succeeded" && run.result_storage_path) {
      const { data } = await admin.storage.from("facade-generation").createSignedUrl(run.result_storage_path, 300);
      return json({ id: run.id, status: "succeeded", progress: 100, resultUrl: data?.signedUrl || "" });
    }
    if (run.status === "failed") return json({ id: run.id, status: "failed", errorMessage: run.error_message || "处理失败" });

    const providerResponse = await fetch(`${providerBase(workspaceId, region)}/tasks/${encodeURIComponent(run.provider_job_id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const payload = await providerResponse.json().catch(() => ({}));
    const providerStatus = String(payload?.output?.task_status || payload?.status || "").toUpperCase();
    if (providerStatus === "FAILED" || !providerResponse.ok) {
      const message = payload?.message || payload?.output?.message || "云端处理失败";
      await admin.from("cloud_facade_runs").update({ status: "failed", error_code: payload?.code || String(providerResponse.status), error_message: message, updated_at: new Date().toISOString() }).eq("id", run.id);
      return json({ id: run.id, status: "failed", errorMessage: message });
    }
    if (providerStatus !== "SUCCEEDED") {
      const status = providerStatus === "RUNNING" ? "running" : "queued";
      const progress = status === "running" ? 55 : 20;
      await admin.from("cloud_facade_runs").update({ status, progress, updated_at: new Date().toISOString() }).eq("id", run.id);
      return json({ id: run.id, status, progress });
    }

    const imageUrl = outputImageUrl(payload);
    if (!imageUrl) return json({ error: "PROVIDER_RESULT_MISSING" }, 502);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) return json({ error: "PROVIDER_RESULT_DOWNLOAD_FAILED" }, 502);
    const bytes = await imageResponse.arrayBuffer();
    const storagePath = `${authData.user.id}/cloud/${run.id}/standard-facade.png`;
    const { error: uploadError } = await admin.storage.from("facade-generation").upload(storagePath, bytes, { contentType: "image/png", upsert: true });
    if (uploadError) return json({ error: uploadError.message }, 500);
    await admin.from("cloud_facade_runs").update({ status: "succeeded", progress: 100, result_storage_path: storagePath, updated_at: new Date().toISOString() }).eq("id", run.id);
    const { data } = await admin.storage.from("facade-generation").createSignedUrl(storagePath, 300);
    return json({ id: run.id, status: "succeeded", progress: 100, resultUrl: data?.signedUrl || "" });
  }

  return json({ error: "UNKNOWN_ACTION" }, 400);
});
