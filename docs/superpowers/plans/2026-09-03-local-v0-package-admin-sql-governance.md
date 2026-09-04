# Local V0 Package, Admin Workflow, and SQL Governance Plan

**Goal:** Deliver a local one-click village data processor, a safe manual package-import workflow in the administrator page, and a documented Supabase SQL inventory without committing changes to Git.

**Architecture:** Keep geoprocessing and package assembly in the existing Python server package. Install only a launcher/configuration shell in `E:\村规平台数据处理工具`, using the existing building and GIS Conda environments. The web administrator uploads the generated folder, validates its manifest and files, writes them to the private `village-datasets` bucket, saves a dataset draft, and explicitly publishes/binds it. Cesium reality-model publication remains a separate mid-semester workflow.

**Tech Stack:** Python 3.10/3.11, FastAPI/local browser UI, GeoPandas/GDAL, vanilla JavaScript, Supabase Storage/PostgreSQL, Node test runner, pytest.

---

### Task 1: Define and test the V0 package contract

**Files:**
- Create: `server/tests/test_v0_package.py`
- Create: `server/src/village_processing/v0_package.py`

1. Write failing tests for required layers, manifest paths, SHA-256 hashes, invalid output rejection, and ZIP creation.
2. Run the focused pytest file and confirm the expected import failure.
3. Implement deterministic package assembly and validation.
4. Re-run focused tests.

### Task 2: Build the local one-click processing application

**Files:**
- Create: `server/tests/test_local_tool_contract.py`
- Create: `server/src/village_processing/local_tool.py`
- Create: `server/src/village_processing/local_runner.py`
- Create: `server/local_tool/install/start-village-data-tool.ps1`
- Create: `server/local_tool/install/README.txt`
- Modify: `server/pyproject.toml`

1. Write contract tests for input validation, safe job paths, environment health timeouts, and status transitions.
2. Implement a localhost-only wizard with upload, job progress, validation results, and output location.
3. Reuse the current building, OSM, contour, raster, and preview processors; never create a third Conda environment.
4. Add a staged health check so a hanging CUDA/MMDetection import is terminated and reported instead of blocking indefinitely.
5. Install the launcher files into `E:\村规平台数据处理工具` after resolving the exact target.

### Task 3: Add browser-side package validation and upload

**Files:**
- Create: `features/admin/village-package.js`
- Create: `features/admin/village-package.test.js`
- Modify: `features/admin/village-admin.js`
- Modify: `features/admin/village-admin.test.js`

1. Write failing tests for folder normalization, required-file validation, malformed manifests, hash mismatches, and storage path construction.
2. Implement validation with browser SHA-256 and explicit error reporting.
3. Upload validated files to `village-datasets`, then call the existing dataset-draft RPC with storage paths only.
4. Keep publish/bind as a separate administrator action.

### Task 4: Rebuild the administrator village page

**Files:**
- Modify: `admin.html`
- Modify: `admin.js`
- Modify: `features/admin/village-admin-runtime.test.js`

1. Add semantic and runtime tests for the three-step workflow and retained 3D section.
2. Replace the squeezed horizontal toolbar with numbered workflow cards, progress/status panels, responsive fields, and clear primary/secondary actions.
3. Retain the standalone Cesium Asset ID, title, height offset, save, and publish controls.
4. Verify desktop and narrow layouts in the browser.

### Task 5: Add safe Supabase storage policy and SQL catalog

**Files:**
- Create: `supabase_SQL/Village Dataset Package Storage.sql`
- Create: `supabase_SQL/README.md`
- Create: `features/data/village-dataset-storage-migration.test.js`

1. Write a migration contract test for private-bucket enforcement, administrator writes, and authenticated reads restricted to published package paths.
2. Add an idempotent storage migration and policies.
3. Catalog active migrations, operations/diagnostics, superseded scripts, and destructive legacy scripts; do not remove executed schema merely because an old script is redundant.

### Task 6: Verify the complete workflow

1. Run focused Python and JavaScript tests.
2. Run the full root JavaScript suite and server pytest suite.
3. Run syntax/build checks and inspect the administrator UI in a logged-in browser.
4. Exercise a lightweight package smoke test without invoking the expensive building model.
5. Report any machine/runtime limitation separately from application correctness.

### Task 7: Tidy Supabase saved queries

1. Rename useful `Untitled query` snippets based on their audited purpose.
2. Present the exact duplicate/destructive saved-query list immediately before deletion and request confirmation.
3. Delete only after that confirmation; no database object is dropped by deleting an editor snippet.

**Constraint:** Preserve all pre-existing working-tree changes and do not create a Git commit.
