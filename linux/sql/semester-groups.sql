-- Installed transactionally by semester_group_policy.py after the single-personal repair.
ALTER TABLE public.course_groups
 ADD COLUMN IF NOT EXISTS teaching_project_id uuid REFERENCES public.teaching_projects(id),
 ADD COLUMN IF NOT EXISTS formal_village_id uuid REFERENCES public.villages(id),
 ADD COLUMN IF NOT EXISTS scope_kind text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.group_memberships
 ADD COLUMN IF NOT EXISTS teaching_project_id uuid REFERENCES public.teaching_projects(id),
 ADD COLUMN IF NOT EXISTS scope_kind text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.task_progress ADD COLUMN IF NOT EXISTS teaching_project_id uuid REFERENCES public.teaching_projects(id);

-- Resolve only existing group plans with one unambiguous project/village pair.
DO $migration$
DECLARE g record; n integer; pid uuid; vid uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.course_groups WHERE join_code='332'
   AND (id<>'cf5a8891-7505-4fd1-a782-6ca1a2d16456' OR name<>'332 实验室协作组'))
 THEN RAISE EXCEPTION 'LAB_GROUP_IDENTITY_CHANGED'; END IF;
 UPDATE public.course_groups SET scope_kind='lab',teaching_project_id=NULL,formal_village_id=NULL
 WHERE id='cf5a8891-7505-4fd1-a782-6ca1a2d16456' AND join_code='332' AND name='332 实验室协作组';
 IF NOT EXISTS(SELECT 1 FROM public.course_groups WHERE join_code='332')
  AND EXISTS(SELECT 1 FROM public.courses WHERE id='mibu-village-planning') THEN
  INSERT INTO public.course_groups(id,course_id,name,join_code,scope_kind,created_by)
  VALUES('cf5a8891-7505-4fd1-a782-6ca1a2d16456','mibu-village-planning','332 实验室协作组','332','lab','系统');
 END IF;
 FOR g IN SELECT * FROM public.course_groups WHERE scope_kind='legacy' LOOP
  SELECT count(*),min(s.teaching_project_id::text)::uuid,min(s.village_id::text)::uuid INTO n,pid,vid
  FROM (SELECT DISTINCT teaching_project_id,village_id FROM public.planning_spaces
   WHERE group_id=g.id AND space_type='group_plan') s;
  IF n>1 THEN RAISE EXCEPTION 'SEMESTER_GROUP_AMBIGUOUS_HISTORY'; END IF;
  IF n=1 THEN
   IF NOT EXISTS(SELECT 1 FROM public.teaching_projects p JOIN public.villages v ON v.id=p.formal_village_id
     WHERE p.id=pid AND p.course_id=g.course_id AND p.formal_village_id=vid AND NOT v.is_practice)
   THEN RAISE EXCEPTION 'SEMESTER_GROUP_INVALID_HISTORY'; END IF;
   UPDATE public.course_groups SET scope_kind='semester',teaching_project_id=pid,formal_village_id=vid WHERE id=g.id;
  END IF;
 END LOOP;
END $migration$;

UPDATE public.group_memberships m SET teaching_project_id=g.teaching_project_id,scope_kind=g.scope_kind
FROM public.course_groups g WHERE g.id=m.group_id
 AND (m.teaching_project_id,m.scope_kind) IS DISTINCT FROM (g.teaching_project_id,g.scope_kind);
UPDATE public.task_progress t SET teaching_project_id=g.teaching_project_id
FROM public.course_groups g WHERE t.group_id=g.id AND g.scope_kind='semester' AND t.teaching_project_id IS NULL;

-- Remove only the audited old uniqueness definitions, preserving every row.
DO $constraints$
DECLARE c record;
BEGIN
 FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint
 WHERE contype='u' AND (conrelid='public.group_memberships'::regclass
   AND pg_get_constraintdef(oid)='UNIQUE (course_id, student_key)'
  OR conrelid='public.task_progress'::regclass
   AND pg_get_constraintdef(oid)='UNIQUE (course_id, student_key, task_id)'
  OR conrelid='public.course_personal_spaces'::regclass
   AND pg_get_constraintdef(oid)='UNIQUE (owner_id, course_id, village_id, space_type)')
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname); END LOOP;
END $constraints$;
-- Legacy installs also created the same unique keys as standalone indexes.
-- Remove only exact, unconditional column keys, never a primary/constraint index.
DO $indexes$
DECLARE i record;
BEGIN
 FOR i IN SELECT x.indexrelid::regclass AS idx FROM pg_index x
 WHERE x.indisunique AND NOT x.indisprimary AND x.indexprs IS NULL AND x.indpred IS NULL
  AND x.indnkeyatts=x.indnatts
  AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=x.indexrelid)
  AND (x.indrelid='public.group_memberships'::regclass
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(x.indkey) WITH ORDINALITY k(num,ord)
     JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.num)=ARRAY['course_id','student_key']
   OR x.indrelid='public.task_progress'::regclass
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(x.indkey) WITH ORDINALITY k(num,ord)
     JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.num)=ARRAY['course_id','student_key','task_id']
   OR x.indrelid='public.course_personal_spaces'::regclass
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(x.indkey) WITH ORDINALITY k(num,ord)
     JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.num)=ARRAY['owner_id','course_id','village_id','space_type'])
 LOOP EXECUTE format('DROP INDEX %s',i.idx); END LOOP;
