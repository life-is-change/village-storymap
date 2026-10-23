# 图底结果误拒绝与3D加载重试修复

## 已返回的真实结果

用户已在4090执行安装与验证，返回 `CAMPUS_HTTPS_WORKERS_VERIFIED_REAL_GPU_JOBS_PENDING`。随后用户确认白模贴图任务成功，图底任务 `0f7c11a9-1b42-4c36-b82b-f5f3b1833d9b` 显示 failed、1%、FORBIDDEN。4090只读日志读取成功（64534字节），报错栈为 `worker.py run_once → queue/local_gateway.py upload_artifact → local_task_http.py upload/request/_result → FORBIDDEN`。这不是未领取任务或内网无法访问阿里云；流程已运行到结果上传。

## 原因与改动

网页、任务提交契约和校园处理器统一使用 `roads_water` 表示道路与水系。阿里云 `api_private.local_worker_file` 却要求任务包含 `roads` 或 `water`，误拒绝三种合法输出；`api_private.local_gpu_outputs_ready` 又将该步骤当成一个名为 roads_water 的结果文件，导致即使绕过第一处也无法正确完成。

修复只把道路、水线、水面映射到同一已选步骤 `roads_water`，并要求完成时三项输出全部就绪。建筑和等高线仍按各自步骤校验；只选建筑的任务仍不能上传道路或水体。Worker身份、实例、租约、空间权限、文件类型、大小、摘要、分块与完整性校验保留。不会自动重试旧任务、重置结果或修改用户数据。

3D偶发失败尚缺用户Console错误（提供的是Elements截图）。独立代码复现确认：脚本网络加载失败后，失败标签和拒绝的全局Promise被保留，后续重试继续失败。现在移除失败标签并清空失败Promise，下一次进入可重试；成功脚本和并发加载仍复用。不把这一修复描述为已经确认解决用户全部偶发3D错误；需浏览器复测或实际控制台错误。

## 低清模型说明

`group-model-library.js` 入库会调用 `createModelVariantsAsync` 准备高低清版本；低清路径经模型元数据和建筑绑定传入 `app-3d.js`。`model-residency.js` 根据屏幕像素大小、画质预算与15%迟滞范围选用 detail/low。有低清版本时，选中建筑拉远也可切换低清。当前切换先释放旧模型再加载另一版本，可能短暂闪烁或显示白模；本次不改变LOD策略。单张截图不能证明某栋楼的低清文件和当前驻留版本，需实际元数据核对。

## 实施与保留

新工具 `linux/scripts/repair-autonomous-geo-results.py` 要求当前服务为已验证的 browser-20261022-v3 网页覆盖层，校验原冻结release、控制器、当前网页回执与树摘要。支持真实旧app.js的固定摘要和同源码CI版本；其他差异拒绝覆盖。

预检只读；apply先建立已校验的自身备份，然后在一个事务中只替换上述两个函数的精确旧函数体，未知修改会拒绝并整笔回滚。不改权限或业务表行。复制已验证v3网页到独立 geo-browser-20261023-v1 目录，仅替换app.js；保留PDF、照片、留言和H001已有修复。只更新web的只读挂载并验证所有既有修复文件的HTTPS字节，API/Auth/Postgres容器ID须保持相同。重复执行复用回执及备份，失败保留状态；不运行初始安装器或旧切换工具。

在阿里云原main源目录执行：

```bash
cd ~/village-deploy/source && git pull --ff-only origin main && python3 linux/scripts/repair-autonomous-geo-results.py && python3 linux/scripts/repair-autonomous-geo-results.py --apply
```

成功标记为 `geo_results_and_3d_retry_repaired_real_task_check_required`。随后浏览器Ctrl+Shift+R，再使用原失败任务的重试功能（若界面没有则提交一个小范围同配置新任务）；核对五项结果、完成状态及个人空间导入。4090已接入的两个Worker无需再次替换。白模贴图已成功不等于图底全流程已通过。

## 验证记录

本机：3D脚本首次失败后重试的两个用例先失败、修复后通过，并发请求复用保持通过；全部1079项平台JS和409项Linux部署测试通过，7项Windows/POSIX差异跳过。模型驻留与实际app-3d集成回归覆盖远景低清、选中建筑优先、迟滞防抖及刷新持久路径，未修改这些行为。

新增原生集成使用真实任务API、五种私有GeoJSON上传、缺一项拒绝完成、全部完成后导入建筑/道路/水体/等高线四图层，以及建筑专用任务的越权上传拒绝。完整部署夹具还会重现精确旧v3网页和两处旧函数，验证未知函数体拒绝时事务整体回滚、预检只读、两次修复、原网页覆盖层保留及HTTPS字节。原生CI结果另行记录，不能将本机测试视为真实GPU验收。

源码9a5aa7a的[原生CI 39890713157](https://github.com/life-is-change/village-storymap/actions/runs/39890713157)全部成功；任务120209538209通过五输出/四图层的新增原生集成，并实际返回 GEO_LEGACY_SQL_AND_3D_RETRY_OVERLAY_REPAIR_REPEAT_VERIFIED，保留自身114表恢复、原有浏览器/H001、校园身份和并发验证。未调用真实CA、提供商或GPU。同提交的网页JS与Pages成功。Python单测中一个新夹具未给复制文件设置0600，Linux严格权限检查正确拒绝；后续仅补齐测试夹具权限，不放宽生产校验。
