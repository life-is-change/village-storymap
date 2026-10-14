import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
await build({absWorkingDir:root,entryPoints:['tools/model-processor/browser-worker-entry.mjs'],bundle:true,platform:'browser',format:'iife',target:['es2022'],minify:true,legalComments:'linked',outfile:'assets/vendor/model-optimizer/automatic-model-worker.js'});
