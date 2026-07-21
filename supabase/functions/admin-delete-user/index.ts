import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }

  const authorization = request.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", callerData.user.id)
    .maybeSingle();
  if (callerProfile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Administrator role required" }), { status: 403, headers: jsonHeaders });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body?.userId || "");
  if (!/^[0-9a-f-]{36}$/i.test(userId) || userId === callerData.user.id) {
    return new Response(JSON.stringify({ error: "Invalid target user" }), { status: 400, headers: jsonHeaders });
  }

  const { data: targetProfile } = await adminClient.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!targetProfile || targetProfile.role === "admin") {
    return new Response(JSON.stringify({ error: "Target account cannot be deleted" }), { status: 400, headers: jsonHeaders });
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
  }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: jsonHeaders });
});
