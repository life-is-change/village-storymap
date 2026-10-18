-- Independent C2a database only; never apply to Supabase or older candidates.
DO $guard$ BEGIN
 IF current_database()<>'village_scene_files_validation' THEN RAISE EXCEPTION 'WRONG_CANDIDATE_DATABASE';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_scene_files_login') THEN RAISE EXCEPTION 'FILES_ROLE_ALREADY_EXISTS';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'UNSAFE_AUTHENTICATED_ROLE';END IF;
END $guard$;
REVOKE CONNECT ON DATABASE village_scene_files_validation FROM PUBLIC;
CREATE ROLE village_scene_files_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
GRANT authenticated TO village_scene_files_login WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE village_scene_files_validation TO village_scene_files_login;
CREATE SCHEMA scene_files;
REVOKE ALL ON SCHEMA scene_files FROM PUBLIC;
GRANT USAGE ON SCHEMA scene_files TO authenticated,village_scene_files_login;
CREATE TABLE scene_files.sessions(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 request_digest text NOT NULL,spec jsonb NOT NULL,state text NOT NULL CHECK(state IN('pending','ready','committed','aborted')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 commit_digest text,result jsonb,UNIQUE(user_id,request_id)
);
CREATE TABLE scene_files.files(
 id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES scene_files.sessions(id),role text NOT NULL,
 size bigint NOT NULL CHECK(size>0 AND size<=52428800),mime text NOT NULL,extension text NOT NULL,
 logical_path text NOT NULL UNIQUE,state text NOT NULL CHECK(state IN('pending','uploading','ready','deleted')),
 sha256 text CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),UNIQUE(session_id,role)
);
ALTER TABLE scene_files.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scene_files.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_sessions ON scene_files.sessions FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY own_files ON scene_files.files FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM scene_files.sessions s WHERE s.id=session_id AND s.user_id=auth.uid()));
GRANT SELECT ON scene_files.sessions,scene_files.files TO authenticated;

CREATE FUNCTION scene_files.lock_session(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE s scene_files.sessions;BEGIN
 SELECT * INTO s FROM scene_files.sessions WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
 RETURN to_jsonb(s)||jsonb_build_object('files',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY role),'[]'::jsonb) FROM scene_files.files f WHERE session_id=s.id));
END;$$;
CREATE FUNCTION scene_files.pending_budget() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
 PERFORM pg_advisory_xact_lock(183627,1);
 RETURN (SELECT jsonb_build_object('global',count(*),'own',count(*) FILTER(WHERE user_id=auth.uid()),'bytes',coalesce(sum((SELECT sum(size) FROM scene_files.files f WHERE f.session_id=s.id)),0)) FROM scene_files.sessions s WHERE state IN('pending','ready'));
