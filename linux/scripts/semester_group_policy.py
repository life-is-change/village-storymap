"""Exact, additive function migration for semester groups on the local business DB."""
import re
from pathlib import Path
from single_personal_policy import replacements as single_replacements


def public_body(root, filename, name):
    source=(Path(root)/filename).read_text(encoding='utf8')
    pattern=r'create or replace function public\.'+re.escape(name)+r'\(.*?\bas\s+(\$\w*\$)(.*?)\1;'
    found=list(re.finditer(pattern,source,re.S|re.I))
    if not found:raise ValueError('KNOWN_SEMESTER_FUNCTION_REQUIRED')
    return found[-1][2]


def replace_once(body, before, after):
    if body.count(before)!=1:raise ValueError('KNOWN_SEMESTER_FUNCTION_REQUIRED')
    return body.replace(before,after,1)


def replacements(root):
    result=[]
    single={name:after for name,_,after in single_replacements(root)}
    for name in ('context_space_accessible','context_space_mutable'):
        signature='public.'+name+'(uuid,uuid,text)'
        before=single[signature]
        after=before.replace('where membership.course_id = project.course_id',
            'where public.project_group_eligible(membership.group_id, project.id)')
        if name=='context_space_mutable':
            after=replace_once(after,'and space.village_id = p_village_id and space.readonly = false',
                "and project.stage NOT IN ('completed','archived')\n      and space.village_id = p_village_id and space.readonly = false")
        if before==after:raise ValueError('KNOWN_SEMESTER_FUNCTION_REQUIRED')
        result.append((signature,before,after))
    signature='public.ensure_course_personal_space(text,uuid,text,text,text)'
    before=single[signature]
    after=replace_once(before,'ON CONFLICT(owner_id, course_id, village_id, space_type)',
        'ON CONFLICT(owner_id, course_id, teaching_project_id, village_id, space_type)')
    result.append((signature,before,after))
    for name,signature in [('catalog_read','(text,jsonb)'),('catalog_write','(text,jsonb)')]:
        key='api_private.'+name+signature
        if name=='catalog_read':before=single[key]
        else:
            source=(Path(root)/'linux/sql/unified/catalog.sql').read_text(encoding='utf8')
            from autonomous_bundle import load_script
            before=load_script('repair-autonomous-browser').function_body(source,name)
        actions=("'catalog.listGroups','catalog.getCourseContext','catalog.getProgress','catalog.listActivity','catalog.groupRoster'"
            if name=='catalog_read' else "'catalog.createGroup','catalog.joinGroup','catalog.lockGroup','catalog.setProgress','catalog.recordActivity'")
        after=replace_once(before,' BEGIN'," BEGIN\n IF a IN ("+actions+") THEN RETURN api_private.semester_"+name+"(a,p); END IF;")
        result.append((key,before,after))
    source='supabase_SQL/Group Plan Baseline Update.sql'
    for name,signature in [('ensure_group_plan_space','(uuid,uuid,text,uuid)'),
            ('ensure_group_plan_spaces_for_snapshot','(uuid)'),('get_group_plan_admin_dashboard','(uuid,uuid)')]:
        before=public_body(root,source,name)
        after=replace_once(before,'course_group.course_id = v_project.course_id',
            'public.project_group_eligible(course_group.id, v_project.id)')
        if name=='ensure_group_plan_space':
            after=replace_once(after,"  if not found then raise exception 'FORMAL_VILLAGE_PROJECT_REQUIRED'; end if;",
                "  if not found then raise exception 'FORMAL_VILLAGE_PROJECT_REQUIRED'; end if;\n  IF v_project.stage IN ('completed','archived') OR NOT v_project.formal_project_open THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;")
            after=after.replace('where membership.course_id = v_project.course_id',
                'where public.project_group_eligible(membership.group_id, v_project.id)')
            pattern=r"v_space_id := coalesce\(\s*nullif\(btrim\(v_group.space_id\), ''\),\s*concat\('group-plan-', p_group_id\)\s*\);"
            after,n=re.subn(pattern,"v_space_id := concat('group-plan-', md5(concat_ws(':', p_teaching_project_id, p_village_id, p_group_id)));",after)
            if n!=1:raise ValueError('KNOWN_SEMESTER_SPACE_ID_REQUIRED')
        if name=='get_group_plan_admin_dashboard':
            after=replace_once(after,'where membership.course_id = v_project.course_id\n      and membership.group_id = course_group.id',
                'where membership.group_id = course_group.id')
        result.append(('public.'+name+signature,before,after))
    before=public_body(root,source,'is_group_plan_member')
    after=replace_once(before,'on membership.course_id = project.course_id\n     and membership.group_id = space.group_id',
        'on public.project_group_eligible(membership.group_id, project.id)\n     and membership.group_id = space.group_id')
    result.append(('public.is_group_plan_member(text)',before,after))
    before=public_body(root,'supabase_SQL/Teaching Project Practice Catalog and Village Lifecycle.sql','ensure_context_space')
    marker="  select id into v_dataset_id from public.village_datasets"
    after=replace_once(before,marker,"""  IF p_space_type='group_plan' THEN
    IF NOT public.project_group_eligible(p_group_id,p_teaching_project_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT s.* INTO v_space FROM public.planning_spaces s
    WHERE s.id=(public.ensure_group_plan_space(p_teaching_project_id,p_village_id,p_group_id,NULL)->>'space_id');
    IF NOT FOUND THEN RAISE EXCEPTION 'FROZEN_BASELINE_REQUIRED'; END IF;
    RETURN v_space;
  END IF;
"""+marker)
    after=after.replace('where membership.course_id = v_project.course_id',
        'where public.project_group_eligible(membership.group_id, v_project.id)')
    result.append(('public.ensure_context_space(uuid,uuid,text,text,text)',before,after))
    before=public_body(root,'supabase_SQL/Multi-Village Dual-Track Foundation.sql','bind_formal_village')
    marker="  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;"
    after=replace_once(before,marker,marker+"\n  IF EXISTS(SELECT 1 FROM public.course_groups g WHERE g.teaching_project_id=p_teaching_project_id AND g.scope_kind='semester' AND g.formal_village_id IS DISTINCT FROM p_village_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;")
    result.append(('public.bind_formal_village(uuid,uuid)',before,after))
    source=(Path(root)/'linux/sql/unified/planning.sql').read_text(encoding='utf8')
    from autonomous_bundle import load_script
    before=load_script('repair-autonomous-browser').function_body(source,'planning_write')
    marker="IF target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM api_private.assert_context(target);"
    if before.count(marker)!=2:raise ValueError('KNOWN_SEMESTER_TARGET_MUTATION_REQUIRED')
    after=before.replace(marker,marker+"\n  IF NOT api_private.context_mutable((target->>'teachingProjectId')::uuid,(target->>'villageId')::uuid,target->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;")
    result.append(('api_private.planning_write(text,jsonb)',before,after))
    source='supabase_SQL/Scene Edit Studio.sql'
    before=public_body(root,source,'is_scene_edit_group_member')
    after=replace_once(before,'and membership.course_id = p_course_id',
        "and EXISTS(SELECT 1 FROM public.teaching_projects p WHERE p.course_id=p_course_id AND public.project_group_eligible(membership.group_id,p.id))")
    result.append(('public.is_scene_edit_group_member(text,text)',before,after))
    before=public_body(root,source,'can_read_scene_edit_project')
    after=replace_once(before,"(project.scope_kind = 'group' and (",
        "(project.scope_kind = 'group' and (public.is_scene_edit_staff() OR public.project_group_eligible(project.group_id,teaching.id)) and (")
    result.append(('public.can_read_scene_edit_project(uuid)',before,after))
    return result


