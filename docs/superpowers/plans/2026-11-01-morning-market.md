# In-village Morning Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user explicitly chooses delegated execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有三维村庄中完成一次精细摊位早市的到岗、进场、交流、购买、离场流程。

**Architecture:** 复用 SceneDocument、Cesium Viewer、现有配置保存和模拟会话。新增纯数据的市场内部路径与确定性早市运行器，由既有 Simulation 工厂按显式情境选择；每轮只有一个时钟和一套人物快照。市场和摊位仍是现有场景对象，运行姿态不回写设计。

**Tech Stack:** 原生 JavaScript UMD/CommonJS、Node test、Cesium 1.118、现有 GLB 资产管线；不新增运行时库、数据库、付费服务或 GPU 后端。

**Spec:** `docs/superpowers/specs/2026-11-01-morning-market-design.md`，用户已确认；补充要求：模型精细一些，专门的摆货/递菜/提菜动画暂缓，优先完整流程。

## Global Constraints

- 在原项目 main 实施，保留已有无关文件，不另建工作树。
- 默认 6 摊主、12 顾客，06:00—10:00；角色来自同一合成人口，村路和市场内保持 ID 与位置连续。
- 市场不修改共享现状；使用现有管理员试用/小组方案权限和保存冲突处理。
- 保留可编辑场地、6 个摊位、入口和通道；专门的肢体动画不作为首版完成条件。用文字/图标标明到岗、营业、交流、已购买和离场。
- 精细摊位至少包含棚架/棚布、台面、货筐、可辨认的蔬菜/水果/豆制品、秤、招牌和袋子；不是仅把现有简棚改名。
- 不新增随机装饰人群，不无条件把购买记成功，不在每个摊位复制同一人物，不把早市局部摘要当全日结算。
- 产品实现与真实场景验收完成后再确认生产发布；本计划不自动执行阿里云更新。

## Review Focus

1. 原始数据中重复 ID、不同几何及旧配置引用：Task 1 保留全部真实对象并检验确定性身份。
2. 编辑后的摊位、曲折/凹形场地、堵塞通道：Task 3 拒绝穿摊和越界路线，不使用固定动画轨迹掩盖断路。
3. 摊主迟到、缺席、队列满和营业结束：Task 4 不产生幽灵交易或永久等待。
4. 重开/调速/异步保存返回/重启运行：Task 5 防止重复人物、重复记账和旧运行污染。
5. 首次三维启动、多个共享模型、暂停后耗电：Task 7 做真实浏览器及渲染生命周期验证。

## 文件与接口边界

- 现状身份：`3D_scenes_edit/integration/platform-bridge.js`；保持 `buildSceneEditContext(state)` 同步接口。
- 市场预设：新增 `3D_scenes_edit/domain/market-preset.js`，`createMarketPreset({field,idPrefix,assets}) -> {ok,command,marketId,errors}`。command 为一次性 `addMarketPreset`，包含父场地、内部通道、摊位和资产引用。
- 精细资产：新增 `3D_scenes_edit/assets/market/generate-market-models.mjs` 与生成的 GLB；通过 seed catalog 和既有素材解析加载。
- 内部路径：新增 `village_game/domain/market-layout.js`，`compileMarketLayout({field,stalls,aisles,obstacles,gate}) -> {ok,layout,errors}`；layout 是可哈希的普通数据，`route(layout,from,to) -> {points,distance}|null`。
- 早市运行：新增 `village_game/domain/morning-market.js`，`createSimulation(scene) -> {step(minutes),snapshot(),result()}`，与既有 Simulation 工厂和会话接口一致。
- 模式接入：`config.morningMarket` 可选，含 marketKey、vendorCount、customerCount、startMinute=360、openMinute=390、lastEntryMinute=570、endMinute=600。compile 输出 `scene.morningMarket={marketId,layout,roles,times}`；仅显式开启时选择早市运行器。
- 运行快照沿用 agents/day/minute/progress/done，增加 `runKind:'morning-market'`、`market` 状态和摘要；同一 agents 数组中人物字段增加 marketRole、stallId、marketState、purchaseStatus、dialogue，普通模式不要求这些字段。

### Task 1: 修复现状源编号冲突

**Files:** Modify `3D_scenes_edit/integration/platform-bridge.js`、`village_game/integration/plan-adapter.js`；Test 对应 `.test.js`。

已只读确认 `data/buildings.geojson` 有 196 个 Feature，properties.id 的 2/3/4 各出现两次且几何不同；当前 bridge 优先使用该属性 ID，因此 catalog 的 MultiPolygon 分片键会重复。

