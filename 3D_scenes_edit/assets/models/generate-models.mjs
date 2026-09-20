import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const box = (center, size, color) => ({ center, size, color });

const models = {
  "tree.glb": [box([0, 0, 1.8], [.45, .45, 3.6], "bark"), box([0, 0, 4.4], [2.8, 2.5, 2.4], "leaf"), box([-.7, .2, 5.1], [1.5, 1.5, 1.4], "leaf2")],
  "shrub.glb": [box([0, 0, .32], [1.15, 1.05, .64], "leaf"), box([-.28, .18, .68], [.7, .7, .55], "leaf2"), box([.3, -.12, .63], [.65, .65, .5], "leaf2")],
  "bench.glb": [box([0, 0, .58], [1.8, .55, .16], "wood"), box([0, .23, .92], [1.8, .14, .68], "wood"), box([-.68, 0, .28], [.14, .46, .56], "metal"), box([.68, 0, .28], [.14, .46, .56], "metal")],
  "table.glb": [
    box([0, 0, .76], [1.5, .85, .14], "wood"),
    box([-.55, -.27, .37], [.12, .12, .74], "metal"), box([.55, -.27, .37], [.12, .12, .74], "metal"),
    box([-.55, .27, .37], [.12, .12, .74], "metal"), box([.55, .27, .37], [.12, .12, .74], "metal"),
    box([0, -.75, .47], [1.5, .3, .12], "wood"), box([0, .75, .47], [1.5, .3, .12], "wood"),
    box([-.5, -.75, .22], [.12, .12, .44], "metal"), box([.5, -.75, .22], [.12, .12, .44], "metal"),
    box([-.5, .75, .22], [.12, .12, .44], "metal"), box([.5, .75, .22], [.12, .12, .44], "metal")
  ],
  "lamp.glb": [box([0, 0, 1.55], [.16, .16, 3.1], "metal"), box([0, 0, 3.18], [.58, .58, .22], "dark"), box([0, 0, 3.05], [.42, .42, .22], "light")],
  "bin.glb": [box([-.25, 0, .48], [.42, .45, .92], "blue"), box([.25, 0, .48], [.42, .45, .92], "green"), box([-.25, 0, .97], [.46, .49, .08], "dark"), box([.25, 0, .97], [.46, .49, .08], "dark")],
  "sign.glb": [box([-.48, 0, .75], [.12, .12, 1.5], "wood"), box([.48, 0, .75], [.12, .12, 1.5], "wood"), box([0, 0, 1.45], [1.2, .14, .62], "green"), box([0, -.09, 1.45], [.75, .04, .12], "light")],
  "pavilion.glb": [box([0, 0, .12], [3.8, 3.8, .24], "stone"), box([-1.55, -1.55, 1.8], [.18, .18, 3.4], "wood"), box([1.55, -1.55, 1.8], [.18, .18, 3.4], "wood"), box([-1.55, 1.55, 1.8], [.18, .18, 3.4], "wood"), box([1.55, 1.55, 1.8], [.18, .18, 3.4], "wood"), box([0, 0, 3.55], [4.3, 4.3, .3], "roof"), box([0, 0, 3.82], [3.1, 3.1, .28], "roof")],
  "fitness.glb": [box([-.8, 0, 1], [.16, .16, 2], "blue"), box([.8, 0, 1], [.16, .16, 2], "blue"), box([0, 0, 1.86], [1.7, .16, .16], "orange"), box([0, .45, .65], [1.8, .18, .18], "orange"), box([0, -.45, .35], [1.8, .18, .18], "orange")],
  "play.glb": [box([-1.25, 0, 1.2], [1.2, 1.2, 2.4], "orange"), box([.1, 0, 1.85], [1.8, 1.05, .18], "blue"), box([1.15, 0, .75], [1.6, 1, .18], "yellow"), box([-1.25, 0, 2.55], [1.45, 1.45, .24], "roof"), box([-1.6, -.72, .85], [.14, .14, 1.7], "metal"), box([-.9, -.72, .85], [.14, .14, 1.7], "metal")]
};

const colors = {
  bark: [0.34, 0.18, 0.08, 1], wood: [0.48, 0.25, 0.09, 1], leaf: [0.16, 0.46, 0.18, 1], leaf2: [0.27, 0.62, 0.24, 1],
  metal: [0.22, 0.27, 0.29, 1], dark: [0.09, 0.12, 0.14, 1], light: [1, .82, .35, 1], blue: [.12, .45, .72, 1],
  green: [.12, .52, .3, 1], orange: [.95, .36, .08, 1], yellow: [1, .68, .08, 1], stone: [.48, .5, .48, 1], roof: [.38, .08, .05, 1]
};

function cubeGeometry(part) {
  const [cx, cy, cz] = part.center, [sx, sy, sz] = part.size;
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const faces = [
    [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1],[1,0,0]], [[x0,y1,z0],[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[-1,0,0]],
    [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0,1,0]], [[x1,y0,z0],[x0,y0,z0],[x0,y0,z1],[x1,y0,z1],[0,-1,0]],
    [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]], [[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[0,0,-1]]
  ];
  const toGltf = ([x, y, z]) => [x, z, -y];
  const positions = [], normals = [], indices = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) { positions.push(...toGltf(face[i])); normals.push(...toGltf(face[4])); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices), min: [x0,z0,-y1], max: [x1,z1,-y0] };
}

function makeGlb(parts) {
  const chunks = [], bufferViews = [], accessors = [], primitives = [], materials = [], materialIds = new Map();
  let byteLength = 0;
  const append = (typed, target) => {
    while (byteLength % 4) { chunks.push(Buffer.alloc(1)); byteLength++; }
    const data = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, target });
    chunks.push(data); byteLength += data.length;
    return index;
  };
  const material = (name) => {
    if (materialIds.has(name)) return materialIds.get(name);
    const index = materials.length;
    materials.push({ name, pbrMetallicRoughness: { baseColorFactor: colors[name], metallicFactor: name === "metal" ? .55 : 0, roughnessFactor: .78 } });
    materialIds.set(name, index); return index;
  };
  for (const part of parts) {
    const geometry = cubeGeometry(part);
    const positionView = append(geometry.positions, 34962), normalView = append(geometry.normals, 34962), indexView = append(geometry.indices, 34963);
    const positionAccessor = accessors.push({ bufferView: positionView, componentType: 5126, count: 24, type: "VEC3", min: geometry.min, max: geometry.max }) - 1;
    const normalAccessor = accessors.push({ bufferView: normalView, componentType: 5126, count: 24, type: "VEC3" }) - 1;
    const indexAccessor = accessors.push({ bufferView: indexView, componentType: 5123, count: 36, type: "SCALAR" }) - 1;
    primitives.push({ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: indexAccessor, material: material(part.color) });
  }
  while (byteLength % 4) { chunks.push(Buffer.alloc(1)); byteLength++; }
  const binary = Buffer.concat(chunks);
  const gltf = { asset: { version: "2.0", generator: "Village Storymap local low-poly generator" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }], materials, buffers: [{ byteLength }], bufferViews, accessors };
  const jsonSource = Buffer.from(JSON.stringify(gltf));
  const jsonPadding = (4 - jsonSource.length % 4) % 4;
  const json = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)]);
  const total = 12 + 8 + json.length + 8 + binary.length;
  const header = Buffer.alloc(12); header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}

for (const [name, parts] of Object.entries(models)) fs.writeFileSync(path.join(directory, name), makeGlb(parts));
console.log(`Generated ${Object.keys(models).length} local GLB models in ${directory}`);
