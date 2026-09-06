const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  renderGroupRows,
  buildAdminGroupPlanUrl,
  resolveGroupPlanAdminContext,
  createGroupPlanAdminController
} = require("./group-plan-admin.js");

const projectRoot = path.resolve(__dirname, "../..");
const htmlSource = fs.readFileSync(path.join(projectRoot, "admin.html"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "admin.js"), "utf8");
const workspaceSource = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
const sqlSource = fs.readFileSync(path.join(projectRoot, "supabase_SQL/Group Plan Baseline Update.sql"), "utf8");

test("admin dashboard rows show lifecycle baseline activity and conflicts", () => {
  const html = renderGroupRows([{
    group_id: "g1", group_name: "第一组", member_count: 6, space_id: "s1",
    base_version_name: "V1.0", latest_version_name: "V2.0", unresolved_conflicts: 2,
    latest_restore_point_id: "r1"
  }]);
  assert.match(html, /第一组/);
  assert.match(html, /6 人/);
  assert.match(html, /V1\.0/);
  assert.match(html, /V2\.0/);
  assert.match(html, /2 个冲突/);
  assert.match(html, /data-enter-group-plan="s1"/);
  assert.match(html, /data-restore-group-plan="r1"/);
});

test("enter action creates an explicit temporary admin context", () => {
  assert.equal(buildAdminGroupPlanUrl({ projectId: "p1", villageId: "v1", groupId: "g1", spaceId: "s1" }),
    "./index.html?adminGroupPlan=1&project=p1&village=v1&group=g1&space=s1");
});

test("formal project context is resolved without exposing practice villages", () => {
  assert.deepEqual(resolveGroupPlanAdminContext({
    project: { id: "p1", formalVillageId: "v1", name: "2026课程" },
    villages: [{ id: "v1", name: "南溪村" }]
  }), { teachingProjectId: "p1", villageId: "v1", projectName: "2026课程", villageName: "南溪村" });
  assert.equal(resolveGroupPlanAdminContext({ project: { id: "p1", formalVillageId: null } }), null);
});

test("controller loads one staff dashboard RPC and can ensure a missing space", async () => {
  const calls = [];
  const supabaseClient = { rpc: async (name, args) => (calls.push({ name, args }), { data: [], error: null }) };
  const controller = createGroupPlanAdminController({ supabaseClient });
  const context = { teachingProjectId: "p1", villageId: "v1" };
  await controller.loadDashboard(context);
  await controller.ensureSpace({ ...context, groupId: "g1", snapshotId: "snap1" });
  assert.deepEqual(calls, [
    { name: "get_group_plan_admin_dashboard", args: { p_teaching_project_id: "p1", p_village_id: "v1" } },
    { name: "ensure_group_plan_space", args: { p_teaching_project_id: "p1", p_village_id: "v1", p_group_id: "g1", p_snapshot_id: "snap1" } }
  ]);
});

test("admin page provides a dedicated group plan tab and controller", () => {
  assert.match(htmlSource, /data-admin-tab="groupPlans"/);
  assert.match(htmlSource, /id="adminTabGroupPlans"/);
  assert.match(htmlSource, /features\/admin\/group-plan-admin\.js/);
  assert.match(appSource, /initializeGroupPlanAdmin/);
  assert.match(appSource, /groupPlans:\s*\$\("adminTabGroupPlans"\)/);
  assert.match(appSource, /location\.hash\s*===\s*"#group-plans"/);
});

test("dashboard RPC is staff-only and returns groups even before spaces exist", () => {
  assert.match(sqlSource, /create or replace function public\.get_group_plan_admin_dashboard/i);
  assert.match(sqlSource, /STAFF_REQUIRED/i);
  assert.match(sqlSource, /from public\.course_groups[\s\S]*?left join lateral/i);
  assert.match(sqlSource, /unresolved_conflicts/i);
  assert.match(sqlSource, /revoke all on function public\.get_group_plan_admin_dashboard\(uuid,uuid\) from public, anon/i);
});

test("temporary map management context is verified by one staff-only RPC", () => {
  assert.match(sqlSource, /create or replace function public\.get_group_plan_admin_context/i);
  assert.match(sqlSource, /space\.group_id\s*=\s*p_group_id/i);
  assert.match(sqlSource, /space\.space_type\s*=\s*'group_plan'/i);
  assert.match(sqlSource, /revoke all on function public\.get_group_plan_admin_context\(uuid,uuid,text,text\) from public, anon/i);
  assert.match(workspaceSource, /function applyAdminGroupPlanContextFromUrl/);
  assert.match(workspaceSource, /get_group_plan_admin_context/);
  assert.match(workspaceSource, /adminGroupPlan"\)\s*!==\s*"1"/);
  assert.match(workspaceSource, /adminManagement:\s*true/);
});
