# 模型与组合阿里云部署记录

用户明确要求部署，并手动将固定发布包上传至 /home/admin。

## 发布

- 时间：2026-11-05，约 16:56–17:00（北京时间）。
- 平台：https://8.148.248.237/ 。
- 上传脚本：deploy-curated-20261105.py。
- SHA256：fd568b2e00126f3d8689cfa79e67b3a87f45cc6ab53f5edc7f9a323182cf0b33。
- 内容：100 个独立模型、24 套组合及贴图、缩略图、目录；9 个编辑器模块与根页面引用版本，共 348 个文件。
- 通过 git 三方合并保留线上更新。对象树的组合包装、新增样式末尾两处冲突经检查后解决；合并后的 9 个模块与本地已测文件内容一致。根 index.html 仅更新这 9 个模块的版本号，保留线上其他入口。

## 结果

云端预检通过，随后部署成功：changed=348，https_verified=348，service_restarts=0。

部署根目录：/home/admin/village-autonomous/files/semester-groups-20261028-v1/web。

原文件备份及部署回执：/home/admin/curated-scene-assets-20261105/backup、before.json、receipt.json。脚本会在部署或验证异常时回滚本轮已改文件。

本机独立 HTTPS SHA256 核验结果为 348/348，记录见 tmp/curated-release-20261105/https-verification.json，时间 2026-11-05T08:57:16.749Z。发布前专项测试 103 项通过，0 失败。

正式 Edge 平台中已登录账号进入米埗村场景设计，“组件 → 场景组合”可看到 24 套组合、中文名称、子组件数、尺寸和缩略图。三维高清底图正常显示，浏览器控制台未捕获 error。验证时现有个人方案保持 R21、12 个对象、未修改；没有向用户方案放置或保存测试对象。

截图：tmp/curated-deployment-receipt.png、tmp/curated-production-library.png。

本次未改数据库、4090 服务、线上方案数据；未提交本地混合工作区。全量测试的 15 项失败及本地组合行为验证范围沿用本地实施记录，本次未声称全量测试通过或完成线上组合保存流程验证。
