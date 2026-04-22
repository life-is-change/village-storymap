# YAML 解析器映射表（当前实现）

| YAML 路径 | 运行时字段 | 生效位置 |
|---|---|---|
| `rooms.<type>.min_area` | `ROOM_RULES[type].minArea` | `allocateRoomAreas` / `validateHardConstraints(R11)` |
| `rooms.<type>.max_area` | `ROOM_RULES[type].maxArea` | `allocateRoomAreas` |
| `rooms.<type>.min_w` | `ROOM_RULES[type].minWidth` | `validateHardConstraints(R11,R12)` |
| `rooms.<type>.min_d` | `ROOM_RULES[type].minDepth` | `validateHardConstraints(R11,R12)` |
| `rooms.<type>.max_aspect` | `ROOM_RULES[type].maxAspectRatio` | `validateHardConstraints(R11)` |
| `rooms.<type>.label` | `ROOM_RULES[type].label` | 2D/3D房间标注 |
| `geometry.fill_rate_target` | `RULE_PROFILE.geometry.fillRateTarget` | `allocateRoomAreas`、`validateHardConstraints(R5)` |
| `geometry.max_blank_area` | `RULE_PROFILE.geometry.maxBlankArea` | `validateHardConstraints(R4)` |
| `geometry.corridor_auto_if.min_width` | `RULE_PROFILE.geometry.corridorAutoIf.minWidth` | `expandRooms` |
| `geometry.corridor_auto_if.min_bedrooms` | `RULE_PROFILE.geometry.corridorAutoIf.minBedrooms` | `expandRooms` |

## 入口文件

- YAML 模板：`config/farmhouse_rules.yaml`
- 默认规则对象：`src/config/defaultFarmhouseRules.js`
- 映射器：`src/config/ruleConfigMapper.js`
- 运行时接入：`app.js`

## 后续建议

1. 接入浏览器端 YAML 解析（例如 `js-yaml`）后，直接将 YAML 解析对象传给 `mapRuleConfigToRuntime(rawRules)`。
2. 扩展 `topology / validation / scoring` 子段的映射与执行链路。
