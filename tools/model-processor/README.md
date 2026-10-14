# CPU 模型变体处理工具

平台的学生上传、场景设计上传及贴图替换已自动生成高低模型，学生不需要运行本工具。这里的 CLI 用于开发者批处理资产。浏览器版本入口为 `browser-variants.mjs`，运行 `npm run build:browser` 可重建随网站提供的后台处理线程；打包产物已纳入项目。

这个离线 Node.js 工具将一个自包含 GLB v2 制作为网页使用的高、低清变体。只使用 CPU（glTF Transform、Meshoptimizer WASM、Sharp），不需要 RTX 4090、CUDA、浏览器 WebGL 或服务器部署。它是可运行的本地处理流程；服务器队列和远端自动处理尚未接入。

## 安装与运行

Node.js 22 或更新版本，在本目录执行：

```powershell
npm ci --registry=https://registry.npmjs.org
npm test
```

从项目根目录运行，输出目录必须是新目录：

```powershell
node tools/model-processor/cli.mjs --input 3D_scenes_edit/assets/models/bench.glb --output tools/model-processor/output/bench
```

自定义贴图上限与减面目标：

```powershell
node tools/model-processor/cli.mjs --input "D:/models/house.glb" --output "D:/models/house-web" --high-texture-size 1024 --low-texture-size 512 --low-ratio 0.35 --error 0.01
```

`--input` 接受一个 GLB 文件，不接受目录。批量任务可以逐个调用，每个模型使用独立新输出目录。输入与输出相同、输出目录已经存在、非法参数、非完整 GLB、外部资源或未知扩展都会拒绝处理，不会覆盖已有模型。`--help` 显示全部参数。

## 输出和默认策略

| 文件 | 用途 |
| --- | --- |
| `original.glb` | 与输入逐字节相同，保留原始完整模型；SHA-256 在清单中 |
| `high.glb` | 高质量网页模型；默认不减面，去重、焊接，贴图最大边 2048 px |
| `low.glb` | 低清模型；默认减面目标 35%，贴图最大边 512 px |
| `manifest.json` | 处理完成标记、相对 URL、字节数、哈希、三角形/纹理数量、尺寸、参数和警告 |

工具先用 NodeIO 和 CPU MeshoptDecoder 解码源几何，移除已有 Meshopt 压缩扩展，序列化为未压缩 GLB，然后调用项目的 `features/models/glb-normalization.js`，读取实际 POSITION 顶点及索引并计算世界边界。它保持模型比例和 glTF 米制单位，将活动场景的底面中心移到原点。高、低清模型都读取同一份已归一化源数据，使用完全相同的根变换，不会再次按简化后的边界缩放或移动。根 `extras.villageModel` 标记也保留，供平台识别已归一化模型。保存的 `original.glb` 始终来自未经解码、改写的输入字节。

清单 `bounds.size` 按 glTF `[X, Y, Z]` 排列，`footprint` 为原归一化模型的 `[X, Z]`，`height` 为其 `Y`。每档变体都有自己实际计算的边界，同时共享用于放置的 `footprint`/`height`，切换 LOD 不改变占地尺寸。URL 均相对清单所在目录，例如 `variants.low.url` 为 `low.glb`。平台上传时保留四个文件之间的对应关系，并按实际存储地址映射 URL；这个 CLI 不会自动上传。

低清简化是有损操作：误差上限默认是网格半径的 1%，锁定网格边界，保留材质与 UV 分界。少于 32 个三角形的部件保留原几何。拓扑和误差约束可能使三角形数量达不到目标；清单会报告未减面的警告和跳过部件数量。不会为了达到数字目标删除部件。贴图保持原 JPEG/PNG 等编码格式及长宽比，不新增 WebP、Draco、Meshopt 或 KTX2 解码要求。带蒙皮或 POSITION 形态目标的模型不能用静态顶点保证姿态锚点；共享归一化会明确拒绝，并提示先导出静态姿态，源文件不变。

不默认量化或几何压缩，普通网页 GLB 加载器可以读取默认输出。已有 Meshopt 压缩可用 CPU 解码后输出未压缩几何；Draco 源文件需要先导出为未压缩 GLB。原有未知扩展拒绝处理，防止静默丢失模型表现。已有 KTX2 等特殊纹理的源模型可能仍需其原有解码器，Sharp 不能对它们进行普通图片缩放；需要先由资产工具导出 PNG/JPEG。

这是内存中的处理管线，大模型需要足够的主机 RAM，处理速度由模型拓扑、贴图数量与 CPU 决定。输出仅在处理完成后创建；如磁盘写入失败，可能留下没有 `manifest.json` 的未完成目录，应使用新的目录重试。

## 可复现验证

依赖版本与 `package-lock.json` 锁定。Sharp 统一到 0.35.5，`ndarray-pixels` 固定 5.0.1 并覆盖其 Sharp 为同一版本，避免 Windows 原生 DLL 混装。测试使用真实生成的 2048 面和 2048×1024 PNG 模型，验证原件字节/哈希、实际减面、贴图缩放、共同根矩阵、GLB 重读、拒绝覆盖及非法输入；另用 MeshoptEncoder 生成压缩源验证解码。浏览器引擎另验证 1152 面带透明 PNG 模型，高模保持原贴图、低模缩到 512×256，并执行实际打包 Worker。

本仓库 `bench.glb` 的 CPU 实跑记录：输入 5,156 字节、48 个三角形、4 个部件；两档输出均为 4,056 字节、48 个三角形，处理约 22 ms（耗时仅供本次机器参考）。该模型没有贴图，每个小部件仅 12 个三角形，因此低清保留全部部件，清单如实提示三角形未减少。用官方 MeshoptEncoder 生成的压缩长椅源为 3,840 字节，实际 CLI 解码处理后两档均为 3,700 字节，约 21 ms，保持 48 个三角形及全部部件。测试另验证 POSITION 形态目标的明确拒绝和原文件不变。输出示例在本目录忽略的 `output/` 下，不提交原模型副本。

算法与参数说明见官方文档：[simplify](https://gltf-transform.dev/modules/functions/functions/simplify)、[weld](https://gltf-transform.dev/modules/functions/functions/weld)、[textureCompress](https://gltf-transform.dev/modules/functions/functions/textureCompress)。
