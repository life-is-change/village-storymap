import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink() || item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'runtime_storage') continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) walk(path);
    else if (item.name.endsWith('.test.js')) files.push(path);
  }
}
for (const directory of ['features', 'homepage/src', '3D_scenes_edit', 'rural_house_generator']) walk(resolve(root, directory));
files.sort();
if (!files.length) throw new Error('No platform tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
