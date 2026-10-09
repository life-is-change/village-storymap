const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;

test("every archived source exists and matches its recorded sha256", () => {
  const manifest = require("./provenance.json");
  for (const source of manifest.sources) {
    for (const file of source.files) {
      const bytes = fs.readFileSync(path.join(root, source.folder, file.name));
      assert.equal(bytes.length, file.bytes, `${source.folder}/${file.name} byte length`);
      assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
        `${source.folder}/${file.name} sha256`
      );
    }
  }
});

test("legacy code is excluded from production loading", () => {
  for (const file of ["../../index.html", "../../app.js", "../../app-3d.js"]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, file), "utf8"),
      /3D_scenes_edit[\\/]legacy/
    );
  }
});
