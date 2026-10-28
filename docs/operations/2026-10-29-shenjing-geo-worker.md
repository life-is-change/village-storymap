# 深井村 4090 图底生产接入

2026-10-29 完成影像传输、geo worker catalog 挂载、云端映射及真实生产验证。

## 正式数据

- 村庄 UUID：`412f3a07-afd2-4ccd-89be-deeca66a8219`。
- 原文件：`E:\村规平台数据处理工具\深井遥感影像2\深井遥感影像2_Level_19.tif`，保留未修改。
- 4090 正式位置：`/media/gpu332/newapply/village-platform/data/建筑矢量/input_tif/深井村.tif`。
- `/srv/village-platform/data` 是同一 newapply 数据目录的 bind mount；容器 `/data` 继续使用此挂载。
- 188751844 bytes，8000×7536，RGB，EPSG:4326。
- SHA256：`131f11cbf02560de256708cf51729f0d6135892c5770dc776cc9154bf473c67d`，传输后及收尾时均验证一致。
- 范围采用 TIFF 覆盖范围，不代表行政村界。

## 配置及回退材料

- 本库 `server/config/villages.yaml` 增加深井村；沿用现有广东 DEM、OSM、建筑模型。
- 4090 catalog：`/media/gpu332/newapply/village-platform/deploy/geo-shenjing-20261029/villages.yaml`。
- 在原 `/home/gpu332/village-campus-autonomous/overlay.json` 中，仅为 geo worker 增加上述 catalog 的只读挂载。
- 原 overlay、预检记录、完成 receipt 保留在上述 deploy 目录，私有权限。
- geo worker 镜像保持 `sha256:cb0d0635a79ae0499d461d83ac49b2dede7c344c051fe335b7e3399abb02bb06`；部署前后比较环境、资源、网络和其他容器，确认其他服务未更改。
- 云端 `geoprocessing_villages` 与 `api_private.task_worker_villages` 增加同 UUID 映射。使用现有 `village_restore_admin` 表维护角色，没有授予新权限。
- 云端修改前备份：`~/village-deploy/shenjing-20261029/source-before.json`，当时两项记录均为空。
- 云端确认深井村 source `ready=true`、无 error_code，geo worker 持续 heartbeat/claim HTTP 200。

## 验证

- 实际 Worker UID 10001 能解析全部三个村庄数据源并打开新 TIFF，核对尺寸、波段、CRS 和范围。
- 管理员个人体验空间提交建筑、道路水系、等高线任务成功，run：`cf6ae5c5-aeae-48c8-8b23-e1a3187cae03`。
- 任务 context 确认为深井村、个人空间 `bc6bfc89-dcbc-4c96-8262-bcf920a5a221`、教学项目 `5c250853-7d95-4d15-bd95-5300329a81cf`。
- 状态 completed：建筑 441、等高线 9、道路/水面/河流沟渠各 0；零要素是本次小范围输出，不是所有村域数据的完整性结论。
- 浏览器成果预览正常；未应用覆盖个人图层，也未修改全班共享现状。
- 本地 `server/tests/test_catalog.py`：5 passed；`git diff --check` 通过。测试临时目录显式指定可写 scratch，避开 Windows 默认临时目录权限问题。
- 页面课程标题仍显示课程模板“米埗村规划实践”，数据库任务已绑定上述本学期项目；本次没有扩大范围修改标题逻辑。

## 临时授权及传输清理

- 连接使用 ZeroTier `10.104.33.197`；链路曾出现 RELAY 超时，和公钥格式问题分别处理。
- 临时公钥的原 UTC `Z` 后缀被服务器 OpenSSH 拒绝；改用服务器本地时区到期时间后恢复授权。
- 成功验证后已从 authorized_keys 精确移除本次 marker `codex-shenjing-20261028-temporary`，保留其他授权。
- 已删除服务器本次 23 个分块及 assembled 临时副本，正式 TIFF 保留；操作脚本和 manifest 留作审计。
- 本地临时密钥及冗余分块在收尾清理，原始影像保留。
