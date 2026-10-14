# Automatic model worker

Built from `tools/model-processor/browser-worker-entry.mjs` with the locked build dependencies. Rebuild from the project root:

```sh
npm --prefix tools/model-processor ci
npm --prefix tools/model-processor run build:browser
```

The committed worker includes glTF Transform and Meshoptimizer WASM. It needs no external CDN, Node.js installation on student computers, CUDA, or GPU queue. Texture downsampling uses the browser's OffscreenCanvas inside a Web Worker. The original GLB is uploaded separately; both output variants keep the same normalization anchor.

Dependency licenses are retained in `THIRD-PARTY-LICENSES.txt` and the generated `automatic-model-worker.js.LEGAL.txt`.