END;$$;
CREATE FUNCTION scene_files.new_session(p_id uuid,p_request uuid,p_digest text,p_spec jsonb,p_files jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE old scene_files.sessions;f jsonb;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
 PERFORM pg_advisory_xact_lock(183627,1);
 SELECT * INTO old FROM scene_files.sessions WHERE user_id=auth.uid() AND request_id=p_request FOR UPDATE;
 IF FOUND THEN IF old.request_digest<>p_digest THEN RAISE EXCEPTION 'FILES_CONFLICT';END IF;RETURN scene_files.lock_session(old.id);END IF;
 INSERT INTO scene_files.sessions(id,user_id,request_id,request_digest,spec,state) VALUES(p_id,auth.uid(),p_request,p_digest,p_spec,'pending');
 FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
 INSERT INTO scene_files.files(id,session_id,role,size,mime,extension,logical_path,state)
 VALUES((f->>'id')::uuid,p_id,f->>'role',(f->>'size')::bigint,f->>'mime',f->>'extension',f->>'logical_path','pending');END LOOP;
 RETURN scene_files.lock_session(p_id);
END;$$;
CREATE FUNCTION scene_files.claim_file(p_id uuid,p_role text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE s jsonb;f scene_files.files;BEGIN
 s:=scene_files.lock_session(p_id);
 -- Committed sessions only compare immutable ready bytes on replay; the 24h
 -- expiry applies to unfinished uploads, never grants another write/registration.
 IF s->>'state'='aborted' OR s->>'state'<>'committed' AND (s->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'FILES_EXPIRED';END IF;
 SELECT * INTO f FROM scene_files.files WHERE session_id=p_id AND role=p_role FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
 IF f.state='ready' THEN RETURN to_jsonb(f);END IF;
 IF f.state<>'pending' OR s->>'state'<>'pending' THEN RAISE EXCEPTION 'FILES_CONFLICT';END IF;
 UPDATE scene_files.files SET state='uploading' WHERE id=f.id;RETURN to_jsonb(f)||'{"state":"uploading"}'::jsonb;
END;$$;
CREATE FUNCTION scene_files.finish_file(p_id uuid,p_file uuid,p_sha text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE s jsonb;BEGIN
 s:=scene_files.lock_session(p_id);
 IF s->>'state'<>'pending' OR (s->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'FILES_EXPIRED';END IF;
 UPDATE scene_files.files SET sha256=p_sha,state='ready' WHERE id=p_file AND session_id=p_id AND state='uploading';
 IF NOT FOUND THEN RAISE EXCEPTION 'FILES_CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM scene_files.files WHERE session_id=p_id AND state<>'ready') THEN UPDATE scene_files.sessions SET state='ready' WHERE id=p_id;END IF;
END;$$;
CREATE FUNCTION scene_files.fail_file(p_id uuid,p_file uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
BEGIN PERFORM scene_files.lock_session(p_id);UPDATE scene_files.sessions SET state='aborted' WHERE id=p_id AND state<>'committed';END;$$;
CREATE FUNCTION scene_files.complete_session(p_id uuid,p_digest text,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE s jsonb;BEGIN
 s:=scene_files.lock_session(p_id);
 IF s->>'state'<>'ready' OR (s->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'FILES_EXPIRED';END IF;
 UPDATE scene_files.sessions SET state='committed',commit_digest=p_digest,result=p_result WHERE id=p_id;
END;$$;
CREATE FUNCTION scene_files.authorize_file(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
 SELECT to_jsonb(f) FROM scene_files.files f JOIN scene_files.sessions s ON s.id=f.session_id
 WHERE f.id=p_id AND f.state='ready' AND s.state='committed' AND auth.uid() IS NOT NULL AND (
 EXISTS(SELECT 1 FROM public.scene_edit_assets a WHERE (a.storage_path=f.logical_path OR a.metadata->>'originalStoragePath'=f.logical_path OR a.metadata->>'lowStoragePath'=f.logical_path OR a.metadata->>'lowOriginalStoragePath'=f.logical_path OR a.metadata->>'topViewPath'=f.logical_path) AND public.can_read_scene_edit_asset(a.scope_kind,a.course_id,a.group_id,a.owner_id))
 OR EXISTS(SELECT 1 FROM public.scene_edit_versions v WHERE v.preview_path=f.logical_path AND public.can_read_scene_edit_project(v.project_id))
 OR EXISTS(SELECT 1 FROM public.scene_edit_components c WHERE c.preview_path=f.logical_path AND public.can_read_scene_edit_asset(c.scope_kind,c.course_id,c.group_id,c.owner_id)))
$$;
CREATE FUNCTION scene_files.cleanup_candidates(p_execute boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE ids uuid[];BEGIN
 PERFORM pg_advisory_xact_lock(183627,1);
 SELECT array_agg(id) INTO ids FROM (SELECT id FROM scene_files.sessions WHERE state<>'committed' AND expires_at<now() ORDER BY id FOR UPDATE SKIP LOCKED) s;
 IF p_execute THEN UPDATE scene_files.sessions SET state='aborted' WHERE id=ANY(ids);END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'size',size)),'[]'::jsonb) FROM scene_files.files f WHERE session_id=ANY(ids) AND state<>'deleted'
 AND NOT EXISTS(SELECT 1 FROM public.scene_edit_assets a WHERE a.storage_path=f.logical_path OR a.metadata->>'originalStoragePath'=f.logical_path OR a.metadata->>'lowStoragePath'=f.logical_path OR a.metadata->>'lowOriginalStoragePath'=f.logical_path OR a.metadata->>'topViewPath'=f.logical_path)
 AND NOT EXISTS(SELECT 1 FROM public.scene_edit_versions v WHERE v.preview_path=f.logical_path)
 AND NOT EXISTS(SELECT 1 FROM public.scene_edit_components c WHERE c.preview_path=f.logical_path));
END;$$;
CREATE FUNCTION scene_files.cleanup_done(p_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
 UPDATE scene_files.files f SET state='deleted' WHERE id=p_id AND EXISTS(SELECT 1 FROM scene_files.sessions s WHERE s.id=f.session_id AND s.state='aborted')
$$;
CREATE FUNCTION scene_files.resolve_path(p_path text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
 SELECT scene_files.authorize_file(id) FROM scene_files.files WHERE logical_path=p_path
$$;
CREATE FUNCTION scene_files.project_scope(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
 SELECT jsonb_build_object('scopeKind',p.scope_kind,'courseId',t.course_id,'groupId',p.group_id,'ownerId',p.created_by)
 FROM public.scene_edit_projects p JOIN public.teaching_projects t ON t.id=p.teaching_project_id
 WHERE p.id=p_id AND public.can_read_scene_edit_project(p.id)
$$;
CREATE FUNCTION scene_files.lock_project(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
BEGIN
 IF NOT public.can_read_scene_edit_project(p_id) THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
 PERFORM id FROM public.scene_edit_projects WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
END;$$;
CREATE FUNCTION scene_files.lock_assets(p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE ids uuid[];BEGIN
 SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.scene_edit_assets WHERE id=ANY(p_ids) AND public.can_read_scene_edit_asset(scope_kind,course_id,group_id,owner_id) ORDER BY id FOR UPDATE) a;
 IF coalesce(cardinality(ids),0)<>coalesce(cardinality(p_ids),0) THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.scene_edit_assets a WHERE id=ANY(ids));
END;$$;
CREATE FUNCTION scene_files.lock_component(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
DECLARE c public.scene_edit_components;BEGIN
 SELECT * INTO c FROM public.scene_edit_components WHERE id=p_id AND public.can_read_scene_edit_asset(scope_kind,course_id,group_id,owner_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILES_FORBIDDEN';END IF;RETURN to_jsonb(c);
END;$$;
CREATE FUNCTION scene_files.startup_files() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=scene_files,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'size',f.size,'sha256',f.sha256)),'[]'::jsonb) FROM scene_files.files f JOIN scene_files.sessions s ON s.id=f.session_id WHERE s.state='committed' AND f.state='ready'
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA scene_files FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION scene_files.lock_session(uuid),scene_files.pending_budget(),scene_files.new_session(uuid,uuid,text,jsonb,jsonb),scene_files.claim_file(uuid,text),scene_files.finish_file(uuid,uuid,text),scene_files.fail_file(uuid,uuid),scene_files.complete_session(uuid,text,jsonb),scene_files.authorize_file(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION scene_files.resolve_path(text),scene_files.project_scope(uuid),scene_files.lock_project(uuid),scene_files.lock_assets(uuid[]),scene_files.lock_component(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION scene_files.cleanup_candidates(boolean),scene_files.cleanup_done(uuid),scene_files.startup_files() TO village_scene_files_login;
