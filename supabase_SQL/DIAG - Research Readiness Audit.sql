-- ============================================================================
-- DIAG - Research Readiness Audit
-- 村庄规划互动平台：论文课堂研究准备度只读核验
--
-- 使用方式：
--   1. 在 Supabase SQL Editor 中新建查询并粘贴本文件全部内容。
--   2. 点击 Run；脚本只返回一张诊断结果表，不会修改任何数据或配置。
--   3. 导出 Results 为 CSV，或把结果截图/复制给 Codex 继续分析。
--
-- 安全说明：
--   - 只查询系统目录、表的行数与聚合结果。
--   - 不返回姓名、学号、邮箱、评论、照片地址或事件 metadata。
--   - 不包含 CREATE / ALTER / INSERT / UPDATE / DELETE / DROP / GRANT / REVOKE。
--   - 数据行数来自 pg_stat_user_tables 的统计估算，可能与实时精确值略有差异；
--     其用途是判断正式数据是否明显缺失，而不是生成研究数据集。
-- ============================================================================

with
required_tables(table_name, purpose, minimum_rows) as (
  values
    ('profiles', '用户身份与角色', 1::bigint),
    ('courses', '课程定义', 1::bigint),
    ('course_groups', '课程小组', 2::bigint),
    ('group_memberships', '小组成员关系', 3::bigint),
    ('task_progress', '任务进度', 0::bigint),
    ('activity_events', '过程事件', 0::bigint),
    ('villages', '正式与练习村庄', 1::bigint),
    ('village_datasets', '村庄数据集版本', 1::bigint),
    ('teaching_projects', '教学项目', 1::bigint),
    ('planning_spaces', '个人、共享与小组空间', 1::bigint),
    ('planning_features', '规划要素', 0::bigint),
    ('survey_feature_reviews', '共享现状校核事实', 0::bigint),
    ('feature_change_batches', '共享现状修改批次', 0::bigint),
    ('feature_versions', '对象修改版本', 0::bigint),
    ('feature_snapshots', '共享现状与方案快照', 0::bigint),
    ('feature_snapshot_items', '快照完整对象', 0::bigint),
    ('group_baseline_updates', '小组基线更新', 0::bigint),
    ('group_baseline_conflicts', '小组基线冲突', 0::bigint),
    ('group_plan_restore_points', '小组方案恢复点', 0::bigint),
    ('scene_edit_projects', '3D 场景项目', 0::bigint),
    ('scene_edit_objects', '3D 场景对象', 0::bigint),
    ('scene_edit_versions', '3D 场景版本', 0::bigint),
    ('scene_edit_assets', '3D 素材', 0::bigint),
    ('scene_edit_components', '3D 组合组件', 0::bigint)
),
table_facts as (
  select
    required.table_name,
    required.purpose,
    required.minimum_rows,
    (tables.table_name is not null) as exists_now,
    coalesce(stats.n_live_tup, 0)::bigint as estimated_rows
  from required_tables required
  left join information_schema.tables tables
    on tables.table_schema = 'public'
   and tables.table_name = required.table_name
  left join pg_stat_user_tables stats
    on stats.schemaname = 'public'
   and stats.relname = required.table_name
),
required_columns(table_name, column_name, purpose) as (
  values
    ('profiles', 'id', '权威用户 UUID'),
    ('profiles', 'role', 'student / teacher / admin'),
    ('profiles', 'student_id', '业务学号，仅业务使用'),
    ('activity_events', 'event_id', '事件主键'),
    ('activity_events', 'client_event_id', '客户端幂等键'),
    ('activity_events', 'occurred_at', '事件时间'),
    ('activity_events', 'student_key', '现有学生业务键'),
    ('activity_events', 'course_id', '课程上下文'),
    ('activity_events', 'teaching_project_id', '教学项目上下文'),
    ('activity_events', 'village_id', '村庄上下文'),
    ('activity_events', 'group_id', '小组上下文，可合法为空'),
    ('activity_events', 'task_id', '任务上下文'),
    ('activity_events', 'space_id', '空间上下文'),
    ('activity_events', 'action', '事件动作'),
    ('activity_events', 'target_type', '目标类型'),
    ('activity_events', 'target_id', '目标主键'),
    ('activity_events', 'view_mode', '2D / 3D 视图'),
    ('activity_events', 'metadata', '低频扩展上下文'),
    ('planning_spaces', 'teaching_project_id', '空间所属教学项目'),
    ('planning_spaces', 'village_id', '空间所属村庄'),
    ('planning_spaces', 'space_type', '空间类型'),
    ('planning_spaces', 'base_snapshot_id', '小组方案基线快照'),
    ('planning_features', 'operation_kind', '新增、修改、删除'),
    ('planning_features', 'base_object_code', '基线对象编码'),
    ('planning_features', 'base_snapshot_id', '要素基线快照'),
    ('planning_features', 'feature_revision', '要素修订号'),
    ('survey_feature_reviews', 'geometry_status', '现状校核事实状态'),
    ('survey_feature_reviews', 'geometry_revision', '几何修订号'),
    ('feature_snapshots', 'version_number', '快照版本号'),
    ('feature_snapshots', 'recommended_for_groups', '小组推荐基线'),
    ('scene_edit_projects', 'teaching_project_id', '场景教学项目'),
    ('scene_edit_projects', 'village_id', '场景村庄'),
    ('scene_edit_projects', 'space_id', '场景关联空间'),
    ('scene_edit_projects', 'group_id', '场景小组，可为空'),
    ('scene_edit_projects', 'scope_kind', 'group / admin_sandbox'),
    ('scene_edit_projects', 'baseline_revision', '场景打开时的基线'),
    ('scene_edit_projects', 'revision', '场景草稿修订号'),
    ('scene_edit_versions', 'document', '不可变 scene document'),
    ('scene_edit_versions', 'submission_status', '里程碑或提交状态')
),
column_facts as (
  select
    required.table_name,
    required.column_name,
    required.purpose,
    columns.column_name is not null as exists_now,
    coalesce(columns.data_type, '-') as data_type,
    coalesce(columns.is_nullable, '-') as is_nullable
  from required_columns required
  left join information_schema.columns columns
    on columns.table_schema = 'public'
   and columns.table_name = required.table_name
   and columns.column_name = required.column_name
),
required_functions(function_name, purpose) as (
  values
    ('current_profile_student_key', '当前登录者业务 student_key'),
    ('initialize_shared_survey_reviews', '初始化共享现状校核'),
    ('confirm_survey_feature_geometry', '确认对象几何'),
    ('save_feature_edit_batch', '保存共享现状编辑批次'),
    ('freeze_shared_survey_snapshot', '冻结正式 V0'),
    ('restore_survey_feature_version', '恢复共享对象版本'),
    ('ensure_group_plan_space', '建立唯一小组方案空间'),
    ('resolve_group_plan_features', '合并基线与小组覆盖'),
    ('save_group_plan_edit_batch', '保存小组方案'),
    ('preview_group_baseline_update', '预览基线更新'),
    ('apply_group_baseline_update', '执行基线更新'),
    ('resolve_group_baseline_conflict', '解决基线冲突'),
    ('restore_group_plan_restore_point', '恢复小组方案'),
    ('scene_edit_create_project', '创建 3D 场景项目'),
    ('scene_edit_load_project', '载入 3D 场景项目'),
    ('scene_edit_save_draft', '保存 3D 场景草稿'),
    ('scene_edit_create_version', '创建 3D 场景版本'),
    ('scene_edit_restore_version', '恢复 3D 场景版本'),
    ('scene_edit_submit_version', '提交 3D 场景版本')
),
function_facts as (
  select
    required.function_name,
    required.purpose,
    count(procedure.oid)::bigint as overload_count,
    bool_or(has_function_privilege('authenticated', procedure.oid, 'EXECUTE')) as authenticated_can_execute,
    bool_or(has_function_privilege('anon', procedure.oid, 'EXECUTE')) as anon_can_execute
  from required_functions required
  left join pg_namespace namespace
    on namespace.nspname = 'public'
  left join pg_proc procedure
    on procedure.pronamespace = namespace.oid
   and procedure.proname = required.function_name
  group by required.function_name, required.purpose
),
rls_targets(table_name, purpose) as (
  values
    ('activity_events', '研究事件'),
    ('survey_feature_reviews', '共享现状校核'),
    ('feature_change_batches', '编辑批次'),
    ('feature_versions', '对象版本'),
    ('feature_snapshots', '快照'),
    ('group_baseline_updates', '基线更新'),
    ('group_baseline_conflicts', '基线冲突'),
    ('group_plan_restore_points', '方案恢复点'),
    ('scene_edit_projects', '场景项目'),
    ('scene_edit_objects', '场景对象'),
    ('scene_edit_versions', '场景版本'),
    ('scene_edit_assets', '场景素材'),
    ('scene_edit_components', '场景组件')
),
rls_facts as (
  select
    target.table_name,
    target.purpose,
    coalesce(class.relrowsecurity, false) as rls_enabled,
    count(policy.policyname)::bigint as policy_count
  from rls_targets target
  left join pg_namespace namespace
    on namespace.nspname = 'public'
  left join pg_class class
    on class.relnamespace = namespace.oid
   and class.relname = target.table_name
   and class.relkind in ('r', 'p')
  left join pg_policies policy
    on policy.schemaname = 'public'
   and policy.tablename = target.table_name
  group by target.table_name, target.purpose, class.relrowsecurity
),
realtime_targets(table_name, purpose) as (
  values
    ('planning_features', '小组与共享规划对象'),
    ('planning_spaces', '规划空间'),
    ('feature_edit_locks', '对象编辑锁'),
    ('feature_change_batches', '编辑批次'),
    ('feature_versions', '对象版本'),
    ('feature_snapshots', '快照'),
    ('feature_snapshot_items', '快照对象'),
    ('survey_feature_reviews', '校核状态'),
    ('group_baseline_updates', '基线更新'),
    ('group_baseline_conflicts', '基线冲突')
),
realtime_facts as (
  select
    target.table_name,
    target.purpose,
    publication.tablename is not null as published
  from realtime_targets target
  left join pg_publication_tables publication
    on publication.pubname = 'supabase_realtime'
   and publication.schemaname = 'public'
   and publication.tablename = target.table_name
),
known_actions(action) as (
  values
    ('course_entered'),
    ('task_opened'),
    ('task_completed'),
    ('group_joined'),
    ('theory_lesson_completed'),
    ('theory_practice_entered'),
    ('feature_geometry_saved'),
    ('object_attributes_updated'),
    ('diagnosis_created'),
    ('comment_created'),
    ('photo_uploaded'),
    ('object_comment_created'),
    ('object_comment_liked'),
    ('object_comment_replied'),
    ('survey_geometry_confirmed'),
    ('survey_geometry_add'),
    ('survey_geometry_update'),
    ('survey_geometry_delete'),
    ('survey_snapshot_frozen'),
    ('group_plan_edited'),
    ('view_switched'),
    ('scene_opened'),
    ('scene_operation_committed'),
    ('scene_saved'),
    ('scene_version_created'),
    ('scene_restored')
),
action_facts as (
  select
    action.action,
    case
      when to_regclass('public.activity_events') is null
        or not exists (
          select 1
          from information_schema.columns column_info
          where column_info.table_schema = 'public'
            and column_info.table_name = 'activity_events'
            and column_info.column_name = 'action'
        ) then null
      else coalesce(
        nullif(
          (xpath(
            '/table/row/value/text()',
            query_to_xml(
              format('select count(*) as value from public.activity_events where action = %L', action.action),
              false,
              true,
              ''
            )
          ))[1]::text,
          ''
        )::bigint,
        0
      )
    end as event_count
  from known_actions action
),
scalar_checks(check_key, relation_name, dependency_columns, read_query) as (
  values
    ('activity_total', 'public.activity_events', array[]::text[],
      'select count(*) as value from public.activity_events'),
    ('activity_missing_student', 'public.activity_events', array['student_key'],
      'select count(*) as value from public.activity_events where nullif(btrim(student_key), '''') is null'),
    ('activity_missing_course', 'public.activity_events', array['course_id'],
      'select count(*) as value from public.activity_events where nullif(btrim(course_id), '''') is null'),
    ('activity_missing_project', 'public.activity_events', array['teaching_project_id'],
      'select count(*) as value from public.activity_events where teaching_project_id is null'),
    ('activity_missing_village', 'public.activity_events', array['village_id'],
      'select count(*) as value from public.activity_events where village_id is null'),
    ('activity_missing_space', 'public.activity_events', array['space_id'],
      'select count(*) as value from public.activity_events where nullif(btrim(space_id), '''') is null'),
    ('activity_missing_task', 'public.activity_events', array['task_id'],
      'select count(*) as value from public.activity_events where nullif(btrim(task_id), '''') is null'),
    ('activity_unknown_actions', 'public.activity_events', array['action'],
      'select count(*) as value from public.activity_events where action not in (
        ''course_entered'', ''task_opened'', ''task_completed'', ''group_joined'',
        ''theory_lesson_completed'', ''theory_practice_entered'', ''feature_geometry_saved'',
        ''object_attributes_updated'', ''diagnosis_created'', ''comment_created'', ''photo_uploaded'',
        ''object_comment_created'', ''object_comment_liked'', ''object_comment_replied'',
        ''survey_geometry_confirmed'', ''survey_geometry_add'', ''survey_geometry_update'',
        ''survey_geometry_delete'', ''survey_snapshot_frozen'', ''group_plan_edited'',
        ''view_switched'', ''scene_opened'', ''scene_operation_committed'', ''scene_saved'',
        ''scene_version_created'', ''scene_restored''
      )'),
    ('formal_villages', 'public.villages', array[]::text[],
      'select count(*) as value from public.villages'),
    ('formal_datasets', 'public.village_datasets', array[]::text[],
      'select count(*) as value from public.village_datasets'),
    ('formal_projects', 'public.teaching_projects', array[]::text[],
      'select count(*) as value from public.teaching_projects'),
    ('formal_shared_spaces', 'public.planning_spaces', array['space_type'],
      'select count(*) as value from public.planning_spaces where space_type = ''formal_shared'''),
    ('formal_group_plan_spaces', 'public.planning_spaces', array['space_type'],
      'select count(*) as value from public.planning_spaces where space_type = ''group_plan'''),
    ('formal_published_snapshots', 'public.feature_snapshots', array['is_published'],
      'select count(*) as value from public.feature_snapshots where is_published is true'),
    ('formal_recommended_snapshots', 'public.feature_snapshots', array['recommended_for_groups'],
      'select count(*) as value from public.feature_snapshots where recommended_for_groups is true'),
    ('formal_scene_projects', 'public.scene_edit_projects', array[]::text[],
      'select count(*) as value from public.scene_edit_projects'),
    ('formal_scene_versions', 'public.scene_edit_versions', array[]::text[],
      'select count(*) as value from public.scene_edit_versions')
),
scalar_facts as (
  select
    check_key,
    relation_name,
    case
      when to_regclass(relation_name) is null
        or exists (
          select 1
          from unnest(dependency_columns) dependency(column_name)
          where not exists (
            select 1
            from information_schema.columns column_info
            where column_info.table_schema = split_part(relation_name, '.', 1)
              and column_info.table_name = split_part(relation_name, '.', 2)
              and column_info.column_name = dependency.column_name
          )
        ) then null
      else coalesce(
        nullif(
          (xpath(
            '/table/row/value/text()',
            query_to_xml(read_query, false, true, '')
          ))[1]::text,
          ''
        )::bigint,
        0
      )
    end as value
  from scalar_checks
),
activity_summary as (
  select
    max(value) filter (where check_key = 'activity_total') as total_events,
    max(value) filter (where check_key = 'activity_missing_student') as missing_student,
    max(value) filter (where check_key = 'activity_missing_course') as missing_course,
    max(value) filter (where check_key = 'activity_missing_project') as missing_project,
    max(value) filter (where check_key = 'activity_missing_village') as missing_village,
    max(value) filter (where check_key = 'activity_missing_space') as missing_space,
    max(value) filter (where check_key = 'activity_missing_task') as missing_task,
    max(value) filter (where check_key = 'activity_unknown_actions') as unknown_actions
  from scalar_facts
),
formal_data as (
  select
    max(value) filter (where check_key = 'formal_villages') as villages,
    max(value) filter (where check_key = 'formal_datasets') as datasets,
    max(value) filter (where check_key = 'formal_projects') as projects,
    max(value) filter (where check_key = 'formal_shared_spaces') as formal_shared_spaces,
    max(value) filter (where check_key = 'formal_group_plan_spaces') as group_plan_spaces,
    max(value) filter (where check_key = 'formal_published_snapshots') as published_snapshots,
    max(value) filter (where check_key = 'formal_recommended_snapshots') as recommended_snapshots,
    max(value) filter (where check_key = 'formal_scene_projects') as scene_projects,
    max(value) filter (where check_key = 'formal_scene_versions') as scene_versions
  from scalar_facts
),
results as (
  select
    1000 + row_number() over (order by table_name) as sort_key,
    'TABLE'::text as category,
    table_name::text as check_item,
    case
      when not exists_now then 'FAIL'
      when estimated_rows < minimum_rows then 'WARN'
      else 'PASS'
    end as status,
    format('用途=%s；估算行数=%s；建议最低=%s', purpose, estimated_rows, minimum_rows) as actual_result,
    case
      when not exists_now then '先确认对应迁移是否已在当前 Supabase 项目执行。'
      when estimated_rows < minimum_rows then '表已存在，但正式课堂所需基础数据可能尚未建立。'
      else '表与最低基础数据存在。'
    end as recommendation
  from table_facts

  union all
  select
    2000 + row_number() over (order by table_name, column_name),
    'COLUMN',
    table_name || '.' || column_name,
    case when exists_now then 'PASS' else 'FAIL' end,
    format('用途=%s；类型=%s；nullable=%s', purpose, data_type, is_nullable),
    case when exists_now then '字段存在。' else '核对并执行提供该字段的迁移，执行前先评估旧数据与 RLS。' end
  from column_facts

  union all
  select
    3000 + row_number() over (order by function_name),
    'RPC',
    function_name,
    case
      when overload_count = 0 then 'FAIL'
      when not coalesce(authenticated_can_execute, false) then 'FAIL'
      when coalesce(anon_can_execute, false) then 'WARN'
      else 'PASS'
    end,
    format('用途=%s；重载数=%s；authenticated=%s；anon=%s',
      purpose, overload_count, coalesce(authenticated_can_execute, false), coalesce(anon_can_execute, false)),
    case
      when overload_count = 0 then 'RPC 不存在；核对对应迁移。'
      when not coalesce(authenticated_can_execute, false) then '登录用户没有 EXECUTE 权限；核对授权。'
      when coalesce(anon_can_execute, false) then '匿名角色可以执行；应逐项核对是否符合安全设计。'
      else 'RPC 存在且基本执行权限符合预期。'
    end
  from function_facts

  union all
  select
    4000 + row_number() over (order by table_name),
    'RLS',
    table_name,
    case
      when to_regclass(format('public.%I', table_name)) is null then 'FAIL'
      when not rls_enabled then 'FAIL'
      when policy_count = 0 then 'WARN'
      else 'PASS'
    end,
    format('用途=%s；RLS=%s；策略数=%s', purpose, rls_enabled, policy_count),
    case
      when to_regclass(format('public.%I', table_name)) is null then '表不存在。'
      when not rls_enabled then '启用 RLS 前必须先检查现有访问路径与 RPC。'
      when policy_count = 0 then 'RLS 已开但无可见策略；确认是否有意仅允许 SECURITY DEFINER RPC。'
      else 'RLS 已启用并存在策略；仍需用三种角色做浏览器验收。'
    end
  from rls_facts

  union all
  select
    5000 + row_number() over (order by table_name),
    'REALTIME',
    table_name,
    case
      when to_regclass(format('public.%I', table_name)) is null then 'FAIL'
      when published then 'PASS'
      else 'WARN'
    end,
    format('用途=%s；supabase_realtime=%s', purpose, published),
    case
      when to_regclass(format('public.%I', table_name)) is null then '表不存在。'
      when published then '已加入 Realtime publication。'
      else '如前端依赖该表实时同步，再执行幂等 publication 配置。'
    end
  from realtime_facts

  union all
  select 6001, 'FORMAL_DATA', 'villages', case when villages is null then 'FAIL' when villages >= 1 then 'PASS' else 'FAIL' end,
    format('实际行数=%s', villages), '至少需要一个正式或练习村庄，并核对 status/is_practice。' from formal_data
  union all
  select 6002, 'FORMAL_DATA', 'village_datasets', case when datasets is null then 'FAIL' when datasets >= 1 then 'PASS' else 'FAIL' end,
    format('实际行数=%s', datasets), '至少需要一个已发布且与村庄关联的数据集。' from formal_data
  union all
  select 6003, 'FORMAL_DATA', 'teaching_projects', case when projects is null then 'FAIL' when projects >= 1 then 'PASS' else 'FAIL' end,
    format('实际行数=%s', projects), '正式课堂需要教学项目关联课程与村庄。' from formal_data
  union all
  select 6004, 'FORMAL_DATA', 'formal_shared', case when formal_shared_spaces is null then 'FAIL' when formal_shared_spaces >= 1 then 'PASS' else 'FAIL' end,
    format('实际空间数=%s', formal_shared_spaces), '正式课堂至少需要一个 formal_shared。' from formal_data
  union all
  select 6005, 'FORMAL_DATA', 'group_plan', case when group_plan_spaces is null then 'FAIL' when group_plan_spaces >= 2 then 'PASS' else 'WARN' end,
    format('实际空间数=%s', group_plan_spaces), '全链路演练建议至少两个小组方案空间。' from formal_data
  union all
  select 6006, 'FORMAL_DATA', 'published_snapshot', case when published_snapshots is null then 'FAIL' when published_snapshots >= 1 then 'PASS' else 'FAIL' end,
    format('已发布快照=%s', published_snapshots), '正式 group plan 之前应冻结一个完整 V0。' from formal_data
  union all
  select 6007, 'FORMAL_DATA', 'recommended_group_baseline', case when recommended_snapshots is null then 'FAIL' when recommended_snapshots >= 1 then 'PASS' else 'FAIL' end,
    format('推荐小组快照=%s', recommended_snapshots), '确认小组方案使用正确的推荐 V0。' from formal_data
  union all
  select 6008, 'FORMAL_DATA', 'scene_projects', case when scene_projects is null then 'FAIL' when scene_projects >= 1 then 'PASS' else 'WARN' end,
    format('场景项目=%s；场景版本=%s', scene_projects, scene_versions), '若本轮课堂使用模块二，应至少完成一次保存和版本创建。' from formal_data

  union all
  select 7001, 'ACTIVITY', 'total_events', case when total_events is null then 'FAIL' when total_events > 0 then 'PASS' else 'WARN' end,
    format('总事件=%s', total_events), '无事件时无法重建课堂过程；先用模拟账号完成一轮。' from activity_summary
  union all
  select 7002, 'ACTIVITY', 'missing_student', case when missing_student is null then 'FAIL' when missing_student = 0 then 'PASS' else 'FAIL' end,
    format('缺 student_key=%s / %s', missing_student, total_events), '关键事件必须可以关联参与者。' from activity_summary
  union all
  select 7003, 'ACTIVITY', 'missing_course', case when missing_course is null then 'FAIL' when missing_course = 0 then 'PASS' else 'WARN' end,
    format('缺 course_id=%s / %s', missing_course, total_events), '核对非课程事件是否合理；正式课堂事件应有课程。' from activity_summary
  union all
  select 7004, 'ACTIVITY', 'missing_project', case when missing_project is null then 'FAIL' when missing_project = 0 then 'PASS' else 'FAIL' end,
    format('缺 teaching_project_id=%s / %s', missing_project, total_events), '确认后续迁移和 ActivityLogger 上下文。' from activity_summary
  union all
  select 7005, 'ACTIVITY', 'missing_village', case when missing_village is null then 'FAIL' when missing_village = 0 then 'PASS' else 'FAIL' end,
    format('缺 village_id=%s / %s', missing_village, total_events), '正式研究事件必须关联规范 village UUID。' from activity_summary
  union all
  select 7006, 'ACTIVITY', 'missing_space', case when missing_space is null then 'FAIL' when missing_space = 0 then 'PASS' else 'FAIL' end,
    format('缺 space_id=%s / %s', missing_space, total_events), '关键地图和场景事件必须关联空间。' from activity_summary
  union all
  select 7007, 'ACTIVITY', 'missing_task', case when missing_task is null then 'FAIL' when missing_task = 0 then 'PASS' else 'WARN' end,
    format('缺 task_id=%s / %s', missing_task, total_events), '课程外事件可为空；用于研究的场景/方案事件应补任务上下文。' from activity_summary
  union all
  select 7008, 'ACTIVITY', 'unknown_actions', case when unknown_actions is null then 'FAIL' when unknown_actions = 0 then 'PASS' else 'WARN' end,
    format('未知 action 事件数=%s', unknown_actions), '把未知 action 补入版本化事件字典，勿直接删除历史。' from activity_summary

  union all
  select
    8000 + row_number() over (order by action),
    'ACTION',
    action,
    case
      when event_count is null then 'FAIL'
      when action in ('view_switched', 'scene_opened', 'scene_operation_committed', 'scene_saved', 'scene_version_created', 'scene_restored')
        and event_count = 0 then 'WARN'
      else 'PASS'
    end,
    format('事件数=%s', event_count),
    case
      when event_count = 0 then '当前未采集；先判断课堂是否会触发，再决定是否补低频事件。'
      else '已有事件；进一步抽样检查上下文完整性。'
    end
  from action_facts
)
select
  category as "检查类别",
  check_item as "检查项目",
  status as "状态",
  actual_result as "实际结果",
  recommendation as "建议处理"
from results
order by sort_key;