- [ ] 写失败回归：重复数据 ID 不同几何均保留；输入顺序颠倒身份不变；不同图层相同 ID 不冲突；真实数据经 bridge→catalog 不抛重复错误。保留独立对象，不按名称合并。
- [ ] Run `node --test 3D_scenes_edit/integration/platform-bridge.test.js village_game/integration/plan-adapter.test.js`，确认新回归因重复身份失败。
- [ ] 为发生碰撞的身份组加确定性的几何身份区分；唯一旧键不变，旧别名只在唯一匹配时恢复。摘要碰撞必须显式拒绝，不能用数组顺序或随机数改号。完全相同的重复记录是否源自重复传入需核实并给出明确处理，不能误删不同几何。
- [ ] 重跑上述测试；补查已有引用无法唯一恢复时保持可见、提示重新选择，不自动关联到任意房屋。
- [ ] Commit `fix: preserve distinct baseline features with duplicate data ids`。

### Task 2: 可编辑早市预设与精细静态资产

**Files:** Create `3D_scenes_edit/domain/market-preset.js`、`market-preset.test.js`、`3D_scenes_edit/assets/market/generate-market-models.mjs`、`market-models.test.js` 与 GLB；Modify `domain/scene-commands.js`、`map_2d/scene-editor-controller.js`、`assets/seed/catalog.json`、`ui/scene-studio-panel.js`、`index.js`、根 `index.html`。

- [ ] 写失败回归：一次放置产生 1 个父场地、6 个有稳定 ID 的摊位和内部通道；每个子对象标明 marketId/marketRole；完整 undo/redo；不满足范围、村界或现状碰撞时零部分写入。
- [ ] Run 新测试和现有 scene-commands/controller 测试，确认新功能回归失败。
- [ ] 实现预设 command 和 controller 入口，在选中场地时提供“布置早市”。确认后才添加对象，保持普通场地编辑语义。市场父对象沿用 activity-field，摊位沿用 stall，内部通道标为场地组件，不重复计入村路。
- [ ] 建立蔬菜、水果、豆制品/干货三类精细模型（4/1/1 摊位配置），可辨认棚布边缘、框架、台面、分格筐和立体货品；使用原创几何和材质。复用已有 GLB 坐标约定，资产每种建议不超过 2 万三角面、默认 6 摊总量不超过 12 万面；确需超出时说明测量依据。
- [ ] Run 模型生成器和资产测试：GLB 头/JSON、有限坐标、占地/高度、非空网格和多类货品、目录引用；真实 Cesium 近景检查大小、朝向、可见货品与遮挡。模型质量以实际渲染画面验收，不以节点数量冒充精细度。
- [ ] Commit `feat: add editable morning market preset and detailed stall models`。

### Task 3: 场内路径与现有村路交接

**Files:** Create `village_game/domain/market-layout.js`、`market-layout.test.js`；Modify `village_game/integration/plan-adapter.js`、`domain/scene.js`、`views/catalog.js`、`domain/population.js`。

- [ ] 写失败回归：入口到各服务/排队/摊主位可达；旋转/移动摊位后重算；凹形范围、挡住通道、摊位越界、多个断开分量不穿越。内部多处站位不重复产生独立设施容量。
- [ ] Run 新路径测试，确认缺少 compile/route 实现而失败。
- [ ] 实现米制内部通道图和实际障碍检查；外部路网仍用 Network.route，入场在共同 gate 坐标交接。layout 仅普通数据，无 Viewer/函数/纹理句柄进入摘要。父场地可进入，其他现状障碍仍保留。
- [ ] 新增 market 设施用途及可选 morningMarket 配置验证。编译父场地归属摊位、角色和时段，拒绝无入口、无合适住宅、角色不足或子组件越界；提供显式“早市教学情境”的合成人口预设，不依赖原下午购物安排，也不强改普通村庄日程。
- [ ] 运行 layout、plan-adapter、population、scene 验证测试，确认旧配置没有 morningMarket 时行为不变；输入摘要包含新配置与布局。
- [ ] Commit `feat: compile market walkways and a shared teaching population`。

### Task 4: 确定性早市全过程

**Files:** Create `village_game/domain/morning-market.js`、`morning-market.test.js`；Modify `domain/simulation.js` 与测试。

- [ ] 写失败回归：2 摊主+4 顾客全部从住宅出发、到岗、进场、对话购买、沿路返家；同种子同输入及 step(1)/step(15)/分数步进结果一致。
- [ ] Run `node --test village_game/domain/morning-market.test.js`，确认缺失运行器而失败。
- [ ] 实现单一模拟时钟、稳定角色分配和事件状态机；外部行程与场内路线连续，snapshot 不再把市场内的人简化成入口空心点。仅营业摊位服务，每摊同一时刻 1 顾客，队列最多 3 人，达到最大等待 15 分钟可改选或离场。
- [ ] 对话绑定真实角色、摊位、交易 ID；一次购买产生唯一完成事件与已购买标记，无货币/支付系统。06:00 错峰进场摆摊准备，06:30 起接待，09:30 后不接新顾客，10:00 局部演示结束；已开始服务可完成，队列退出理由明确。摊主清空队列后简化收摊返家。
- [ ] 补充缺席、不可达、过早/过晚、满队、无可买摊、结束时未返家测试；验证无成功购买却提菜、同一交易重复计数、永久等待均不会发生。6 摊主+12 顾客默认情境完整回归。
- [ ] Commit `feat: simulate vendor arrival shopping conversations and market departures`。

