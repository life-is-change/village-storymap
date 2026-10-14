#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { processModel } from './pipeline.mjs';

const help = `CPU-only GLB variant processor (Node.js >=22)
Usage: node tools/model-processor/cli.mjs --input model.glb --output new-directory

  --input PATH               Single self-contained GLB v2 (required)
  --output PATH              New output directory (required; never overwritten)
  --high-ratio NUMBER        Mesh triangle target ratio, default 1
  --low-ratio NUMBER         Mesh triangle target ratio, default 0.35
  --high-texture-size NUMBER Maximum texture edge, default 2048
  --low-texture-size NUMBER  Maximum texture edge, default 512
  --error NUMBER             Simplification error / mesh radius, default 0.01
  --help                     Show this message

Output: original.glb (byte-for-byte), high.glb, low.glb, manifest.json.
No GPU, server deployment, or output geometry decoder is required.`;

try {
  const { values } = parseArgs({ options: Object.fromEntries([
    ['input', 'string'], ['output', 'string'], ['high-ratio', 'string'], ['low-ratio', 'string'],
    ['high-texture-size', 'string'], ['low-texture-size', 'string'], ['error', 'string'], ['help', 'boolean'],
  ].map(([name, type]) => [name, { type }])), strict: true });
  if (values.help) {
    console.log(help);
  } else {
    const options = { input: values.input, output: values.output };
    for (const [argument, property] of [['high-ratio', 'highRatio'], ['low-ratio', 'lowRatio'], ['high-texture-size', 'highTextureSize'], ['low-texture-size', 'lowTextureSize'], ['error', 'error']]) {
      if (values[argument] !== undefined) options[property] = Number(values[argument]);
    }
    const manifest = await processModel(options);
    console.log(JSON.stringify({ output: values.output, originalBytes: manifest.original.bytes, high: manifest.variants.high, low: manifest.variants.low, processing: manifest.processing }, null, 2));
  }
} catch (error) {
  console.error(`Model processing failed: ${error.message}`);
  process.exitCode = 1;
}
