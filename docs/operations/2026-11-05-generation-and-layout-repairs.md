# 2026-11-05 图底、上传及布局修复

工作位置：原项目 main；保留原有未提交改动。未提交 Git。

## 已部署到阿里云

- 图底绘制入口等待切换到二维个人空间后再启动绘制。
- 已完成任务的空成果列表不再永久缓存；有限次自动重试，保留手动刷新；完成状态不再显示“等待领取”。
- 上传照片按文件字节识别 PNG/JPEG/WebP；失败或过期的旧会话重新申请，避免复用终态产生 UPLOAD_CONFLICT；已提交但响应丢失仍可幂等恢复。
- API 通过已有 owner-scoped archive 退出失败会话并释放配额；未降低文件验证要求，无数据库迁移。
- 保留课程导航的四列布局，窄工作区顶栏换行；右栏按钮随网格过渡重新定位，项目设置浮层随顶栏高度定位。
- 农房说明区分地图继承尺寸和默认三层；保留照片比例计算墙体高度。

服务器发布目录：`/home/admin/generation-repair-20261105`。

主发布 `receipt.json`：9 个文件，API healthy，逐文件 HTTPS 内容校验通过。
状态文字补丁 `followup-receipt.json`：2 个文件。
备份：该目录 `backup`、`followup-backup`。主发布备份包含修改前持久 Compose。
API `/opt/village/business-api/unified/files.mjs` 以只读窄绑定加入原有持久 Compose；无镜像拉取或重建。

## 线上证据

4090 图底 Worker 原先仅连接 egress，而 building 仅连接 backend，导致 building 服务名无法解析。用户已将 Worker 接入 backend，并修改开机恢复 Compose 持久化。健康检查返回 200，model_loaded=true。

任务 `55590816-3f68-4f8a-a1e1-ccd61f148461` 已完成；数据库 GPU 输出与发布文件均为 5。部署后真实页面已显示：建筑轮廓 260、等高线 37、道路 0、水面 0、河流沟渠 0。空图层不等同于文件缺失；没有为核验覆盖用户个人图层。

## 验证

- 42 项上传客户端、绘制上下文、成果重试、侧栏锚点、断点和农房参数说明测试通过。
- API 单元测试 141 项通过。
- 独立浏览器布局夹具 160 种尺寸/模式/侧栏组合通过；不代表所有浏览器缩放和硬件均已实机穷举。
- 补充状态文字测试先失败后通过，图底面板 19 项通过。

## 尚未完成

农房任务 `3129fad5-a1a3-4bdd-87a3-ebed5160754f` 已取得识别框；照片固有尺寸为 641×641。墙身比例约 0.9069472；正面 18.936、进深 11.652、3 层得墙高 17.17395226、平均层高 5.72465075。直接失败来自三处 2.4–5 m 硬限制。用户要求保留相对边均值和照片比例推算，不交换长宽。

本地已将照片比例路径的常见层高限制改为提醒，手动层高路径保持原校验；4 项直接回归、14 项近矩形及构件质量测试通过。修复包以具体语句定点修改 4 个文件，不覆盖 4090 较旧的占地规则。

4090 应用状态：第一版因基线哈希不同在修改前停止；第二版因自检缺少门窗样例而自动回滚；第三版补入实际窗口，完整自检已在本地通过，但应用前发现 Worker 正处于重启循环，尚未应用。日志只有 ALIYUN_GATEWAY=FAIL，其余项目通过；同一持久 Compose 的一次性容器 build_gateway 心跳返回 GATEWAY_OK，完整 _local_gateway_health 返回 True。正在核对主容器恢复状态。未宣称 Worker 补丁生效或真实模型已生成成功。

后续恢复：主容器仅连 facade-internal，缺少 egress；重启循环期间直接 connect 返回 sandbox not found。用户 stop → connect egress → start 后恢复网络。最终补丁将 egress 空选项 null 正规化、提高其连接优先级，并使用 `compose up --no-start --no-deps` 创建停止状态的容器，补齐两条网络后再 start。注意 `compose create` 不支持 `--no-deps`，不可混用。

用户已返回全部健康项 OK、`PHOTO_SCALE_17_17M_WARNING_SMOKE_OK` 与 `PHOTO_HEIGHT_REPAIR_APPLIED_AND_PERSISTED`。持久配置仍为 recovery-20261105/compose.json；代码及备份为 `~/village-campus-autonomous/photo-height-repair-20261105`。真实照片任务正在平台重试中。

## 最终核验

原任务 `3129fad5-a1a3-4bdd-87a3-ebed5160754f` 第 3 次执行完成，数据库 status=completed、progress=100、error_code 为空。真实生成器页面已加载三层构件建筑，GLB 下载及替换按钮启用；尺寸 18.936×11.652，墙高 17.17 m、含屋顶总高 19.10 m。未点击替换原建筑。

网页已追加显示清单中的比例层高提醒，保留成功状态、照片推算值与原始长宽；该界面补丁 `PHOTO_HEIGHT_WARNING_UI_LIVE` 已通过 HTTPS 校验。回归与任务恢复前端测试 18 项通过；Worker 数值回归 4 项、构件质量 14 项、启动网络顺序 1 项通过。

最终可复用 Worker 包为 `/repairs/photo-height-worker-20261105-v5.py`，内含此前现场修正的 null 网络选项处理及 `up --no-start --no-deps`，不是旧版 create 命令。已应用的 v4 加现场定点修正与其等效；已有成功 receipt 会阻止重复应用。

证据图：`tmp/photo-height-repair/production-model-success.png`。生成器刷新后出现过已有照片目录读取 UNAUTHORIZED，但当前任务成果、照片预览及 GLB 读取成功；未据此宣称整个照片素材目录授权流程均已完整验证。

原始照片第一次 422 的具体输入原因尚未确认；文件扩展名与字节不一致的可复现路径、失败会话重试路径已修复，但不能据此断言原用户照片必然属于该原因。