### Task 5: 会话、保存、重放与早市局部结果

**Files:** Modify `village_game/integration/plan-adapter.js`、`session.js`、`loader.js` 与对应测试。

- [ ] 写失败回归：保存失败/25 秒超时不启动；旧保存响应不启动新一轮；重开配置和摘要无丢失；早市结果标记 runKind 与 06—10 窗口，不显示为完整一天。
- [ ] Run session/adapter 新回归，确认失败。
- [ ] 工厂按 scene.morningMarket 选择单一运行器，普通场景沿用既有 Life。scene.morningMarket 和规则/预设版本参与摘要。Session.summarize 保留市场摘要，finish 在早市窗口结束，不篡改全日模式。
- [ ] 确保暂停/调速/重新开始不改变人物数量或交易数；选择新方案或退出时释放旧模拟及事件。新增字段兼容旧 config/runs；市场输入变化后不可显示旧结果为同条件。
- [ ] Run `node --test village_game/integration/session.test.js village_game/integration/plan-adapter.test.js` 与工厂测试，覆盖全日模式不变。
- [ ] Commit `feat: persist and replay bounded morning market runs`。

### Task 6: 同一 Cesium 场景中的近景人物与市场状态

**Files:** Modify `village_game/integration/overlay.js`、`views/characters.js`、`views/observation.js`；Create `village_game/integration/market-overlay.js` 与对应测试。

- [ ] 写失败回归：人物一直是同一 entity/ID、在实际场内坐标显示（不应用现有 layout 的最高 2.8m 人物散点偏移）；只有正在交流者出现对话；购买前无已购买标记；放大/跟随不改实际脚点。
- [ ] Run overlay/characters 新回归，确认失败。
- [ ] 复用原创人物，市场内不因室内分类隐藏，跳过通用展示散点偏移，保留真实通道/队列坐标；显示简洁营业状态、顾客/摊主身份及已购买图标。专门摆货、递交、提袋骨骼/逐帧动作不实现为强制项。
- [ ] 实现少量气泡的轮流发言、“观察早市”定位和可取消人物跟随；事件不反复抢相机。模型/角色图共享缓存，地面高度按位置/地形版本缓存；运行时状态不回写设计对象。
- [ ] Run 生命周期与异步模型加载回归：旧运行的晚到资源不污染新场景，dispose 释放监听/实体；暂停后不持续请求无意义重绘。实际近景检查货品细节、脚底贴地和标签遮挡。
- [ ] Commit `feat: show market conversations and purchases in the village 3D view`。

### Task 7: 用户完整流程与真实村庄验收

**Files:** Modify `village_game/integration/workspace.js`、`workspace.css`、`integration/README.md`、相关缓存版本；Create `village_game/integration/morning-market-flow.test.js`、`docs/acceptance/2026-11-01-morning-market.md`。

- [ ] 写失败流程回归：从已有市场和住宅开始，一次选择早市教学情境、检查、保存、播放、看摊前对话/购买、结束查看市场摘要；不要求逐个人设置身份。
- [ ] 在现有模拟工作区提供早市模式、定位、阶段与计数、人物状态和局部摘要；如果住宅/入口不足，明确指出并提供选择，不静默认定附近房屋为住宅。配置时段/人数可见，默认 6/12，模型细节不依赖独立网页。
- [ ] Run 上述流程测试，再运行 `npm test`。核对 index/loader 的新文件加载顺序及缓存；现有全日与场景编辑测试不回退。
- [ ] 浏览器在米埗村、深井村分别完成一次真正的方案检查/保存/刷新重开/早市播放；明确使用隔离验收方案，不覆盖小组方案。无外网权限时继续本地实际 Cesium 验收并如实记录待线上项，不能把 fixture 通过当线上保存通过。
- [ ] 默认 6 摊主+12 顾客近景观察一整场，记录身份/交易/失败/等待与人数、模型量、帧率、暂停重绘；复查首次进入 3D 的地形/相机回归及退出还原。录下开市、交易、散场三个实际状态画面交用户验收，发现问题先修复再声称完成。
- [ ] Commit `feat: integrate and verify the complete in-village morning market flow`。

## 交付与执行方式

默认建议由当前代理逐任务直接实施，再做一次独立的整体代码复核；任务间对人口、路径、交易和快照接口依赖紧密，直接实施可减少反复交接。若用户希望分任务代理实施，则遵循对应技能，每任务独立实现/复核。

计划自审：设计的场景、角色、营业节奏、内部路径、交流购买、保存重放、显示/性能及真实验收均映射至上述任务。已按用户补充把专门动作动画从完成条件移除；精细静态模型和完整行为闭环保留。尚需用户查看计划并确认执行方式，然后开始产品实现。