END $indexes$;
CREATE UNIQUE INDEX IF NOT EXISTS semester_membership_unique ON public.group_memberships(teaching_project_id,student_key) WHERE scope_kind='semester';
CREATE UNIQUE INDEX IF NOT EXISTS semester_group_member_unique ON public.group_memberships(group_id,student_key);
CREATE UNIQUE INDEX IF NOT EXISTS semester_progress_unique ON public.task_progress(teaching_project_id, student_key, task_id);
CREATE UNIQUE INDEX IF NOT EXISTS semester_personal_unique ON public.course_personal_spaces(owner_id,course_id,teaching_project_id,village_id,space_type);
CREATE UNIQUE INDEX IF NOT EXISTS lab_group_singleton ON public.course_groups((true)) WHERE scope_kind='lab';
DO $checks$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.course_groups'::regclass AND conname='semester_group_scope') THEN
  ALTER TABLE public.course_groups ADD CONSTRAINT semester_group_scope CHECK(
   scope_kind='legacy' AND teaching_project_id IS NULL AND formal_village_id IS NULL
   OR scope_kind='semester' AND teaching_project_id IS NOT NULL AND formal_village_id IS NOT NULL
   OR scope_kind='lab' AND id='cf5a8891-7505-4fd1-a782-6ca1a2d16456' AND join_code='332'
      AND teaching_project_id IS NULL AND formal_village_id IS NULL);
 END IF;
END $checks$;

CREATE OR REPLACE FUNCTION public.project_group_eligible(gid text,pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.course_groups g JOIN public.teaching_projects p ON p.id=pid
 WHERE g.id=gid AND (g.scope_kind='lab' OR g.scope_kind='semester' AND g.course_id=p.course_id
  AND g.teaching_project_id=p.id AND g.formal_village_id=p.formal_village_id))
$$;
CREATE OR REPLACE FUNCTION public.semester_group_member(pid uuid,gid text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.group_memberships m
 WHERE m.student_key=public.current_profile_student_key() AND (gid IS NULL OR m.group_id=gid)
  AND public.project_group_eligible(m.group_id,pid))
