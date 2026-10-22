# 校园4090连接阿里云：现场记录与实施边界

目标为4090主动通过有效 HTTPS 访问 https://8.148.248.237 的独立队列与文件接口。图底和白模贴图的身份、输入、状态及结果均在阿里云；GitHub Pages/Supabase 仍为独立备用站点，不自动双向同步。

## 已确认的现场

2026-10-22 用户在 `/media/gpu332/newapply/village-storymap` 返回：Git 分支 `2026-0926`，HEAD `6f4bbcb`，大量本机部署文件已修改或未跟踪。不能要求直接 checkout main、git pull、reset 或覆盖这个目录。Docker 正常，以下容器运行中：

- geo-worker：`village-geo-worker:8c2719e392ee3141e87bd331788f23635e44984d`，容器 `e2b6b5d02273`，用户10001:10001，仅连接 village-platform_backend，缺少出网网络。
- facade-worker：`village-facade-worker:336b7ef0d17fe77d7558707ebc625402405b0299`，容器 `f8fbbe7c84ab`，同一用户，连接 village-platform_facade-internal 与 village-platform_egress。
- building、facade-ml、facade-lama 均健康，原本地 web 健康，另有 Open WebUI 在3000端口。这些服务不在更新范围内。
- 用户确认两个模块没有旧任务需要继续处理。HTTPS 容器实测、Worker 鉴权与真实两类 GPU 输出仍需实际返回结果。

随后用户在 facade-worker 内禁用环境代理、保留默认 TLS 验证访问公开 IP，返回 HTTP 404。这证明该容器到阿里云443的连接和证书验证已成功；404来自当时给出的 `/healthz` 路径，不应归类为网络断连。公开入口的连接预检改用 `/deployment-config.js`，同时核对返回的本地模式与实例标识。尚未验证私有 Worker 鉴权或实际GPU任务。

r2 预检在修改任何 Worker 之前拒绝 RENDERED_WORKER_RESOURCES_DIFFER。用户逐项只读诊断确认两种 Worker 的 ENV_DIFFER 均为空、MOUNTS_MATCH 均为 True，facade 网络完全匹配；geo 配置已声明 backend+egress，实际旧容器仅有 backend。r3 因此只对 geo 接受“缺少这一条既定 egress”差异，不能接受 backend 消失、额外网络、环境、挂载或 facade 差异。最终替换仍沿用原配置中已经声明的 egress；私有回退配置按实际旧网络记录，不把尚未生效的 egress 误记为旧状态。

最初“未找到命令”和 docker ps accepts no arguments 并非 Docker 未安装；多条命令粘成一行且缺少连接符，使后续命令成了 docker ps 参数。后续每次给一条可直接复制的命令。

## 接入方式

源码与原运行配置分开。代码包只从已提交版本导出 Python 与覆盖层 Dockerfile，不包括 dotenv、密钥、数据、模型或原网站。下载包先核对独立 SHA256，再解压到 Home 下的新版本目录；运行 `python3 -B .../linux/scripts/install-autonomous-workers.py --campus-root /media/gpu332/newapply/village-storymap --check`。包内逐文件摘要及完整文件清单在导入业务模块之前核对；源码版本写入回执。

原目录的 Git、文件和 `linux/gpu.env` 不改。安装器读取原 Compose 和 env，用实际镜像 ID 校验原容器的用户、命令、挂载、环境和网络，允许两个 Worker 的历史镜像版本不同；不会猜测统一 IMAGE_TAG。构建覆盖层时禁止联网和拉取，不安装依赖或模型。代码导出由 `prepare-campus-worker-bundle.py` 完成，公开制品和摘要由 linux/campus-worker-release.json 记录。

