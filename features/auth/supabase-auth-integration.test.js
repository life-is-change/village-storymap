const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

test("auth runtime uses Supabase password auth instead of public identity tables", () => {
  const source = fs.readFileSync(path.join(root, "auth-system.js"), "utf8");

  assert.match(source, /auth\.signUp\s*\(/);
  assert.match(source, /auth\.signInWithPassword\s*\(/);
  assert.match(source, /auth\.onAuthStateChange\s*\(/);
  assert.doesNotMatch(source, /from\(["']auth_users["']\)/);
  assert.doesNotMatch(source, /from\(["']user_sessions["']\)/);
  assert.match(source, /id=["']authPassword["']/);
  assert.match(source, /id=["']authPasswordConfirm["']/);
});

test("auth model loads before the compatible auth facade", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const model = html.indexOf('src="features/auth/supabase-auth-model.js');
  const facade = html.indexOf('src="auth-system.js');
  assert.ok(model >= 0 && facade > model);
});

test("homepage authentication scripts use one cache-busting release version", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const modelVersion = html.match(/features\/auth\/supabase-auth-model\.js\?v=([\w-]+)/)?.[1];
  const accessVersion = html.match(/features\/auth\/access-control\.js\?v=([\w-]+)/)?.[1];
  const authVersion = html.match(/auth-system\.js\?v=([\w-]+)/)?.[1];

  assert.ok(modelVersion, "auth model script should be versioned");
  assert.equal(accessVersion, modelVersion);
  assert.equal(authVersion, modelVersion);
});

test("the map application reuses the single shared Supabase client", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(source, /window\.VillageSupabaseClient\s*\|\|/);
});

test("the 3D application reuses the authenticated shared Supabase client", () => {
  const source = fs.readFileSync(path.join(root, "app-3d.js"), "utf8");

  assert.match(source, /const supabaseClient\s*=\s*window\.VillageSupabaseClient\s*\|\|\s*null/);
  assert.doesNotMatch(source, /supabase\.createClient\s*\(/);
});

test("the map application requests the authenticated 3D client release", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

  assert.match(source, /app-3d\.js\?v=20260813-model-card-ui/);
});

test("the 3D generator bridge serves existing building photos from the shared client", () => {
  const source = fs.readFileSync(path.join(root, "app-3d.js"), "utf8");
  const photoQuerySource = source.slice(
    source.indexOf("async function fetchHouseGeneratorPhotoMaterials"),
    source.indexOf("async function handleHouseGeneratorPhotoRequest")
  );

  assert.match(source, /village-house-generator:request-photo-materials/);
  assert.match(source, /village-house-generator:photo-materials/);
  assert.match(source, /const OBJECT_PHOTOS_TABLE\s*=\s*["']object_photos["']/);
  assert.match(source, /from\(OBJECT_PHOTOS_TABLE\)/);
  assert.match(photoQuerySource, /from\(OBJECT_PHOTOS_TABLE\)[\s\S]*?\.select\(["']\*["']\)/);
  assert.doesNotMatch(photoQuerySource, /\.eq\(["']object_code["']/);
  assert.match(photoQuerySource, /normalizeCode\(item\?\.object_code\)\s*===\s*normalizedSourceCode/);
  assert.doesNotMatch(
    source,
    /select\(["'][^"']*created_at[^"']*["']\)/,
    "object_photos has uploaded_at but no created_at column"
  );
  assert.doesNotMatch(
    source,
    /select\(["'][^"']*uploaded_by[^"']*["']\)/,
    "object_photos uploader metadata is optional and absent in the deployed schema"
  );
  assert.match(source, /building__\$\{spaceId\}/);
  assert.match(source, /const sourceCode\s*=\s*String\(payload\.sourceCode\s*\|\|\s*["']{2}\)\.trim\(\)/);
  assert.match(source, /entity\.__photoSourceCode\s*=\s*rawSourceCode/);
  assert.match(source, /entity\?\.__photoSourceCode\s*\|\|\s*entity\?\.__sourceCode/);
  assert.match(source, /event\.source\.postMessage/);
});

test("the administrator page loads Supabase before auth and uses profiles", () => {
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  const sdk = html.indexOf("@supabase/supabase-js@2");
  const model = html.indexOf('src="features/auth/supabase-auth-model.js');
  const facade = html.indexOf('src="auth-system.js');
  assert.ok(sdk >= 0 && model > sdk && facade > model);

  const source = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  assert.match(source, /from\(["']profiles["']\)/);
  assert.match(source, /functions\.invoke\(["']admin-delete-user["']/);
  assert.doesNotMatch(source, /from\(["']auth_users["']\)/);
});
