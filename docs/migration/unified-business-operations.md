# 统一业务固定操作清单

状态：契约层已建立；后端实现和页面装配按统一计划继续，不能把本清单当成已切换证明。仓库部署配置默认为source；aliyun配置只在发布产物中生成。

普通JSON上限2MiB，批量编辑最多500项。每个动作由服务端固定路由映射，不接受表/SQL/RPC名，身份由认证服务提供。proof列仅表示当前DTO成功例和未知字段拒绝测试；实际权限与事务证明必须由对应域集成测试补齐。

| 动作 | 路由 | 读/写 | 请求字段 | 源入口/数据/RPC | 当前证明 |
| --- | --- | --- | --- | --- | --- |
| `identity.me` | `GET /api/v1/me` | 读 |  | auth-system.js:loadProfile | DTO: unified-contracts.test.mjs |
| `identity.bootstrap` | `GET /api/v1/bootstrap` | 读 |  | app.js:startup; auth-system.js:loadProfile | DTO: unified-contracts.test.mjs |
| `identity.ensureProfile` | `POST /api/v1//ensure-profile` | 写 |  | auth-system.js:register | DTO: unified-contracts.test.mjs |
| `identity.updateProfile` | `POST /api/v1//update-profile` | 写 | displayName, gender, className, grade | auth-system.js:updateProfile | DTO: unified-contracts.test.mjs |
| `admin.listUsers` | `POST /api/v1/admin/list-users` | 读 |  | supabase/functions/admin-delete-user; auth-system.js | DTO: unified-contracts.test.mjs |
| `admin.disableUser` | `POST /api/v1/admin/disable-user` | 写 | userId, requestId | supabase/functions/admin-delete-user (local business disable only) | DTO: unified-contracts.test.mjs |
| `catalog.listCourses` | `POST /api/v1/courses/list-courses` | 读 |  | features/course/course-service.js;features/villages/village-client.js -> courses | DTO: unified-contracts.test.mjs |
| `catalog.listGroups` | `POST /api/v1/courses/list-groups` | 读 | courseId | features/course/course-service.js;features/villages/village-client.js -> course_groups | DTO: unified-contracts.test.mjs |
| `catalog.createGroup` | `POST /api/v1/courses/create-group` | 写 | courseId, name, requestId | features/course/course-service.js;features/villages/village-client.js -> course_groups | DTO: unified-contracts.test.mjs |
| `catalog.joinGroup` | `POST /api/v1/courses/join-group` | 写 | courseId, code, requestId | features/course/course-service.js;features/villages/village-client.js -> group_memberships | DTO: unified-contracts.test.mjs |
| `catalog.lockGroup` | `POST /api/v1/courses/lock-group` | 写 | groupId, locked, requestId | features/course/course-service.js;features/villages/village-client.js -> course_groups | DTO: unified-contracts.test.mjs |
| `catalog.getProgress` | `POST /api/v1/courses/get-progress` | 读 | courseId | features/course/course-service.js;features/villages/village-client.js -> task_progress | DTO: unified-contracts.test.mjs |
| `catalog.setProgress` | `POST /api/v1/courses/set-progress` | 写 | courseId, taskId, complete, requestId | features/course/course-service.js;features/villages/village-client.js -> task_progress | DTO: unified-contracts.test.mjs |
| `catalog.listActivity` | `POST /api/v1/courses/list-activity` | 读 | courseId, limit | features/course/course-service.js;features/villages/village-client.js -> activity_events | DTO: unified-contracts.test.mjs |
| `catalog.recordActivity` | `POST /api/v1/courses/record-activity` | 写 | courseId, taskId, eventType, detail, requestId | features/course/course-service.js;features/villages/village-client.js -> activity_events | DTO: unified-contracts.test.mjs |
| `catalog.getActiveContext` | `POST /api/v1/spaces/get-active-context` | 读 |  | features/course/course-service.js;features/villages/village-client.js -> get_active_project_context | DTO: unified-contracts.test.mjs |
| `catalog.listVillages` | `POST /api/v1/spaces/list-villages` | 读 |  | features/course/course-service.js;features/villages/village-client.js -> villages | DTO: unified-contracts.test.mjs |
| `catalog.listSpaces` | `POST /api/v1/spaces/list-spaces` | 读 | teachingProjectId, villageId | features/course/course-service.js;features/villages/village-client.js -> planning_spaces;course_personal_spaces | DTO: unified-contracts.test.mjs |
| `catalog.getSpace` | `POST /api/v1/spaces/get-space` | 读 | teachingProjectId, villageId, spaceId | features/course/course-service.js;features/villages/village-client.js -> planning_spaces;course_personal_spaces | DTO: unified-contracts.test.mjs |
| `catalog.ensureSpace` | `POST /api/v1/spaces/ensure-space` | 写 | teachingProjectId, villageId, spaceType, title, requestId | features/course/course-service.js;features/villages/village-client.js -> ensure_context_space | DTO: unified-contracts.test.mjs |
| `admin.createVillage` | `POST /api/v1/admin/create-village` | 写 | name, isPractice, boundary, defaultCrs, requestId | features/admin;features/villages/village-client.js -> create_village_draft | DTO: unified-contracts.test.mjs |
| `admin.createTeachingProject` | `POST /api/v1/admin/create-teaching-project` | 写 | courseId, name, practiceVillageId, requestId | features/admin;features/villages/village-client.js -> create_teaching_project | DTO: unified-contracts.test.mjs |
| `admin.archiveTeachingProject` | `POST /api/v1/admin/archive-teaching-project` | 写 | teachingProjectId, requestId | features/admin;features/villages/village-client.js -> archive_teaching_project | DTO: unified-contracts.test.mjs |
| `admin.previewVillageRemoval` | `POST /api/v1/admin/preview-village-removal` | 读 | villageId | features/admin;features/villages/village-client.js -> get_village_removal_preview | DTO: unified-contracts.test.mjs |
| `admin.archiveVillage` | `POST /api/v1/admin/archive-village` | 写 | villageId, requestId | features/admin;features/villages/village-client.js -> archive_village | DTO: unified-contracts.test.mjs |
| `admin.restoreVillage` | `POST /api/v1/admin/restore-village` | 写 | villageId, requestId | features/admin;features/villages/village-client.js -> restore_village | DTO: unified-contracts.test.mjs |
| `admin.deleteVillage` | `POST /api/v1/admin/delete-village` | 写 | villageId, requestId | features/admin;features/villages/village-client.js -> delete_unused_village | DTO: unified-contracts.test.mjs |
| `admin.saveDataset` | `POST /api/v1/admin/save-dataset` | 写 | villageId, sourceKind, imageryConfig, layerManifest, validationSummary, status, datasetId, versionLabel, requestId | features/admin;features/villages/village-client.js -> save_village_dataset_draft | DTO: unified-contracts.test.mjs |
| `admin.publishDataset` | `POST /api/v1/admin/publish-dataset` | 写 | datasetId, requestId | features/admin;features/villages/village-client.js -> publish_village_dataset | DTO: unified-contracts.test.mjs |
| `admin.bindFormalVillage` | `POST /api/v1/admin/bind-formal-village` | 写 | teachingProjectId, villageId, requestId | features/admin;features/villages/village-client.js -> bind_formal_village | DTO: unified-contracts.test.mjs |
| `admin.saveRealityModel` | `POST /api/v1/admin/save-reality-model` | 写 | villageId, ionAssetId, title, heightOffset, terrainEnabled, status, modelId, requestId | features/admin;features/villages/village-client.js -> save_village_reality_model_draft | DTO: unified-contracts.test.mjs |
| `admin.publishRealityModel` | `POST /api/v1/admin/publish-reality-model` | 写 | modelId, requestId | features/admin;features/villages/village-client.js -> publish_village_reality_model | DTO: unified-contracts.test.mjs |
| `admin.groupDashboard` | `POST /api/v1/admin/group-dashboard` | 读 | teachingProjectId, villageId | features/admin;features/villages/village-client.js -> get_group_plan_admin_dashboard | DTO: unified-contracts.test.mjs |
| `admin.groupContext` | `POST /api/v1/admin/group-context` | 读 | teachingProjectId, villageId, spaceId | features/admin;features/villages/village-client.js -> get_group_plan_admin_context | DTO: unified-contracts.test.mjs |
| `admin.ensureGroupSpace` | `POST /api/v1/admin/ensure-group-space` | 写 | teachingProjectId, villageId, groupId, requestId | features/admin;features/villages/village-client.js -> ensure_group_plan_space | DTO: unified-contracts.test.mjs |
| `survey.getAttributes` | `POST /api/v1/survey/get-attributes` | 读 | teachingProjectId, villageId, spaceId, objectCode, objectType | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_attribute_edits | DTO: unified-contracts.test.mjs |
| `survey.saveAttributes` | `POST /api/v1/survey/save-attributes` | 写 | teachingProjectId, villageId, spaceId, objectCode, objectType, data, surveyLayerKey, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_attribute_edits | DTO: unified-contracts.test.mjs |
| `survey.listComments` | `POST /api/v1/survey/list-comments` | 读 | teachingProjectId, villageId, spaceId, objectCode, objectType | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_comments | DTO: unified-contracts.test.mjs |
| `survey.addComment` | `POST /api/v1/survey/add-comment` | 写 | teachingProjectId, villageId, spaceId, objectCode, objectType, body, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_comments | DTO: unified-contracts.test.mjs |
| `survey.editComment` | `POST /api/v1/survey/edit-comment` | 写 | commentId, body, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_comments | DTO: unified-contracts.test.mjs |
| `survey.deleteComment` | `POST /api/v1/survey/delete-comment` | 写 | commentId, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_comments | DTO: unified-contracts.test.mjs |
| `survey.react` | `POST /api/v1/survey/react` | 写 | teachingProjectId, villageId, spaceId, objectCode, objectType, reaction, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_attribute_edits | DTO: unified-contracts.test.mjs |
| `survey.listPhotos` | `POST /api/v1/survey/list-photos` | 读 | teachingProjectId, villageId, spaceId, objectCode, objectType | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> object_photos;list_object_photo_facade_usage | DTO: unified-contracts.test.mjs |
| `survey.deletePhoto` | `POST /api/v1/survey/delete-photo` | 写 | photoId, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> delete_object_photo_safely | DTO: unified-contracts.test.mjs |
| `survey.listReviews` | `POST /api/v1/survey/list-reviews` | 读 | teachingProjectId, villageId, spaceId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> survey_feature_reviews | DTO: unified-contracts.test.mjs |
| `survey.getReview` | `POST /api/v1/survey/get-review` | 读 | teachingProjectId, villageId, spaceId, layerKey, objectCode | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> survey_feature_reviews | DTO: unified-contracts.test.mjs |
| `survey.initializeReviews` | `POST /api/v1/survey/initialize-reviews` | 写 | teachingProjectId, villageId, spaceId, datasetId, items, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> initialize_shared_survey_reviews | DTO: unified-contracts.test.mjs |
| `survey.confirmGeometry` | `POST /api/v1/survey/confirm-geometry` | 写 | teachingProjectId, villageId, spaceId, layerKey, objectCode, geometry, revision, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> confirm_survey_feature_geometry | DTO: unified-contracts.test.mjs |
| `survey.dashboard` | `POST /api/v1/survey/dashboard` | 读 | teachingProjectId, villageId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> get_shared_survey_dashboard | DTO: unified-contracts.test.mjs |
| `survey.listFeatures` | `POST /api/v1/survey/list-features` | 读 | teachingProjectId, villageId, spaceId, layerKey, limit | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> list_shared_survey_features | DTO: unified-contracts.test.mjs |
| `survey.history` | `POST /api/v1/survey/history` | 读 | teachingProjectId, villageId, spaceId, layerKey, objectCode | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> feature_versions | DTO: unified-contracts.test.mjs |
| `survey.restoreVersion` | `POST /api/v1/survey/restore-version` | 写 | versionId, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> restore_survey_feature_version | DTO: unified-contracts.test.mjs |
| `survey.freezeSnapshot` | `POST /api/v1/survey/freeze-snapshot` | 写 | teachingProjectId, villageId, spaceId, label, requestId | features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> freeze_shared_survey_snapshot | DTO: unified-contracts.test.mjs |
| `planning.listFeatures` | `POST /api/v1/planning/list-features` | 读 | teachingProjectId, villageId, spaceId, layerKey, includeDeleted | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> planning_features;resolve_group_plan_features | DTO: unified-contracts.test.mjs |
| `planning.acquireLock` | `POST /api/v1/planning/acquire-lock` | 写 | teachingProjectId, villageId, spaceId, layerKey, objectCode | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> acquire_feature_edit_lock | DTO: unified-contracts.test.mjs |
| `planning.heartbeatLock` | `POST /api/v1/planning/heartbeat-lock` | 写 | teachingProjectId, villageId, spaceId, layerKey, objectCode, lockToken | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> heartbeat_feature_edit_lock | DTO: unified-contracts.test.mjs |
| `planning.releaseLock` | `POST /api/v1/planning/release-lock` | 写 | teachingProjectId, villageId, spaceId, layerKey, objectCode, lockToken | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> release_feature_edit_lock | DTO: unified-contracts.test.mjs |
| `planning.saveBatch` | `POST /api/v1/planning/save-batch` | 写 | teachingProjectId, villageId, spaceId, changes, requestId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> save_feature_edit_batch;save_group_plan_edit_batch | DTO: unified-contracts.test.mjs |
| `planning.versions` | `POST /api/v1/planning/versions` | 读 | teachingProjectId, villageId, spaceId, limit | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> feature_versions;feature_snapshots | DTO: unified-contracts.test.mjs |
| `planning.freezeSnapshot` | `POST /api/v1/planning/freeze-snapshot` | 写 | teachingProjectId, villageId, spaceId, label, requestId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> freeze_feature_snapshot | DTO: unified-contracts.test.mjs |
| `planning.baselineState` | `POST /api/v1/planning/baseline-state` | 读 | teachingProjectId, villageId, spaceId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> get_group_plan_baseline_state | DTO: unified-contracts.test.mjs |
| `planning.previewBaseline` | `POST /api/v1/planning/preview-baseline` | 读 | teachingProjectId, villageId, spaceId, targetSnapshotId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> preview_group_baseline_update | DTO: unified-contracts.test.mjs |
| `planning.applyBaseline` | `POST /api/v1/planning/apply-baseline` | 写 | teachingProjectId, villageId, spaceId, targetSnapshotId, expectedBaseSnapshotId, requestId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> apply_group_baseline_update | DTO: unified-contracts.test.mjs |
| `planning.conflicts` | `POST /api/v1/planning/conflicts` | 读 | teachingProjectId, villageId, spaceId, includeResolved | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> group_baseline_conflicts | DTO: unified-contracts.test.mjs |
| `planning.resolveConflict` | `POST /api/v1/planning/resolve-conflict` | 写 | conflictId, resolution, payload, requestId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> resolve_group_baseline_conflict | DTO: unified-contracts.test.mjs |
| `planning.restorePoints` | `POST /api/v1/planning/restore-points` | 读 | teachingProjectId, villageId, spaceId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> group_plan_restore_points | DTO: unified-contracts.test.mjs |
| `planning.restorePoint` | `POST /api/v1/planning/restore-point` | 写 | restorePointId, requestId | features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> restore_group_plan_restore_point | DTO: unified-contracts.test.mjs |
| `personal.ensure` | `POST /api/v1/personal/ensure` | 写 | courseId, teachingProjectId, villageId, spaceType, title, requestId | features/data/personal-space-client.js -> ensure_course_personal_space | DTO: unified-contracts.test.mjs |
| `personal.listVersions` | `POST /api/v1/personal/list-versions` | 读 | spaceId | features/data/personal-space-client.js -> personal_layer_versions | DTO: unified-contracts.test.mjs |
| `personal.listSelections` | `POST /api/v1/personal/list-selections` | 读 | spaceId | features/data/personal-space-client.js -> personal_layer_selections | DTO: unified-contracts.test.mjs |
| `personal.listFeatures` | `POST /api/v1/personal/list-features` | 读 | versionId | features/data/personal-space-client.js -> personal_layer_features | DTO: unified-contracts.test.mjs |
| `personal.saveBatch` | `POST /api/v1/personal/save-batch` | 写 | spaceId, changes, requestId | features/data/personal-space-client.js -> save_personal_feature_edit_batch | DTO: unified-contracts.test.mjs |
| `personal.setVersion` | `POST /api/v1/personal/set-version` | 写 | spaceId, layerKey, versionId, requestId | features/data/personal-space-client.js -> set_personal_layer_version | DTO: unified-contracts.test.mjs |
| `personal.deleteVersion` | `POST /api/v1/personal/delete-version` | 写 | versionId, requestId | features/data/personal-space-client.js -> delete_personal_layer_version | DTO: unified-contracts.test.mjs |
| `models.list` | `POST /api/v1/models/list` | 读 | teachingProjectId, villageId, spaceId | features/models/group-model-library.js -> group_model_assets | DTO: unified-contracts.test.mjs |
| `models.bindings` | `POST /api/v1/models/bindings` | 读 | teachingProjectId, villageId, spaceId | features/models/group-model-library.js -> building_model_bindings | DTO: unified-contracts.test.mjs |
| `models.place` | `POST /api/v1/models/place` | 写 | teachingProjectId, villageId, spaceId, assetId, objectCode, requestId | features/models/group-model-library.js -> place_group_model | DTO: unified-contracts.test.mjs |
| `models.restoreWhiteModel` | `POST /api/v1/models/restore-white-model` | 写 | teachingProjectId, villageId, spaceId, objectCode, requestId | features/models/group-model-library.js -> restore_building_white_model | DTO: unified-contracts.test.mjs |
| `models.delete` | `POST /api/v1/models/delete` | 写 | assetId, requestId | features/models/group-model-library.js -> delete_group_model | DTO: unified-contracts.test.mjs |
| `community.listTasks` | `POST /api/v1/community/list-tasks` | 读 | teachingProjectId, villageId, spaceId | app.js;community_tasks;message-edits | DTO: unified-contracts.test.mjs |
| `community.createTask` | `POST /api/v1/community/create-task` | 写 | teachingProjectId, villageId, spaceId, body, requestId | app.js;community_tasks;object_attribute_edits | DTO: unified-contracts.test.mjs |
| `community.updateTask` | `POST /api/v1/community/update-task` | 写 | teachingProjectId, villageId, spaceId, id, body, revision, requestId | app.js;community_tasks;object_attribute_edits | DTO: unified-contracts.test.mjs |
| `community.deleteTask` | `POST /api/v1/community/delete-task` | 写 | teachingProjectId, villageId, spaceId, id, requestId | app.js;community_tasks;object_attribute_edits | DTO: unified-contracts.test.mjs |
| `community.listMessages` | `POST /api/v1/community/list-messages` | 读 | teachingProjectId, villageId, spaceId | app.js;community_tasks;message-edits | DTO: unified-contracts.test.mjs |
| `community.createMessage` | `POST /api/v1/community/create-message` | 写 | teachingProjectId, villageId, spaceId, body, requestId | app.js;community_tasks;object_attribute_edits | DTO: unified-contracts.test.mjs |
| `community.updateMessage` | `POST /api/v1/community/update-message` | 写 | teachingProjectId, villageId, spaceId, id, body, revision, requestId | app.js;community_tasks;object_attribute_edits | DTO: unified-contracts.test.mjs |
| `community.deleteMessage` | `POST /api/v1/community/delete-message` | 写 | teachingProjectId, villageId, spaceId, id, requestId | app.js;community_tasks;object_attribute_edits | DTO: unified-contracts.test.mjs |
| `community.react` | `POST /api/v1/community/react` | 写 | teachingProjectId, villageId, spaceId, id, reaction, requestId | app.js:message-edits | DTO: unified-contracts.test.mjs |
| `mc.getConfig` | `POST /api/v1/mc/get-config` | 读 | teachingProjectId, villageId, spaceId | features/mc/mc-bridge.js;mc_sync_config | DTO: unified-contracts.test.mjs |
| `mc.exportBuildings` | `POST /api/v1/mc/export-buildings` | 读 | teachingProjectId, villageId, spaceId | features/mc/mc-bridge.js;mc_sync_config | DTO: unified-contracts.test.mjs |
| `tasks.availability` | `POST /api/v1/tasks/availability` | 读 | kind | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> get_worker_availability;get_facade_worker_availability;facade-cloud:capability | DTO: unified-contracts.test.mjs |
| `tasks.sourceStatus` | `POST /api/v1/tasks/source-status` | 读 | villageId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> get_geoprocessing_source_status | DTO: unified-contracts.test.mjs |
| `tasks.submitGeo` | `POST /api/v1/tasks/submit-geo` | 写 | teachingProjectId, villageId, spaceId, courseId, requestedSteps, aoi, parameters, requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> submit_geoprocessing_run | DTO: unified-contracts.test.mjs |
| `tasks.submitFacade` | `POST /api/v1/tasks/submit-facade` | 写 | teachingProjectId, villageId, spaceId, courseId, objectCode, photoId, kind, requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> submit_facade_run;facade-cloud:submit | DTO: unified-contracts.test.mjs |
| `tasks.get` | `POST /api/v1/tasks/get` | 读 | requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> geoprocessing_runs;facade_generation_runs;cloud_facade_runs | DTO: unified-contracts.test.mjs |
| `tasks.list` | `POST /api/v1/tasks/list` | 读 | villageId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> geoprocessing_runs;facade_generation_runs;cloud_facade_runs | DTO: unified-contracts.test.mjs |
| `tasks.artifacts` | `POST /api/v1/tasks/artifacts` | 读 | requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> geoprocessing_artifacts;facade_generation_artifacts | DTO: unified-contracts.test.mjs |
| `tasks.cancel` | `POST /api/v1/tasks/cancel` | 写 | taskId, requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> request_geoprocessing_cancel;request_facade_cancel | DTO: unified-contracts.test.mjs |
| `tasks.retry` | `POST /api/v1/tasks/retry` | 写 | taskId, requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> retry_failed_facade_run | DTO: unified-contracts.test.mjs |
| `tasks.confirmCrop` | `POST /api/v1/tasks/confirm-crop` | 写 | taskId, cropTop, roofType, buildingWidth, buildingDepth, requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> confirm_facade_crop | DTO: unified-contracts.test.mjs |
| `tasks.importResult` | `POST /api/v1/tasks/import-result` | 写 | taskId, spaceId, requestId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> import_geoprocessing_result | DTO: unified-contracts.test.mjs |
| `tasks.isImported` | `POST /api/v1/tasks/is-imported` | 读 | taskId, spaceId | features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> personal_result_bundles | DTO: unified-contracts.test.mjs |