def quote(value):return "'"+value.replace("'","''")+"'"


def patch_sql(root, *, apply=True):
    parts=['BEGIN;' if apply else 'BEGIN READ ONLY;',"SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';",
        "DO $guard$ BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_DATABASE_REQUIRED'; END IF; END $guard$;"]
    parts.append("""DO $history$ BEGIN
 IF EXISTS(SELECT 1 FROM public.course_groups WHERE join_code='332' AND
  (id<>'cf5a8891-7505-4fd1-a782-6ca1a2d16456' OR name<>'332 实验室协作组')) THEN RAISE EXCEPTION 'LAB_GROUP_IDENTITY_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.planning_spaces WHERE space_type='group_plan'
  AND group_id<>'cf5a8891-7505-4fd1-a782-6ca1a2d16456'
  GROUP BY group_id HAVING count(DISTINCT (teaching_project_id,village_id))>1)
 THEN RAISE EXCEPTION 'SEMESTER_GROUP_AMBIGUOUS_HISTORY'; END IF;
END $history$;""")
    schema=(Path(root)/'linux/sql/semester-groups.sql').read_text(encoding='utf8')
    for signature,body in helper_bodies(root):
        parts.append("DO $helper$ DECLARE actual text; BEGIN SELECT prosrc INTO actual FROM pg_proc WHERE oid=to_regprocedure("+quote(signature)+"); IF actual IS NOT NULL AND actual<>"+quote(body)+" THEN RAISE EXCEPTION 'SEMESTER_GROUP_HELPER_CHANGED'; END IF; END $helper$;")
    changes=replacements(root)
    # All definitions are checked before any schema or data writes.
    for signature,before,after in changes:
        parts.append("DO $check$ DECLARE actual text; BEGIN SELECT prosrc INTO actual FROM pg_proc WHERE oid=to_regprocedure("+quote(signature)+"); IF actual IS NULL OR actual NOT IN ("+', '.join(quote(b) for b in (before,before.replace('\n','\r\n'),after))+ ") THEN RAISE EXCEPTION 'SEMESTER_GROUP_FUNCTION_CHANGED'; END IF; END $check$;")
    if apply:
        parts.append(schema)
        for signature,before,after in changes:
            parts.append("DO $replace$ DECLARE actual text; definition text; BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO actual,definition FROM pg_proc WHERE oid="+quote(signature)+"::regprocedure; IF actual<>"+quote(after)+" THEN EXECUTE replace(definition,actual,"+quote(after)+"); END IF; END $replace$;")
    parts.append('COMMIT;')
    return '\n'.join(parts)+'\n'


def helper_bodies(root):
    schema=(Path(root)/'linux/sql/semester-groups.sql').read_text(encoding='utf8')
    signatures={'stamp_semester_membership':'()','guard_semester_group_plan':'()',
        'guard_semester_scene_project':'()','guard_semester_scene_version':'()',
        'project_group_eligible':'(text,uuid)','semester_group_member':'(uuid,text)',
        'semester_project':'(jsonb,boolean)','semester_catalog_read':'(text,jsonb)','semester_catalog_write':'(text,jsonb)'}
    return [(scope+'.'+name+signatures[name],body) for scope,name,body in
        re.findall(r'CREATE OR REPLACE FUNCTION (api_private|public)\.(\w+)\([^;]*?AS \$\$(.*?)\$\$;',schema,re.S)]
