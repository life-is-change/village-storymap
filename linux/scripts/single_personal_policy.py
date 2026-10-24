"""Candidate-only exact function patch for one personal workspace and shared read access."""
import re
from autonomous_bundle import load_script
from workspace_context import body as personal_body
browser=load_script('repair-autonomous-browser')


def public_definition(source,name):
    matches=re.findall(r'create or replace function public\.'+name+r'\(.*?\n\$\$;',source,re.S|re.I)
    if not matches:raise ValueError('KNOWN_PUBLIC_POLICY_REQUIRED')
    return matches[-1]


def function_body(definition):
    match=re.search(r'\bas \$\$(.*?)\$\$;',definition,re.S|re.I)
    if not match:raise ValueError('KNOWN_POLICY_BODY_REQUIRED')
    return match[1]


def replacements(root,catalog=None):
    repair=(root/'supabase_SQL/Multi-Village Dual-Track Repair.sql').read_text(encoding='utf8')
    access=function_body(public_definition(repair,'context_space_accessible'))
    read_marker="        and (\n          public.current_profile_role() in ('teacher', 'admin')"
    replacement="""        and (
          (space.space_type IN ('practice_shared','formal_shared') AND project.stage NOT IN ('completed','archived')
            AND EXISTS(SELECT 1 FROM public.villages v WHERE v.id=space.village_id AND v.status='published'
              AND ((space.space_type='practice_shared' AND v.is_practice)
                OR (space.space_type='formal_shared' AND project.formal_project_open AND project.formal_village_id=v.id))))
          OR (space.space_type NOT IN ('practice_shared','formal_shared') AND (
          public.current_profile_role() in ('teacher', 'admin')"""
    if access.count(read_marker)!=1:raise ValueError('KNOWN_SHARED_ACCESS_REQUIRED')
    after=access.replace(read_marker,replacement)
    marker="        )\n    )\n    or exists ("
    if after.count(marker)!=1:raise ValueError('KNOWN_SHARED_ACCESS_REQUIRED')
    after=after.replace(marker,"        )))\n    )\n    or exists (",1)
    # Active identities only; API guards remain in place as well.
    after=after.replace('select auth.uid() is not null and (',"select auth.uid() is not null and EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.disabled_at IS NULL) and (")
    result=[('public.context_space_accessible(uuid,uuid,text)',access,after)]
    mutable=function_body(public_definition(repair,'context_space_mutable'))
    after=mutable.replace("public.current_profile_role() in ('teacher', 'admin')", "(public.current_profile_role()='admin' OR (space.space_type NOT IN ('practice_shared','formal_shared') AND public.current_profile_role()='teacher'))")
    after=after.replace('select 1 from public.group_memberships membership\n          where membership.course_id = project.course_id', 'select 1 from public.group_memberships membership JOIN public.course_groups enrolled ON enrolled.id=membership.group_id AND enrolled.course_id=membership.course_id\n          where membership.course_id = project.course_id',1)
    after=after.replace('select auth.uid() is not null and exists (','select auth.uid() is not null AND public.context_space_accessible(p_teaching_project_id,p_village_id,p_space_id) and exists (',1)
    result.append(('public.context_space_mutable(uuid,uuid,text)',mutable,after))
    personal=personal_body((root/'linux/sql/workspace-personal-context.sql').read_text(encoding='utf8'))
    after=personal.replace('  v_project public.teaching_projects;', '  v_project public.teaching_projects;\n  v_target public.planning_spaces;')
    after=after.replace('  return v_space;',"""  v_target:=public.ensure_context_space(p_teaching_project_id,
    CASE WHEN p_village_id='mibu' THEN v_project.practice_village_id ELSE p_village_id::uuid END,
    p_space_type,'我的个人体验空间',NULL);
  UPDATE public.course_personal_spaces SET experience_space_id=v_target.id WHERE id=v_space.id RETURNING * INTO v_space;
  return v_space;""")
    result.append(('public.ensure_course_personal_space(text,uuid,text,text,text)',personal,after))
    selection=function_body(public_definition((root/'supabase_SQL/Personal Figure Ground Spaces and Layer Versions.sql').read_text(encoding='utf8'),'set_personal_layer_version'))
    after=selection.replace('declare v_user_id uuid := auth.uid();','declare v_user_id uuid := auth.uid(); v_layer record;')
    marker="  if not exists(select 1 from public.personal_layer_versions"
    if after.count(marker)!=1:raise ValueError('KNOWN_PERSONAL_SELECTION_REQUIRED')
    after=after.replace(marker,"""    if p_layer_key='bundle' then
      if not exists(select 1 from public.personal_result_bundles b where b.id=p_version_id and b.space_id=p_space_id
        and (b.local_task_id is null or exists(select 1 from api_private.task_requests t where t.id=b.local_task_id and t.imported_bundle=b.id and t.state='completed')))
      then raise exception 'RESULT_NOT_COMPLETE';end if;
      if not exists(select 1 from public.personal_layer_versions where bundle_id=p_version_id and space_id=p_space_id) then raise exception 'RESULT_NOT_COMPLETE';end if;
      for v_layer in select * from public.personal_layer_versions where bundle_id=p_version_id and space_id=p_space_id order by layer_key loop
        insert into public.personal_layer_selections(space_id,layer_key,current_version_id,comparison_version_id)
        values(p_space_id,v_layer.layer_key,v_layer.id,null) on conflict(space_id,layer_key) do update set
          current_version_id=excluded.current_version_id,comparison_version_id=null,updated_at=now();
      end loop;
      return true;
    end if;
"""+marker,1)
    result.append(('public.set_personal_layer_version(uuid,text,uuid)',selection,after))
    planning=(root/'linux/sql/unified/planning.sql').read_text(encoding='utf8')
    before=browser.function_body(planning,'planning_read')
    marker="WHEN 'personal.listVersions' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]')"
    after=before.replace(marker,"WHEN 'personal.listVersions' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('applicable',v.local_task_id IS NULL OR EXISTS(SELECT 1 FROM api_private.task_requests t WHERE t.id=v.local_task_id AND t.imported_bundle=v.bundle_id AND t.state='completed'))),'[]')")
    if before==after:raise ValueError('KNOWN_PERSONAL_HISTORY_REQUIRED')
    result.append(('api_private.planning_read(text,jsonb)',before,after))
    catalog=catalog or (root/'linux/sql/unified/catalog.sql').read_text(encoding='utf8')
    projection="to_jsonb(s)||jsonb_build_object('readonly',s.readonly OR NOT api_private.context_mutable(s.teaching_project_id,s.village_id,s.id),'edit_enabled',s.edit_enabled AND api_private.context_mutable(s.teaching_project_id,s.village_id,s.id))"
    for name in ('catalog_read','catalog_bootstrap'):
        before=browser.updated_body(browser.function_body(catalog,name))
        after=before.replace('jsonb_agg(to_jsonb(s))','jsonb_agg('+projection+')')
        after=after.replace('SELECT to_jsonb(s) INTO result FROM public.planning_spaces','SELECT '+projection+' INTO result FROM public.planning_spaces')
        if after==before:raise ValueError('KNOWN_CATALOG_PROJECTION_REQUIRED')
        result.append(('api_private.'+name+('()' if name=='catalog_bootstrap' else '(text,jsonb)'),before,after))
    return result


