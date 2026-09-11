const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

function loadDataService() {
  global.window = {};
  global.localStorage = {
    getItem() { return null; },
    setItem() {},
  };
  const modulePath = path.join(root, "features", "data", "data-service.js");
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return global.window.DataServiceModule;
}

function contextDeps(client) {
  return {
    getContext: () => ({
      teachingProjectId: "11111111-1111-4111-8111-111111111111",
      villageId: "22222222-2222-4222-8222-222222222222",
      spaceId: "current",
    }),
    getSupabaseClient: () => client,
    OBJECT_PHOTOS_TABLE: "object_photos",
    PHOTO_BUCKET: "house-photos",
  };
}

function photoQuery(rows) {
  const query = {
    select() { return this; },
    eq() { return this; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return query;
}

test("photo list marks records that are referenced by a facade generation run", async () => {
  const service = loadDataService();
  const rpcCalls = [];
  const client = {
    from() {
      return photoQuery([
        { id: 7, photo_url: "https://example.test/7.jpg", uploaded_by: "张三" },
        { id: 8, photo_url: "https://example.test/8.jpg", uploaded_by: "李四" },
      ]);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: [{ photo_id: 7 }], error: null };
    },
  };

  const photos = await service.fetchObjectPhotos(contextDeps(client), "B-1", "building");

  assert.deepEqual(rpcCalls, [{
    name: "list_object_photo_facade_usage",
    args: { p_photo_ids: [7, 8] },
  }]);
  assert.equal(photos.find((photo) => photo.id === 7).used_for_facade_generation, true);
  assert.equal(photos.find((photo) => photo.id === 8).used_for_facade_generation, false);
});

test("a database rejection never removes the storage object first", async () => {
  const service = loadDataService();
  const events = [];
  const protectedError = new Error("FACADE_PHOTO_IN_USE");
  protectedError.code = "P0001";
  const client = {
    storage: {
      from() {
        return { async remove() { events.push("storage"); return { error: null }; } };
      },
    },
    async rpc() {
      events.push("database");
      return { data: null, error: protectedError };
    },
    from() {
      return {
        delete() { events.push("direct-delete"); return this; },
        eq() { return this; },
        then(resolve) { resolve({ error: null }); },
      };
    },
  };

  await assert.rejects(
    service.deleteObjectPhoto(contextDeps(client), { id: 7, photo_path: "p/7.jpg" }),
    /FACADE_PHOTO_IN_USE/,
  );
  assert.deepEqual(events, ["database"]);
});

test("referenced facade photos can be deleted while generation records are retained", () => {
  const migrationPath = path.join(root, "supabase_SQL", "Allow Referenced Object Photo Deletion.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  const queueSchema = fs.readFileSync(
    path.join(root, "supabase_SQL", "Facade Generation Worker Queue.sql"),
    "utf8",
  );

  for (const sql of [migration, queueSchema]) {
    assert.match(sql, /alter\s+column\s+photo_id\s+drop\s+not\s+null/i);
    assert.match(sql, /foreign\s+key\s*\(photo_id\)[\s\S]*?on\s+delete\s+set\s+null/i);
    assert.doesNotMatch(sql, /raise\s+exception\s+'FACADE_PHOTO_IN_USE'/i);
    assert.match(sql, /PHOTO_DELETE_FORBIDDEN/i);
    assert.match(sql, /SNAPSHOT_PHOTO_IMMUTABLE/i);
  }
});

test("successful deletion removes the storage object only after the database record", async () => {
  const service = loadDataService();
  const events = [];
  const client = {
    storage: {
      from() {
        return { async remove() { events.push("storage"); return { error: null }; } };
      },
    },
    async rpc(name, args) {
      events.push("database");
      assert.equal(name, "delete_object_photo_safely");
      assert.deepEqual(args, { p_photo_id: 7 });
      return { data: { deleted: true }, error: null };
    },
    from() {
      return {
        delete() { events.push("direct-delete"); return this; },
        eq() { return this; },
        then(resolve) { resolve({ error: null }); },
      };
    },
  };

  await service.deleteObjectPhoto(contextDeps(client), { id: 7, photo_path: "p/7.jpg" });
  assert.deepEqual(events, ["database", "storage"]);
});

test("photo deletion is available to the uploader or an administrator only", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const start = source.indexOf("function canDeletePhotoByUploader(");
  const end = source.indexOf("\nfunction isCommunityGameTableMissingError", start);
  const functionSource = source.slice(start, end);
  const canDelete = new Function(
    "normalizeIdentityName",
    "isAdminIdentity",
    "currentUserName",
    `${functionSource}; return canDeletePhotoByUploader;`,
  )(
    (value) => String(value || "").trim(),
    (name) => name === "管理员",
    "",
  );

  assert.equal(canDelete("张三", "张三"), true);
  assert.equal(canDelete("张三", "管理员"), true);
  assert.equal(canDelete("张三", "李四"), false);
  assert.equal(canDelete("", "张三"), false);
  assert.equal(canDelete("", "管理员"), true);
  assert.equal(canDelete("张三", "张三", "uid-a", "uid-a"), true);
  assert.equal(canDelete("张三", "张三", "uid-a", "uid-b"), false);
});

