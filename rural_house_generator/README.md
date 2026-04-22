# 乡村住宅参数生成器 v1

这是一个可直接打开运行的前端网页原型，适合用于：

- 输入建筑长度、宽度、楼层数
- 输入各层空间数量（卧室、卫生间、厨房等）
- 自动生成 2D 平面图
- 自动生成简化 3D 建筑体块
- 导出方案 JSON

## 文件说明

- `index.html`：主页面
- `style.css`：样式文件
- `app.js`：生成逻辑、2D 平面和 3D 预览

## 如何运行

### 方法 1：直接双击 `index.html`
适合快速预览。

### 方法 2：本地静态服务器
如果浏览器限制本地模块加载，推荐用本地服务器打开。

例如在当前文件夹执行：

```bash
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

## 当前版本特点

- 以规则驱动为主，不依赖后端
- 只支持规则矩形外轮廓
- 一层倾向于公共空间，二层/三层倾向于卧室和辅助空间
- 3D 为简化白模/体块逻辑，便于后续接入你现有网页

## 渐进重构（2026-04）

- 已新增统一 `Plan JSON` 适配层：`src/core/createPlanModel.js`
- 已新增集中式 `ROOM_RULES`：`src/config/roomRules.js`
- 已新增 `validatePlan(plan)` 骨架与子验证器：`src/validate/*`
- 现阶段为“并行校验”模式：保留原生成逻辑，同时输出 `unified_plan` / `unified_plan_validation` / `unified_plan_score`
- 后续阶段将逐步改为“候选生成 + 评分选优 + 2D/3D 仅消费 Plan JSON”

## YAML 规则与映射

- 规则示例文件：`config/farmhouse_rules.yaml`
- 默认运行时规则：`src/config/defaultFarmhouseRules.js`
- 映射器：`src/config/ruleConfigMapper.js`

当前映射已接入：

1. `rooms.* -> ROOM_RULES[type]`（面积、净宽净深、长宽比等）
2. `geometry.fill_rate_target -> allocateRoomAreas()`
3. `geometry.max_blank_area -> validateHardConstraints(R4)`
4. `geometry.corridor_auto_if -> expandRooms()` 走廊自动触发

说明：

- 浏览器端当前使用 `defaultFarmhouseRules.js` 作为可执行规则源；
- `farmhouse_rules.yaml` 作为同结构规则模板，便于后续接入 YAML 解析后直读。

## 后续可升级方向

1. 增加门窗更精细的规则
2. 增加非矩形户型
3. 增加房间拖拽微调
4. 导出为可供 3D 场景读取的模型或结构化 JSON
5. 接入你现有村庄白模替换流程
