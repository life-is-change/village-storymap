# 任务进度与状态读取死锁

用户已成功应用图底roads_water修复，返回geo_results_and_3d_retry_repaired_real_task_check_required。新任务b31b8edf-7f46-4a11-8765-094cd2a04cfa在0%失败。4090日志确认set_running/set_stage收到HTTP503，旧上传403与新进度503是不同故障。阿里云Postgres最近2小时日志有1个deadlock detected块，涉及local_worker_call、local_task_control、local_gpu_sync、task_requests。

Worker原先先锁local_gpu_runs，再由local_gpu_sync更新task_requests；网站状态读取先锁task_requests，再锁local_gpu_runs。必须统一为父task_requests在前、子local_gpu_runs在后。领取和过期租约回收也遵循此顺序，锁住其他事务持有的父记录时跳过，而非占着子记录等待。Worker身份验证仍在前，保留撤销、租约、权限、终态和输出完整性检查；不通过重试或取消死锁检测来掩盖问题。

网页截图另有SOURCE_BUSINESS_DISABLED，来自离开共享空间时旧releaseSpaceEditLock调用Supabase。Aliyun编辑已经通过planning.acquireLock/saveBatch/releaseLock执行对象级原生租约；旧全空间属性表锁仅用于source部署，Aliyun路径不调用该旧API，不减少原生保存校验。CONTEXT_CHANGED是跨空间过期请求拒绝；保留该保护。water.csv未在源目录中，GeoJSON包含水体属性，移除水体配置的不存在附加CSV请求，不生成伪造业务文件。

实施要求：在原项目main上修改；不改校园镜像、模型服务、私钥或旧目录，不reset数据库。新云端工具验证已安装geo-browser-v1回执和树、冻结release/control、原函数体；先自身备份，单事务更新2个队列/上传函数，复制现有网页到新覆盖层，仅更新app.js/data-service.js；保留所有旧网页和结果数据。只更新web，验证API/Auth/Postgres实例ID不变。只读预检及重复执行均需测试。


## 运行与验收

在阿里云原 main 目录执行下列一行。预检只读，第二次调用才备份并应用；无需重新上传镜像、安装4090 Worker或运行初始安装器。

```bash
cd ~/village-deploy/source && git pull --ff-only origin main && python3 linux/scripts/repair-autonomous-task-locks.py && python3 linux/scripts/repair-autonomous-task-locks.py --apply
```

成功标记为 `task_locks_and_space_switch_repaired_real_task_check_required`。浏览器 Ctrl+Shift+R 后，提交一个小范围、包含建筑/道路与水系/等高线的新图底任务；核对进度、五项结果和个人空间导入。旧失败任务保留用于诊断，不自动重放。本次不将白模贴图已成功或隔离集成成功当作真实图底GPU验收完成。

网页的对象级 `planning.acquireLock/saveBatch/releaseLock` 和过期上下文保护仍生效；只跳过本地部署不使用的旧全空间属性表锁。源站部署继续使用原来的全空间锁。水体属性继续由已有GeoJSON/原生数据提供。

## 验证

本机全部1082项网页JS与411项Python测试通过，7项Windows/POSIX差异跳过。网页两项故障先在旧行为下复现失败，再验证修复通过。独立整体验证审查指出死锁回放必须改变progress，已改为每次递增，避免重复状态让更新短路。原生并发测试在隔离数据库回放精确旧函数体，必须实际出现40P01或其API映射错误，再验证新函数成功；不能只以顺序执行通过来证明死锁消除。


源码 `11dacaf` 的[原生CI 39896665537](https://github.com/life-is-change/village-storymap/actions/runs/39896665537)全部成功：native-database任务120228592269通过旧函数死锁回放、新函数并发、父记录被锁时跳过领取，以及既有队列/文件/权限回归。完整部署实际返回 `TASK_PARENT_LOCK_ORDER_AND_SPACE_SWITCH_REPAIR_REPEAT_VERIFIED`，证明未知函数体导致单事务整体回滚、精确旧函数可修复、重复执行成功、早期网页覆盖层不变；自身114表恢复、4个认证账户、重启与1/5/10/20并发验证保留。autonomous-proxy任务120228591989成功。[平台回归39896665576](https://github.com/life-is-change/village-storymap/actions/runs/39896665576)的Python和JavaScript均成功；Pages39896665373成功。测试未调用真实CA、提供商或GPU；阿里云应用和新图底任务仍待用户返回实际结果。