$$;
REVOKE ALL ON FUNCTION public.project_group_eligible(text,uuid),public.semester_group_member(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_group_eligible(text,uuid),public.semester_group_member(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION api_private.stamp_semester_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE g public.course_groups;
BEGIN
 SELECT * INTO g FROM public.course_groups WHERE id=new.group_id;
 IF NOT FOUND OR g.course_id IS DISTINCT FROM new.course_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 new.scope_kind:=g.scope_kind;new.teaching_project_id:=g.teaching_project_id;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS stamp_semester_membership ON public.group_memberships;
CREATE TRIGGER stamp_semester_membership BEFORE INSERT OR UPDATE ON public.group_memberships
FOR EACH ROW EXECUTE FUNCTION api_private.stamp_semester_membership();

CREATE OR REPLACE FUNCTION api_private.guard_semester_group_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF new.space_type='group_plan' AND NOT EXISTS(SELECT 1 FROM public.teaching_projects p
  JOIN public.villages v ON v.id=p.formal_village_id
  WHERE p.id=new.teaching_project_id AND new.village_id=p.formal_village_id AND NOT v.is_practice
   AND public.project_group_eligible(new.group_id,p.id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS guard_semester_group_plan ON public.planning_spaces;
CREATE TRIGGER guard_semester_group_plan BEFORE INSERT OR UPDATE ON public.planning_spaces
FOR EACH ROW EXECUTE FUNCTION api_private.guard_semester_group_plan();

CREATE OR REPLACE FUNCTION api_private.guard_semester_scene_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.teaching_projects p WHERE p.id=new.teaching_project_id
  AND p.stage NOT IN ('completed','archived')
  AND api_private.profile_status()='active'
  AND public.context_space_mutable(p.id,new.village_id,new.space_id)
  AND (new.scope_kind='admin_sandbox' OR new.scope_kind='group'
   AND p.formal_village_id=new.village_id AND public.project_group_eligible(new.group_id,p.id)))
 THEN RAISE EXCEPTION 'SCENE_EDIT_FORBIDDEN'; END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS guard_semester_scene_project ON public.scene_edit_projects;
CREATE TRIGGER guard_semester_scene_project BEFORE INSERT OR UPDATE ON public.scene_edit_projects
FOR EACH ROW EXECUTE FUNCTION api_private.guard_semester_scene_project();

CREATE OR REPLACE FUNCTION api_private.guard_semester_scene_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.scene_edit_projects s JOIN public.teaching_projects p ON p.id=s.teaching_project_id
  WHERE s.id=new.project_id AND p.stage NOT IN ('completed','archived')
   AND api_private.profile_status()='active' AND public.context_space_mutable(p.id,s.village_id,s.space_id))
 THEN RAISE EXCEPTION 'SCENE_EDIT_FORBIDDEN'; END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS guard_semester_scene_version ON public.scene_edit_versions;
CREATE TRIGGER guard_semester_scene_version BEFORE INSERT OR UPDATE ON public.scene_edit_versions
FOR EACH ROW EXECUTE FUNCTION api_private.guard_semester_scene_version();

CREATE OR REPLACE FUNCTION api_private.semester_project(p jsonb,writing boolean DEFAULT false)
RETURNS public.teaching_projects LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE result public.teaching_projects;
BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p->>'teachingProjectId' IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 SELECT * INTO result FROM public.teaching_projects WHERE id=(p->>'teachingProjectId')::uuid;
 IF NOT FOUND OR p ? 'courseId' AND p->>'courseId' IS DISTINCT FROM result.course_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF result.stage IN ('completed','archived') AND (writing OR NOT api_private.staff()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api_private.semester_catalog_read(a text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE project public.teaching_projects; result jsonb; member public.group_memberships;
BEGIN
 project:=api_private.semester_project(p);
 IF a='catalog.listGroups' THEN
  SELECT coalesce(jsonb_agg(CASE WHEN api_private.staff() OR public.semester_group_member(project.id,g.id)
    THEN to_jsonb(g) ELSE to_jsonb(g)-'join_code' END ORDER BY g.scope_kind,g.created_at),'[]') INTO result
  FROM public.course_groups g WHERE public.project_group_eligible(g.id,project.id);
 ELSIF a='catalog.groupRoster' THEN
  IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT jsonb_build_object('memberships',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM public.group_memberships m
    WHERE public.project_group_eligible(m.group_id,project.id)),'[]'),
   'progress',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.task_progress t WHERE t.teaching_project_id=project.id),'[]')) INTO result;
 ELSIF a='catalog.getProgress' THEN
  SELECT jsonb_build_object('completedTaskIds',coalesce(jsonb_agg(task_id) FILTER(WHERE completed),'[]')) INTO result
  FROM public.task_progress WHERE teaching_project_id=project.id AND student_key=api_private.student_key();
 ELSIF a='catalog.getCourseContext' THEN
  SELECT * INTO member FROM public.group_memberships m WHERE m.student_key=api_private.student_key()
   AND public.project_group_eligible(m.group_id,project.id) ORDER BY (m.scope_kind='semester') DESC LIMIT 1;
  SELECT jsonb_build_object('course',to_jsonb(c),'teachingProjectId',project.id,'project',to_jsonb(project),
   'membership',CASE WHEN member.group_id IS NOT NULL THEN to_jsonb(member) ELSE NULL END,
   'group',(SELECT to_jsonb(g)||jsonb_build_object('space_id',s.id,'base_snapshot_id',s.base_snapshot_id)
     FROM public.course_groups g LEFT JOIN public.planning_spaces s ON s.group_id=g.id
      AND s.teaching_project_id=project.id AND s.village_id=project.formal_village_id AND s.space_type='group_plan'
     WHERE g.id=member.group_id),
   'progress',api_private.semester_catalog_read('catalog.getProgress',p)) INTO result
  FROM public.courses c WHERE c.id=project.course_id;
 ELSIF a='catalog.listActivity' THEN
  IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') INTO result FROM (SELECT * FROM public.activity_events
   WHERE teaching_project_id=project.id ORDER BY occurred_at DESC LIMIT least(coalesce((p->>'limit')::integer,100),200))e;
 ELSE RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api_private.semester_catalog_write(a text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE project public.teaching_projects; g public.course_groups; member public.group_memberships;
 profile public.profiles; result jsonb; receipt api_private.operation_receipts; rid uuid:=(p->>'requestId')::uuid; code text;
BEGIN
 project:=api_private.semester_project(p,true);
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF rid IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||rid::text,0));
 SELECT * INTO receipt FROM api_private.operation_receipts WHERE actor_id=auth.uid() AND request_id=rid;
 IF FOUND THEN
  IF receipt.action<>a OR receipt.input<>p THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  RETURN receipt.result;
 END IF;
 IF a='catalog.createGroup' THEN
  IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT project.formal_project_open OR NOT EXISTS(SELECT 1 FROM public.villages
   WHERE id=project.formal_village_id AND status='published' AND NOT is_practice) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  code:=upper(nullif(btrim(p->>'code'),''));
  IF code='332' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF code IS NULL THEN code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)); END IF;
  IF code!~'^[A-Z0-9_-]{3,32}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO public.course_groups(id,course_id,name,join_code,created_by,scope_kind,teaching_project_id,formal_village_id)
  VALUES(gen_random_uuid()::text,project.course_id,btrim(p->>'name'),code,profile.display_name,'semester',project.id,project.formal_village_id)
  RETURNING * INTO g;
  result:=to_jsonb(g);
 ELSIF a='catalog.joinGroup' THEN
  SELECT * INTO g FROM public.course_groups WHERE join_code=upper(btrim(p->>'code')) FOR UPDATE;
  IF NOT FOUND OR g.locked OR NOT public.project_group_eligible(g.id,project.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||project.id::text,0));
  SELECT * INTO member FROM public.group_memberships m WHERE m.student_key=api_private.student_key()
   AND public.project_group_eligible(m.group_id,project.id) LIMIT 1;
  IF FOUND AND member.group_id<>g.id THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  IF member.group_id IS NULL THEN
   INSERT INTO public.group_memberships(course_id,group_id,student_key,student_name,student_id)
   VALUES(g.course_id,g.id,api_private.student_key(),profile.display_name,profile.student_id) RETURNING * INTO member;
  END IF;
  result:=to_jsonb(member);
 ELSIF a='catalog.lockGroup' THEN
  IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO g FROM public.course_groups WHERE id=p->>'groupId' FOR UPDATE;
  IF NOT FOUND OR NOT public.project_group_eligible(g.id,project.id)
   OR g.scope_kind='lab' AND profile.role<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.course_groups SET locked=(p->>'locked')::boolean,updated_at=now() WHERE id=g.id RETURNING to_jsonb(course_groups) INTO result;
 ELSIF a='catalog.setProgress' THEN
  SELECT * INTO member FROM public.group_memberships m WHERE m.student_key=api_private.student_key()
   AND public.project_group_eligible(m.group_id,project.id) ORDER BY (m.scope_kind='semester') DESC LIMIT 1;
  INSERT INTO public.task_progress(course_id,teaching_project_id,student_key,group_id,task_id,completed,completed_at)
  VALUES(project.course_id,project.id,api_private.student_key(),member.group_id,p->>'taskId',(p->>'complete')::boolean,
   CASE WHEN (p->>'complete')::boolean THEN now() END)
  ON CONFLICT(teaching_project_id,student_key,task_id) DO UPDATE SET group_id=excluded.group_id,
   completed=excluded.completed,completed_at=excluded.completed_at,updated_at=now() RETURNING to_jsonb(task_progress) INTO result;
 ELSIF a='catalog.recordActivity' THEN
  PERFORM api_private.assert_context(p);
  SELECT * INTO member FROM public.group_memberships m WHERE m.student_key=api_private.student_key()
   AND public.project_group_eligible(m.group_id,project.id) ORDER BY (m.scope_kind='semester') DESC LIMIT 1;
  INSERT INTO public.activity_events(event_id,client_event_id,student_key,student_name,course_id,group_id,task_id,
   space_id,teaching_project_id,village_id,action,target_type,target_id,view_mode,metadata)
  VALUES(rid::text,rid::text,api_private.student_key(),profile.display_name,project.course_id,member.group_id,p->>'taskId',
   p->>'spaceId',project.id,(p->>'villageId')::uuid,p->>'action',p->>'targetType',p->>'targetId',p->>'viewMode',coalesce(p->'metadata','{}'))
  RETURNING to_jsonb(activity_events) INTO result;
 ELSE RAISE EXCEPTION 'NOT_FOUND'; END IF;
 INSERT INTO api_private.operation_receipts VALUES(auth.uid(),rid,a,p,coalesce(result,'null'),now());
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION api_private.stamp_semester_membership(),api_private.guard_semester_group_plan(),
 api_private.guard_semester_scene_project(),api_private.guard_semester_scene_version(),
 api_private.semester_project(jsonb,boolean),api_private.semester_catalog_read(text,jsonb),api_private.semester_catalog_write(text,jsonb)
FROM PUBLIC,anon,authenticated,village_unified_login;