def patch_sql(root,*,apply=True,catalog=None):
    quote=lambda s:"'"+s.replace("'","''")+"'"
    parts=['BEGIN;' if apply else 'BEGIN READ ONLY;',"SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';",
        "DO $g$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_DATABASE_REQUIRED';END IF;END$g$;"]
    parts.append("""DO $columns$DECLARE total integer;BEGIN
 SELECT count(1) INTO total FROM pg_attribute WHERE (attrelid='public.planning_spaces'::regclass AND attname='applied_result_versions' OR attrelid='public.course_personal_spaces'::regclass AND attname='experience_space_id') AND NOT attisdropped;
 IF total NOT IN(0,2) THEN RAISE EXCEPTION 'SINGLE_PERSONAL_SCHEMA_CHANGED';END IF;
 IF total=2 AND (to_regprocedure('api_private.apply_personal_selection()') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.personal_layer_selections'::regclass AND tgname='apply_personal_experience')) THEN RAISE EXCEPTION 'SINGLE_PERSONAL_SCHEMA_CHANGED';END IF;
 IF total=2 AND (NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.planning_spaces'::regclass AND attname='applied_result_versions' AND atttypid='jsonb'::regtype AND attnotnull)
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.course_personal_spaces'::regclass AND attname='experience_space_id' AND atttypid='text'::regtype)) THEN RAISE EXCEPTION 'SINGLE_PERSONAL_SCHEMA_CHANGED';END IF;
END$columns$;""")
    if apply:parts.extend(["ALTER TABLE public.course_personal_spaces ADD COLUMN IF NOT EXISTS experience_space_id text REFERENCES public.planning_spaces(id);", "ALTER TABLE public.planning_spaces ADD COLUMN IF NOT EXISTS applied_result_versions jsonb NOT NULL DEFAULT '{}';"])
    for signature,before,after in replacements(root,catalog):
        change='IF actual=original THEN EXECUTE replace(definition,original,patched);END IF;' if apply else ''
        parts.append('DO $cas$DECLARE original text:='+quote(before)+';patched text:='+quote(after)+";actual text;definition text;BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO actual,definition FROM pg_proc WHERE oid="+quote(signature)+"::regprocedure;IF actual IS NULL OR actual NOT IN(original,patched) THEN RAISE EXCEPTION 'SINGLE_PERSONAL_FUNCTION_CHANGED';END IF;"+change+'END$cas$;')
    definition=(root/'linux/sql/single-personal-apply.sql').read_text(encoding='utf8')
    body=function_body(definition)
    create='IF actual IS NULL THEN EXECUTE '+quote(definition)+';END IF;' if apply else ''
    parts.append("DO $fn$DECLARE actual text;BEGIN SELECT prosrc INTO actual FROM pg_proc WHERE oid=to_regprocedure('api_private.apply_personal_selection()');IF actual IS NOT NULL AND actual<>"+quote(body)+" THEN RAISE EXCEPTION 'SINGLE_PERSONAL_TRIGGER_CHANGED';END IF;"+create+'END$fn$;')
    if apply:
        parts.append('REVOKE ALL ON FUNCTION api_private.apply_personal_selection() FROM PUBLIC,anon,authenticated,village_unified_login;')
        parts.append("""DO $trg$BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.personal_layer_selections'::regclass AND tgname='apply_personal_experience' AND (tgfoid<>'api_private.apply_personal_selection()'::regprocedure OR tgtype<>21 OR tgenabled<>'O')) THEN RAISE EXCEPTION 'SINGLE_PERSONAL_TRIGGER_CHANGED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.personal_layer_selections'::regclass AND tgname='apply_personal_experience') THEN
  CREATE TRIGGER apply_personal_experience AFTER INSERT OR UPDATE ON public.personal_layer_selections FOR EACH ROW EXECUTE FUNCTION api_private.apply_personal_selection();END IF;
END$trg$;""")
    return '\n'.join(parts)+'\nCOMMIT;\n'
