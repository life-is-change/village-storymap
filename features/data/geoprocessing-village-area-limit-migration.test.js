const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(__dirname, "../../supabase_SQL/Geoprocessing Village AOI Limits.sql");

test("Hongxing limit is configured as 10 square kilometres without raising Mibu's limit", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /'79ea2696-baf9-4194-acf0-fb29667bd874'[^;]*?10::numeric/is);
  assert.match(sql, /'00000000-0000-4000-8000-000000000001'::uuid,\s*2::numeric/i);
  assert.match(sql, /get_geoprocessing_source_status[\s\S]*?coalesce\(g\.max_aoi_sq_km,\s*2\)/i);
});

test("submission enforces the same village limit reported by source status", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /v_max_area\s*:=\s*v_source\.max_aoi_sq_km/i);
  assert.match(sql, /st_area\(v_geom::geography\)\s*>\s*v_max_area\s*\*\s*1000000/i);
  assert.match(sql, /AOI_OUTSIDE_VILLAGE/i);
  assert.match(sql, /AOI_OUTSIDE_SOURCE/i);
  assert.match(sql, /PROJECT_ACCESS_REQUIRED/i);
});

test("limit migration keeps the registered source bounds without requiring PostGIS in the SQL editor search path", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /coalesce\(source\.bounds,\s*existing\.bounds\)/i);
  assert.doesNotMatch(sql, /st_xmin\(box2d\(village\.boundary\)\)/i);
});
