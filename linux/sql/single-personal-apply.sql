-- Only invoked by an explicit result-version selection, never on login.
CREATE FUNCTION api_private.apply_personal_selection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE source public.course_personal_spaces;target public.planning_spaces;version public.personal_layer_versions;BEGIN
 SELECT * INTO source FROM public.course_personal_spaces WHERE id=NEW.space_id;
 IF source.experience_space_id IS NULL THEN RETURN NEW;END IF;
 IF auth.uid() IS DISTINCT FROM source.owner_id OR api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO target FROM public.planning_spaces WHERE id=source.experience_space_id
  AND owner_id=source.owner_id AND teaching_project_id=source.teaching_project_id
  AND (village_id::text=source.village_id OR source.village_id='mibu' AND village_id=(SELECT practice_village_id FROM public.teaching_projects WHERE id=source.teaching_project_id))
  AND space_type=source.context_space_type AND space_type IN ('practice_personal','formal_personal') FOR UPDATE;
 IF NOT FOUND OR NOT public.context_space_mutable(target.teaching_project_id,target.village_id,target.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO version FROM public.personal_layer_versions WHERE id=NEW.current_version_id AND space_id=source.id AND layer_key=NEW.layer_key;
 IF NOT FOUND OR version.layer_key NOT IN ('building','road','water','contours') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 -- Duplicate requests must not overwrite edits made after this version was applied.
 IF target.applied_result_versions->>version.layer_key=version.id::text THEN RETURN NEW;END IF;
 -- Lease RPCs take ROW EXCLUSIVE on this table. Wait for their uncommitted
 -- rows and exclude new acquisitions until this atomic application commits.
 LOCK TABLE public.feature_edit_locks IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.feature_edit_locks WHERE teaching_project_id=target.teaching_project_id AND village_id=target.village_id
  AND space_id=target.id AND layer_key=version.layer_key AND expires_at>now()) THEN RAISE EXCEPTION 'PERSONAL_EDITS_BUSY';END IF;
 IF version.feature_count<>(SELECT count(1) FROM public.personal_layer_features WHERE layer_version_id=version.id AND NOT is_deleted) THEN RAISE EXCEPTION 'RESULT_NOT_COMPLETE';END IF;
 DELETE FROM public.planning_features WHERE space_id=target.id AND teaching_project_id=target.teaching_project_id AND village_id=target.village_id AND layer_key=version.layer_key;
 INSERT INTO public.planning_features(space_id,teaching_project_id,village_id,layer_key,object_code,object_name,geom,props,feature_revision)
 SELECT target.id,target.teaching_project_id,target.village_id,version.layer_key,
  version.layer_key||'-R-'||replace(version.id::text,'-','')||'-'||md5(f.object_code),f.object_name,f.geom,
  f.props||jsonb_build_object('__sourceObjectCode',f.object_code,'__resultVersion',version.id),1
 FROM public.personal_layer_features f WHERE f.layer_version_id=version.id AND NOT f.is_deleted;
 UPDATE public.planning_spaces SET applied_result_versions=applied_result_versions||jsonb_build_object(version.layer_key,version.id) WHERE id=target.id;
 RETURN NEW;
END$$;
