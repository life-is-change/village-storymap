# 阿里云独立平台发布证明

本次交付的运行源提交：`af71d213cd1d17b0812e4163353aeb901bc2ac2b`。发布元数据和本文是后续交付记录；运行代码以该提交和摘要锁定。实际阿里云/校园机器尚未由本次本地开发切换。

## 同一提交的验收

- [Unified native database tests](https://github.com/life-is-change/village-storymap/actions/runs/39593146527)：成功，包含实际 PostgreSQL/GoTrue/Nginx/API 四容器协调部署。
- [Platform regression](https://github.com/life-is-change/village-storymap/actions/runs/39593146482)：成功，包含网页、部署脚本和 Worker 协议回归。
- [GitHub Pages](https://github.com/life-is-change/village-storymap/actions/runs/39593147479)：成功；原站仍保留 Supabase 连接。

本机测试：API134项、Worker80项、Linux脚本346项通过，3项Windows权限/符号链接用例跳过并由Linux CI执行。前端1071项先前通过，最终同提交Platform回归再次成功。

整套合成原库包含4个认证用户及普通/图底/立面桶的3份真实测试文件；完整复制、原UUID/测试密码登录、注册/刷新/退出/禁用/私有重置、业务数据归属、照片/模型/场景与版本、进程及容器重启、监听切换和私有备份均通过。另在全新临时数据库恢复自身备份，校验113张带数据表及序列、文件摘要。两类Worker身份接口经实际数据库认证，确认只读和撤销拒绝；安装前后均使用该接口，不领取任务、不修改忙碌状态。

|四容器合成并发|样本|失败|p95毫秒|
|---|---|---|---|
|1|3|0|17.46|
|5|15|0|106.93|
|10|30|0|139.93|
|20|60|0|288.97|

这些是隔离CI样本，不能代替2GB阿里云实际资源或4090模型质量验收。没有调用真实CA、付费提供商或GPU。

## 不可变本机交付

镜像：`village-autonomous:44d05dddb594`，`linux/amd64`。文件位于：

```text
C:\Users\MR\village-image-transfer\village-autonomous-af71d21-amd64.tar.gz
```

大小：`103250988` 字节；SHA256：`20f1320442e214fd0e118cb82d4809ff7a1b0f5cfb5e3c626abbbac37e7b28bd`。

代码、结构、网页、冻结部署控制脚本的摘要与Linux完整验收实际运行的四项摘要逐一相同，见 `linux/autonomous-release.json`。本机还重新读取最终归档，核对Docker配置/平台/入口、运行代码、网页/结构/控制树及镜像身份。压缩包摘要与CI临时包可因文件名及Python/zlib版本不同而不同；未将其宣称为字节级相同。

GoTrue、Nginx、Certbot三个固定离线镜像在本机重新校验大小及SHA256。已有阿里云PostgreSQL17镜像仍须由部署预检按固定身份核对。不要上传旧分阶段镜像或旧桥接发布包。

## 审查与决策

一次独立整体审查覆盖 `cc710189..30c0af0`：无Critical、1个Important、无Minor、无未作判断项。Important是贴图Worker错误调用图底专用sources接口；已通过HTTP/客户端/安装器回归观察RED→GREEN，并在最终native验收验证两类真实认证/撤销/无写入。未放宽sources权限；无第二轮审查、无遗留Minor。

执行中的主要判断：复用现有业务API和outbox但替换为本地队列；私有命令执行密码恢复，不增加公网管理重置接口；保持普通文件4个活动流，增加最多28个/3秒有界等待以消除已实测突发503；原立面流水线的私有诊断限制2MiB并保留mask契约；源数据库/原站不写入，新旧两站不自动同步。所有过程判断和RED/GREEN记录保留在本地计划ledger。

## 下一步

使用[一次实施清单](2026-10-21-autonomous-handoff.md)，先在本机隐藏输入数据库密码与服务端Secret生成一份新私有包，上传后执行统一云端安装，再仅切换校园两个Worker。实际IP证书/续期、原账号密码、真实浏览器、宿主机容量、4090出网及模型输出仍是必须现场完成的验收门槛；当前发布证明不将它们计为完成。旧Supabase/GitHub Pages作为切换基线保留，阿里云新增数据依靠自己的备份，原站不是自动更新的备份。


## 目标机端口格式修补

现场确认HostConfig的8080/tcp绑定HostIp为空、HostPort80，NetworkSettings为公网IPv4/IPv6的80。新增回归先复现KNOWN_STATIC_PORT_REQUIRED，再补充双层绑定校验；未知/额外/回环/错误端口仍拒绝。346项本地部署测试通过，新运行提交的native/Platform及完整四容器、备份恢复验收通过。发布树、镜像平台和所有摘要已重新验证；原已上传私有包的数据库和存储文件摘要逐项相同，无源端读写或新密码输入。只有发布内容更新，新旧归档/目录都保留。
