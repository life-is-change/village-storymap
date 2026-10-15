# 业务迁移依赖清单

状态：阶段 A 的源代码审计；生产切换仍被下列未验收项阻塞。源 SQL 文件可能包含历史策略，不能据此推断线上策略版本；候选部署必须核对实际目录。

| 模块 | 数据、RPC 与文件 | 权限/通知与边界 | 入口 |
| --- | --- | --- | --- |
| 身份/课程/空间 | profiles, courses, course_groups, group_memberships, planning_spaces, course_personal_spaces | profiles role、空间 RLS、同一 Auth UUID；旧课程 SQL 存在 public access 策略，需核对实际权限，API 不返回组码 | auth-system.js; features/course/course-service.js; app.js; Secure Planning Space Visibility.sql |
| 调查/评论/照片 | object_attribute_edits, object_comments, object_photos, survey_feature_reviews；house-photos；删除照片前的 RPC | 审核和锁订阅不属于 GPU 专用；照片可能被立面任务引用，不能直接删除源对象 | features/data/data-service.js; features/object-collaboration/; features/survey/; Allow Referenced Object Photo Deletion.sql |
| 规划/版本/锁 | planning_features, feature_edit_locks, feature_change_batches, feature_snapshots；acquire/heartbeat/release_feature_edit_lock, save_feature_edit_batch, freeze_shared_survey_snapshot | 数据库原子锁、版本冲突和变更审计；通知不能替代互斥 | features/data/feature-db.js; feature-edit-session.js; survey-realtime-controller.js |
| 个人图层 | personal_layer_versions/selections/features, personal_result_bundles；ensure_course_personal_space, save_personal_feature_edit_batch, import_geoprocessing_result | 个人 UUID、课程/村庄权限；结果导入依赖 Supabase 任务及产物，需跨库桥接和幂等 | features/data/personal-space-client.js; features/geoprocessing/geoprocessing-client.js |
| 三维场景 | scene_edit_projects/assets/versions 等；scene_edit_create/load/save/restore 等 RPC；scene-assets, scene-version-previews | 课程/组/个人/admin_sandbox 可见性，revision 乐观锁，high/low GLB 与预览关联 | 3D_scenes_edit/persistence/scene-edit-client.js; app.js; Scene Edit Studio.sql |
| 模型库 | group_model_assets, building_model_bindings；register/place/delete_group_model, restore_building_white_model；group-models | 50 MiB GLB 上限、用户/组/共享空间范围，模型引用保护 | features/models/group-model-library.js; Group Model Library.sql |
| 村庄/教学管理 | village 数据集/teaching projects/生命周期；village-datasets；管理员 RPC | 动态 RPC 名、删除传播、停用和权限撤销须逐项审计 | features/admin/; features/villages/village-client.js; features/data/village-dataset-resolver.js |
| GPU/立面/MC | geoprocessing_runs/artifacts、立面任务/输入照片、MC 同步配置；提交/取消/结果导入 RPC；geoprocessing-results | 本阶段均留 Supabase；不得启用副本中的第二消费者；普通照片和课程镜像关联任务授权 | features/geoprocessing/; features/mc/mc-bridge.js; server/; Geoprocessing Local Source Inputs.sql; Facade Generation Worker Queue.sql |

## 字面量与动态调用

已读代码中 `.from()`、`.rpc()`、`.storage.from()`、`.channel()` 既有字面量又有参数：例如 app.js 的 table/constants、data-service.js 的 deps.PHOTO_BUCKET、admin 中的 rpc(name,args)、课程远端 remoteStore、场景客户端内部 rpc wrapper。切换不能只扫描字符串并按表名前缀分流。阶段 A 只审定自己的固定只读路由，不代理上述动态入口。

app.js 还有 group-plan、planning-features/spaces、community-tasks、message-edits 和 survey-activity 等订阅。个人、共享、课程小组和管理员沙盒空间不能合并成同一授权规则。

## 尚未验收，阻塞生产切换

- 实际候选表列、RLS、grants 和 helper 行为；历史 Allow all/course public access 策略必须与真实部署区分。
- 所有业务写入/RPC、协作通知、真实文件清单与哈希、私有下载、上传和删除权限。
- Auth 新用户资料同步、停用/撤销传播；阶段 A 缺少本地资料时拒绝，不自动镜像或提升角色。
- GPU 输入桥接、依赖镜像撤销、取消/产物/签名权限、幂等结果导入；MC 更新路径尚未切换。
- 写入暂停的实际源通道、最新快照/增量、HTTPS 公网入口、跨用户权限和代表性并发负载。