## 复用的流式与三维协议

`/api/v1/scene-files` 下的固定session/file/scene路由继续使用C2a的独立严格验证器和原测试，不通过上表任意代理：上传会话、逐角色PUT、commit/status、私有文件GET及scene固定动作。普通照片/模型/村庄文件流式接口在files模块明确分型后追加清单；目前不暴露通用文件路径接口。

`scene-edit-client.js`的场景项目/草稿/版本/资产/组件动作以及`scene-asset-library.js`的GLB原模/低模/俯视图、预览已审计，候选页面必须注入C2a客户端，不能保留Supabase Storage回调。当前真实页面尚未切换。

## 动态调用与通知审计

- `data-service.js`的OBJECT_EDITS_TABLE、PHOTO_BUCKET、对象类型及上下文必须由固定survey/files服务映射，不接收浏览器表名。
- `feature-db.js`按图层的读写/删除包装器归一到planning.listFeatures/saveBatch；个人直接upsert/delete也归一到带版本校验的personal.saveBatch。
- `course-service.js`的remoteStore和mirrorUpsert在aliyun模式必须用服务替代；不能只在后台镜像时报告本地成功。
- `object-comments.js`的like/reply都要迁移，其actor来自UUID而不是显示名称；community消息互动另外保留上下文与版本。
- `app.js`的group-plan、planning-features/spaces、community-tasks、message-edits、survey-activity和survey审核/锁通知迁入events；GPU状态保留受控任务通道。
- 管理员村庄删除、数据集文件删除、用户资料删除、组码访问和实景发布分别有权限/引用规则，不能合并为任意admin RPC。
- `facade-cloud`的capability/submit/poll也在迁移范围；新站不能将本地photoId直接传给旧源函数。
- MC读取本地空间/几何/配置并导出固定协议；不开放任意服务器目的URL。

## 站点边界

source与aliyun分别缓存普通业务；共享Auth密码和全局停用，业务资料/成员独立。任务使用instance_id映射与专用私有输入；源普通业务和原任务入口保持可用。所有缺失handler在aliyun模式必须明确未实现，不能回落source或悄悄返回空列表。