图底的 egress 只在替换成 Aliyun Worker 时加入覆盖配置，并保留 backend；不先给旧 Supabase 轮询进程开放网络。预检通过只运行 urllib 的临时受限容器测试目标出网网络，既不读取密钥，也不启动 Worker。随后以独立的 geo/facade 私有凭据、目标UID和真实 httpx TLS 验证身份；实际替换后再次从两个真实容器内验证。预检成功不等于实际容器或GPU验收成功。

用户提出通过 GitHub 传文件后，当前推荐改为4090本机生成私钥、阿里云只登记公开摘要。代码包仍走 GitHub，私钥不上传、不进入聊天，也不需要跨机器下载。旧云端已生成的凭据包保留备用，不覆盖、不自动撤销。

4090 在代码包内运行 `prepare-campus-local-credentials.py`，两份私钥与兼容安装器的私有包保留于 `~/village-campus-local-keys/`，0600；重复执行要求既有私钥和包一致。仅把输出的 PUBLIC_WORKER_REGISTRATION 转交到阿里云或本聊天；它只包含两个 Worker ID、随机私钥的 SHA256 摘要和种类，不具备 Worker API 调用能力。

阿里云在原 main 源目录拉取更新，运行 `register-campus-local-workers.py --registration-base64 公开登记信息`。工具核对已公开的本机运行实例，在单事务中只增加 campus-local-geo、campus-local-facade 两个身份；旧 campus-geo/facade 保留，新名字已有不同身份或已撤销时拒绝覆盖。云端只存摘要，无法由它还原私钥。登记回执存入私有状态目录，内容只有公开登记信息。4090私有凭据包需本人另存受保护的备份，不能依靠阿里云摘要恢复私钥。

确认预检与云端登记后，使用 `--apply --source-workers-idle --credentials "$HOME/village-campus-local-keys/worker-credentials.tar.gz"`，同时指定原 `--campus-root`。仅以 --no-deps/--no-build/--pull never 更新 geo-worker、facade-worker。原渲染配置（含私密信息，0600）和实际旧镜像写入私有回退材料；再次比较原配置摘要，构建期间有变化则拒绝更新。其他所有容器 ID、镜像与运行状态必须保持相同。新网络配置不会写回旧仓库，后续管理这两个新 Worker 应使用生成的 overlay；不要直接用旧 Compose up 把它们恢复到原队列。

状态保留在 `~/village-campus-autonomous/`。同一凭据包可在替换前的失败后再次核对使用，不清理旧构建或日志。替换回执已存在时只执行 --verify，不盲目重复 apply。回执挂载采用 JSON 稳定结构，避免 tuple/list 序列化差异造成假失败。

## 验证边界

本机与 CI 测试覆盖旧分支部署目录分离、仅图底补 egress、临时 HTTPS 探测不启动旧队列、凭据原样复用、回执保存后比较，以及代码包内容/摘要/路径限制。没有从 Windows 访问真实校园 Docker、请求提供商或运行GPU。真实验收还需两个 Worker 的身份连接成功，并在阿里云站点各完成一项已授权的小型图底任务和白模贴图任务，确认输入下载、状态、结果回传和空间导入。

当前公开代码包为 `linux/releases/village-campus-worker-20261022-r3.tar.gz`，208170字节，源码提交 `18845da39318cd4ccd4594e6cc2d15bcab209c13`，SHA256 `f5c92745b7889e49c91a1cdd109ca38acb9ba9fe75d3cec542acfd014c0c6845`。本机解包后逐文件验证并实际运行安装器 --help，未生成源码缓存或修改源码。包内无密钥，私有 Worker 凭据另行传输；不要把公开代码包与 worker-credentials.tar.gz 混淆。

代码包 r2 还覆盖宿主机私有权限到容器内公开代码权限的转换：只在新建构建上下文中将包目录设为0755、Python代码设为0644。否则 COPY 的默认 root 所有权加上原0600代码会让10001用户无法导入。源代码包、密钥、模型和旧目录权限保持原样；Linux CI 验证源文件0600不变、构建副本可读。初始公开包保留用于审计，不用于当前部署。
