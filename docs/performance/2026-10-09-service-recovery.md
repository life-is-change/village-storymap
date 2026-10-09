# 4090 立面队列恢复与图底面板修复（2026-10-09）

## 已验证的服务器故障与恢复

用户提供的 Docker 日志显示，立面任务 Worker 持续 Restarting (1)，启动自检 FACADE_STORAGE=FAIL；ML、LaMa、Blender、工作目录和模型检查均通过。底图 Worker 正常运行，两个业务使用不同任务队列/Worker，因此底图成功不能证明立面在线。

当前 Compose 临时诊断容器能读取 facade-generation 和 house-photos 两个存储桶。原容器与当前 Compose 的镜像、Supabase URL、service-role 凭据和大写代理配置比较一致；但原容器实际仅连接 village-platform_facade-internal 内部网络，缺失 egress 出口。当前 Compose 源文件已有出口网络，不需要修改端口或创建新的数据库。

仅重建 facade-worker：
```bash
sudo docker --context default compose --env-file linux/gpu.env -f linux/compose.gpu.yaml up -d --no-deps --no-build --force-recreate facade-worker
```

用户随后提供的验证显示：
- 网络同时存在 village-platform_egress 和 village-platform_facade-internal。
- 容器 Up 15 seconds，FACADE_STORAGE=OK。
- claim_next_facade_run 200、upsert_worker_heartbeat 204、原始照片下载 200。
- 已确认领取并开始处理既有任务；尚未确认最终模型生成、上传和平台替换完成。不要把在线恢复等同于完整任务验收。
- 这次操作没有重建 Web、修改网页端口/转发、改动师姐 8081 或 open-webui。

没有证据确定此前出口网络为什么丢失，不能把原因归于 Docker 拆分本身或假定某条旧指令。以后仅在确认目标项目/服务后用 Compose 重建该 Worker；单纯 docker restart 保留旧容器网络配置，不能补回缺失网络。

## 六个容器的实际分工

| 服务 | 职责 | 数据/连接 |
| --- | --- | --- |
| web | Nginx 提供平台 HTML/JS/CSS | 对外网页端口；浏览器继续访问 Supabase/地图资源 |
| geo-worker | 领取底图任务，组织结果与上传 | Supabase 队列与存储；调用 building |
| building | GPU 建筑轮廓识别 | 本地影像/模型与内部 API |
| facade-worker | 领取立面任务，组织贴图与 GLB 生成/上传 | Supabase 队列与存储；调用立面 ML、LaMa 和 Blender |
| facade-ml | 立面识别、分割等推理 | GPU 与本地模型文件 |
| facade-lama | 图像修补服务 | GPU 与本地模型文件 |

数据库、登录、任务队列和照片/成果云存储仍在 Supabase；尚未迁移到本地 PostgreSQL。data/models/runtime 是宿主机挂载目录，不全部打包进镜像。容器拆分本身不会中断网页，网络遗漏、错误挂载、共享 GPU 资源或宿主机端口冲突会产生影响。8080/8081 是各自宿主机的监听端口，不是所有电脑共享的全局端口。

## 本地源代码修复

features/geoprocessing/geoprocessing-panel.js：
- 修复完成任务每 10 秒重复渲染、重新签名导致成果区跳动。
- 完成后停止订阅/轮询；重复状态保留成果 DOM、合并签名请求。
- 添加“刷新下载链接”，可主动更新短期签名；刷新失败保留现有成果。
- 保护销毁后和过期任务的异步结果，终态不能被迟到 running 状态回退。

rural_house_generator/app.js：
- 将平台登录会话未连接、立面 Worker 未报告在线、状态请求失败区分显示。
- 本地队列连接不再等待可选的千问云端能力查询。
- 迟到云能力响应仍更新上传控件，但不重置当前任务提示。

两个修复只在 Windows 本地源代码完成，本轮未推送 GitHub或更新 4090 Web 镜像。仅重建 Worker 不会自动更新网页脚本。前端补丁包提供这两个脚本和受目标容器身份检查保护的热更新脚本；当前 Web 容器热更新不会改端口，但后续镜像重建要使用包含修复的源码。

验证：新增 7 项测试先复现故障再通过；完整 Node 回归 882/882 通过，git diff --check 通过。独立代码审查提出的云能力上传控件回归已修复并验证。根 index.html、app.js、style.css 本轮没有改动；它们工作区中的既有未提交修改属于此前优化。

本轮未做新的真实 4090 成品生成实验，亦未重新确认师姐应用内部功能。端口/容器未触及与服务自身功能验收是不同证据。