test("3D upload persists and returns the authenticated display name", async () => {
  const source = fs.readFileSync(path.join(root, "app-3d.js"), "utf8");
  const start = source.indexOf("async function uploadHouseGeneratorPhoto(");
  const end = source.indexOf("\n  async function handleHouseGeneratorPhotoUploadRequest", start);
  const functionSource = source.slice(start, end);
  let insertedPayload = null;
  const bucket = {
    async upload() { return { error: null }; },
    getPublicUrl() { return { data: { publicUrl: "https://example.test/new.jpg" } }; },
    async remove() { return { error: null }; },
  };
  const client = {
    storage: { from() { return bucket; } },
    from() {
      return {
        insert(payload) { insertedPayload = payload; return this; },
        select() { return this; },
        async single() {
          return { data: { id: 9, ...insertedPayload, uploaded_at: "2026-09-10T00:00:00Z" }, error: null };
        },
      };
    },
  };
  global.window = {
    VillageAuth: {
      getCurrentDisplayName: () => "管理员",
      getCurrentUser: () => ({ name: "不应优先采用" }),
    },
  };
  const upload = new Function(
    "supabaseClient",
    "getActiveVillage3DContext",
    "normalizeCode",
    "OBJECT_PHOTOS_TABLE",
    `${functionSource}; return uploadHouseGeneratorPhoto;`,
  )(
    client,
    () => ({
      teachingProjectId: "11111111-1111-4111-8111-111111111111",
      villageId: "22222222-2222-4222-8222-222222222222",
    }),
    (value) => String(value || "").trim(),
    "object_photos",
  );
  const file = new Blob(["photo"], { type: "image/jpeg" });
  Object.defineProperty(file, "name", { value: "facade.jpg" });

  const result = await upload(file, "B-1", "current");

  assert.equal(insertedPayload.uploaded_by, "管理员");
  assert.equal(insertedPayload.survey_layer_key, "building");
  assert.equal(result.uploadedBy, "管理员");
});

test("2D photo cards show facade usage without treating it as a deletion lock", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(source, /used_for_facade_generation/);
  assert.match(source, /已用于 3D 立面生成/);
  assert.match(source, /删除照片不会删除已生成的 3D 模型与生成记录/);
  assert.doesNotMatch(source, /需保留为生成记录，不能直接删除/);
});

test("admin photo management can repair a missing storage object and never deletes storage first", () => {
  const source = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  assert.match(source, /data-repair-photo/);
  assert.match(source, /replaceMissingPhotoFile/);
  const start = source.indexOf("async function handlePhotoDelete(");
  const end = source.indexOf("\n  async function downloadPhoto", start);
  const body = source.slice(start, end);
  assert.match(body, /delete_object_photo_safely/);
  assert.ok(body.indexOf("delete_object_photo_safely") < body.indexOf("storage.from(PHOTO_BUCKET).remove"));
  assert.doesNotMatch(body, /from\(OBJECT_PHOTOS_TABLE\)\.delete/);
});

test("admin photo deletion explains active processing and an unapplied lifecycle migration", () => {
  const source = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  assert.match(source, /function getAdminPhotoDeleteErrorMessage\(/);
  assert.match(source, /FACADE_PHOTO_PROCESSING/);
  assert.match(source, /FACADE_PHOTO_IN_USE/);
  assert.match(source, /数据库仍在使用旧版照片删除规则/);
  assert.equal(
    (source.match(/showAdminNotice\(getAdminPhotoDeleteErrorMessage\(error\), "error"\)/g) || []).length,
    2,
  );
});

test("message detail photos rebuild URLs, offer repair, and authorize deletion before storage removal", () => {
  const source = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  const start = source.indexOf("async function showMessageDetailModal");
  const end = source.indexOf("function bindMessageEvents", start);
  const body = source.slice(start, end);
  assert.match(body, /getPhotoDisplayUrl\(p\)/);
  assert.match(body, /data-repair-photo/);
  assert.match(body, /replaceMissingPhotoFile/);
  assert.match(body, /delete_object_photo_safely/);
  assert.ok(body.indexOf("delete_object_photo_safely") < body.indexOf("storage.from(PHOTO_BUCKET).remove"));
  assert.doesNotMatch(body, /from\(OBJECT_PHOTOS_TABLE\)\.delete/);
});

test("photo cards show an actionable missing-file state instead of staying blank", () => {
  const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(admin, /原图文件已丢失/);
  assert.match(app, /原图文件已丢失/);
});

test("the 3D generator disables a historical photo after its image fails to load", () => {
  const generator = fs.readFileSync(path.join(root, "rural_house_generator", "app.js"), "utf8");
  assert.match(generator, /image\.addEventListener\(['"]error['"]/);
  assert.match(generator, /原图文件已丢失，请返回平台重新上传或删除该记录/);
  assert.match(generator, /card\.classList\.add\(['"]is-missing['"]\)/);
  assert.match(generator, /button\.disabled\s*=\s*true/);
});
