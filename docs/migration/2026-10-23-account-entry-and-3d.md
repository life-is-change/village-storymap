# 新账号首次地图与个人空间3D修复

用户确认任务锁修复已成功应用。新账号首次米埗村白屏，切到红星村再切回正常；截图显示进入3D时personal/list-selections返回403。orthophoto.pgw不存在时已有回退，非本次阻断入口的异常。

根因一：app.js提供的上下文同时含当前project/village/space和后台coursePersonalSpace.id。进入时个人图底空间在后台创建，改变personalSpaceId；unified-api-client把完整对象序列化作为请求过期条件，导致未切换公共地图的合法首次读取也抛CONTEXT_CHANGED。仅从API请求的当前工作区比较中移除附属personalSpaceId；真正user/project/village/course/space变化及Auth epoch仍拒绝过期结果。任务导入仍显式读取并校验目标personalSpaceId，文件缓存身份和Scene上下文策略不修改。

根因二：3D以practice_personal/formal_personal名称推断图底成果空间，实际同名类型也用于普通planning_spaces个人体验空间。2D已有personalLayerVersionSpace/course_personal判别；3D使用同一明确标记语义，普通个人空间调用planning.listFeatures，图底成果空间调用personal.listSelections/listFeatures。服务器所有权和403检查不修改，不把403转为空列表，不恢复未经许可的其他空间数据。

云端发布使用独立account-entry-20261023-v1覆盖层，验证冻结release/control、已有browser/geo/task-lock覆盖层、回执和摘要；自身备份后复制上一网页，仅替换app-3d.js及unified-api-client.js。仅重建web，API/Auth/Postgres及Worker不变，零数据库写入，保留旧覆盖层并允许重复执行。原生隔离CI验证历史覆盖层兼容与HTTPS字节，网页回归覆盖冷启动及真实跨空间/账号拒绝。真实新账号浏览器验收仍需用户。


## 应用与浏览器验收

用户已确认上轮返回 `task_locks_and_space_switch_repaired_real_task_check_required`。本次以该覆盖层为基准。阿里云执行一行：

```bash
cd ~/village-deploy/source && git pull --ff-only origin main && python3 linux/scripts/repair-autonomous-account-entry.py && python3 linux/scripts/repair-autonomous-account-entry.py --apply
```

成功标记为 `account_entry_and_3d_repaired_browser_check_required`。无需上传新镜像或输入网站密码。完成后 Ctrl+Shift+R，用同一新账号首次进入米埗村；先检查2D，再在普通个人体验空间进入3D，最后核对已有图底成果版本空间仍可读取。截图中的orthophoto.pgw 404已由既有回退处理；本次不把删除警告视为修复入口。

更新脚本在验证完整旧覆盖层后，校验自身备份、生成新目录，只重建web。若Compose已停止/移除旧web后中断，仅当web_prepared回执、原始Compose及目标目录、备份和覆盖层摘要全部一致才允许恢复；已有容器仍检查归属、镜像、端口、只读挂载，未知容器或文件变化拒绝。

## Docker与更新方式

当前 `autonomous_compose.py` 定义四个独立服务：Postgres数据库、业务API、本地Auth、Nginx网页；由Compose统一编排，数据库文件独立持久化，不打进网页/API镜像。API访问同机数据库可减少跨网络往返，Docker本身不保证速度提升。Docker有利于依赖版本一致与升级回退；`git pull`只更新源码，现有冻结镜像/只读网页不会自动改变。当前GitHub工作流负责测试与Pages发布，阿里云通过已验证的发布/修复脚本应用对应变更；数据库结构升级也需迁移步骤。

## 验证记录

本机1093项JS全部通过，417项Python通过、7项Windows/POSIX差异跳过。首次公共地图读取的CONTEXT_CHANGED和两种普通个人3D的FORBIDDEN先复现3项失败，再通过针对测试；实际user/project/village/course/space变化仍拒绝结果，版本空间真实403不吞掉。独立整体验证审查发现停止/移除web后恢复缺口，已补充先失败后通过的恢复测试，并扩展原生夹具在真实停止/移除后恢复。云端实际浏览器验收待用户执行。


源码 `40e8688` 的[原生CI39914467813](https://github.com/life-is-change/village-storymap/actions/runs/39914467813)全部成功：native-database任务120284761875、autonomous-proxy任务120284762205均成功。完整部署夹具先在三层历史覆盖层还原精确旧app-3d与旧API客户端，校验其摘要后预检；真实停止web、随后移除web时分别制造Compose中断，再恢复并重复apply，实际返回 `ACCOUNT_ENTRY_LEGACY_3D_OVERLAY_RECOVERY_AND_REPEAT_VERIFIED`。已有task-lock验证、全部api_private函数摘要不变、历史网页树不变、自身114表恢复、4认证账户、重启及1/5/10/20并发继续通过；无真实CA、提供商或GPU调用。[平台回归39914467716](https://github.com/life-is-change/village-storymap/actions/runs/39914467716)的Python/JavaScript以及Pages39914467392均成功。本次仅交付待用户执行的修复，没有在用户阿里云或4090上代为执行操作。
