# 早市组合、素材库与生成建筑同步修复

## 变更

- 新增 `seed:combo:morning-market`：14×10 米，六摊、两条内部通道，自动创建活动场地、分组和模拟市场归属。地图直接放置，无需先划范围。移动、旋转、复制、重排与撤销保留归属。
- 素材分类各归一处；从新增库隐藏 path/paving/paving-module/curb，保留资产和已有方案。
- 早市组合在图层区只显示一个场地文件夹，组件直接列于其下；点击标题仍可选择整个组合。
- 生成器把 Draco 预览中已解码的几何导出为普通 GLB 后交接平台；原始下载保持原文件。
- 个人规划空间保存失败：`file_commit` 仅把 course_personal_spaces 识别为 personal，practice_personal/formal_personal 因无 group_id 被判 FORBIDDEN。补齐本人 planning_spaces 的个人归属，并在 place_group_model 中校验资产与目标空间同属本人。

## 上线

已部署到 https://8.148.248.237/ 。前端七个文件经部署前后 SHA 校验、备份和公开 HTTPS 逐字节校验。图层层级修正另作两文件补丁。

数据库迁移：`linux/sql/personal-planning-model-save.sql`，事务内匹配既有函数后修改，失败整体回滚。
服务器原函数备份：`~/generation-repair-20261105/personal-model-backup.sql`。
前端回执：同目录 `market-sync-receipt.json`、`market-tree-receipt.json`；对应备份目录 `market-sync-backup`、`market-tree-backup`。

## 验证

- Node 49 项测试通过（早市、一般组合、分类及界面、生成模型交接）。
- 线上空方案直接放置得到一场地、六摊、两通道共九对象；临时验收对象已通过撤销清除。
- 以真实失败上传记录在事务中执行提交及 models.place，返回 personal 和正确空间；换用其他身份写入被拒绝。整个验证事务回滚，未留下测试模型绑定。
- 浏览器加载 Khronos Box Draco 样例，经现有 DRACOLoader、实际 prepareModelForPlatform 和 GLTFExporter，平台 inspectGlbAsync 验证通过（12 三角面，1824 字节）。截图 `tmp/market-sync-release/draco-proof.png`。
- 尚未代用户在其两个生成器任务页面分别点击最终“替换原建筑”；已验证对应后端链路与真实 Draco 转换链路。
