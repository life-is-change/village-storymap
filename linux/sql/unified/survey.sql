-- Candidate-only collaboration boundary; apply after catalog.sql.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;
ALTER TABLE public.object_comments ADD COLUMN IF NOT EXISTS local_actor_id uuid REFERENCES public.profiles(id),ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.object_photos ADD COLUMN IF NOT EXISTS local_actor_id uuid REFERENCES public.profiles(id),ADD COLUMN IF NOT EXISTS file_id uuid,ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.community_tasks ADD COLUMN IF NOT EXISTS local_actor_id uuid REFERENCES public.profiles(id),ADD COLUMN IF NOT EXISTS local_revision bigint NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE api_private.comment_likes(comment_id bigint NOT NULL REFERENCES public.object_comments(id),actor_id uuid NOT NULL REFERENCES public.profiles(id),PRIMARY KEY(comment_id,actor_id));
CREATE TABLE api_private.comment_replies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),comment_id bigint NOT NULL REFERENCES public.object_comments(id),actor_id uuid REFERENCES public.profiles(id),author_snapshot text,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 200),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE api_private.object_reactions(teaching_project_id uuid,village_id uuid,space_id text,object_code text,object_type text,actor_id uuid NOT NULL REFERENCES public.profiles(id),reaction text NOT NULL CHECK(reaction IN ('like','dislike')),PRIMARY KEY(teaching_project_id,village_id,space_id,object_code,object_type,actor_id));
CREATE TABLE api_private.community_history(issue_id bigint NOT NULL REFERENCES public.community_tasks(id),revision bigint NOT NULL,payload jsonb NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(issue_id,revision));
CREATE TABLE api_private.message_replies(id text DEFAULT gen_random_uuid()::text,issue_id bigint NOT NULL REFERENCES public.community_tasks(id),actor_id uuid,author_snapshot text,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 200),deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(issue_id,id));
CREATE TABLE api_private.message_likes(issue_id bigint NOT NULL REFERENCES public.community_tasks(id),actor_id uuid NOT NULL,reply_id text NOT NULL DEFAULT '',PRIMARY KEY(issue_id,actor_id,reply_id));
CREATE TABLE api_private.local_points(actor_id uuid NOT NULL,issue_id bigint NOT NULL,reason text NOT NULL,delta integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,issue_id,reason));
CREATE TABLE api_private.legacy_likes(kind text,object_id bigint,reply_id text,name text,PRIMARY KEY(kind,object_id,reply_id,name));
CREATE TABLE api_private.legacy_statistics(actor_id uuid PRIMARY KEY,total_points bigint NOT NULL,reports_count bigint NOT NULL,verify_count bigint NOT NULL,snapshot_day date NOT NULL,positive_today bigint NOT NULL);
INSERT INTO api_private.legacy_statistics
 SELECT names.user_id,coalesce(sum(stats.total_points),0),coalesce(sum(stats.reports_count),0),coalesce(sum(stats.verify_count),0),(now() AT TIME ZONE 'Asia/Shanghai')::date,
 coalesce((SELECT sum(greatest(ledger.delta,0)) FROM public.points_ledger ledger WHERE ledger.user_name IN (SELECT split_part(a.student_key,'::',2) FROM api_private.profile_key_aliases a WHERE a.user_id=names.user_id AND NOT EXISTS(SELECT 1 FROM api_private.profile_key_aliases x WHERE split_part(x.student_key,'::',2)=split_part(a.student_key,'::',2) AND x.user_id<>a.user_id)) AND ledger.created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'),0)
 FROM (SELECT split_part(student_key,'::',2) name,min(user_id::text)::uuid user_id FROM api_private.profile_key_aliases GROUP BY split_part(student_key,'::',2) HAVING count(DISTINCT user_id)=1)names JOIN public.user_stats stats ON stats.user_name=names.name GROUP BY names.user_id;
CREATE FUNCTION api_private.begin_operation(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE r api_private.operation_receipts;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 IF p->>'requestId' IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||(p->>'requestId'),0));
 SELECT * INTO r FROM api_private.operation_receipts WHERE actor_id=auth.uid() AND request_id=(p->>'requestId')::uuid;
 IF FOUND THEN IF r.action<>a OR r.input<>p THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;RETURN jsonb_build_object('result',r.result);END IF;RETURN NULL;
END$$;
CREATE FUNCTION api_private.finish_operation(a text,p jsonb,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,auth,pg_temp AS $$BEGIN
 INSERT INTO api_private.operation_receipts VALUES(auth.uid(),(p->>'requestId')::uuid,a,p,coalesce(result,'null'),now());RETURN result;
END$$;
CREATE FUNCTION api_private.survey_gate(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE layer text;kind text;BEGIN
 PERFORM api_private.assert_context(p);
 SELECT space_type INTO kind FROM public.planning_spaces WHERE id=p->>'spaceId';
 IF NOT api_private.context_mutable((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 layer:=CASE WHEN p->>'objectType' ~ '^building(_3d)?(__.*)?$' THEN 'building' WHEN p->>'objectType' ~ '^road(__.*)?$' THEN 'road' WHEN p->>'objectType' ~ '^water(__.*)?$' THEN 'water' ELSE coalesce(p->>'surveyLayerKey',p->>'targetLayerKey') END;
 IF kind='formal_shared' AND layer IN ('building','road','water') THEN
 PERFORM 1 FROM public.survey_feature_reviews WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND layer_key=layer AND object_code=coalesce(p->>'objectCode',p->>'targetObjectCode') AND geometry_status IN ('confirmed_unchanged','modified','added') AND NOT is_deleted FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;END IF;
END$$;
CREATE FUNCTION api_private.comment_interactions(cid bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
 SELECT jsonb_build_object('likes',coalesce((SELECT jsonb_agg(name ORDER BY name) FROM (SELECT p.display_name name FROM api_private.comment_likes l JOIN public.profiles p ON p.id=l.actor_id WHERE l.comment_id=cid UNION SELECT name FROM api_private.legacy_likes WHERE kind='comment' AND object_id=cid)likes),'[]'),'replies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'author',coalesce(p.display_name,r.author_snapshot),'content',r.body,'created_at',r.created_at) ORDER BY r.created_at) FROM api_private.comment_replies r LEFT JOIN public.profiles p ON p.id=r.actor_id WHERE r.comment_id=cid),'[]'))
$$;
CREATE FUNCTION api_private.survey_read(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE result jsonb;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;PERFORM api_private.assert_context(p);
 CASE a
 WHEN 'survey.activity' THEN
 SELECT jsonb_build_array(
 coalesce((SELECT jsonb_agg(jsonb_build_object('survey_layer_key',survey_layer_key,'object_type',object_type,'object_code',object_code)) FROM public.object_attribute_edits WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId'),'[]'),
 coalesce((SELECT jsonb_agg(jsonb_build_object('survey_layer_key',survey_layer_key,'object_type',object_type,'object_code',object_code)) FROM public.object_photos WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND deleted_at IS NULL),'[]'),
 coalesce((SELECT jsonb_agg(jsonb_build_object('survey_layer_key',survey_layer_key,'object_type',object_type,'object_code',object_code)) FROM public.object_comments WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND deleted_at IS NULL),'[]'),
 coalesce((SELECT jsonb_agg(jsonb_build_object('target_layer_key',target_layer_key,'target_object_code',target_object_code,'status',status)) FROM public.community_tasks WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND deleted_at IS NULL),'[]')) INTO result;
 WHEN 'survey.listAttributes' THEN SELECT coalesce(jsonb_agg(jsonb_build_object('object_code',x.object_code,'data',x.data)),'[]') INTO result FROM (SELECT e.object_code,e.data FROM public.object_attribute_edits e WHERE e.teaching_project_id=(p->>'teachingProjectId')::uuid AND e.village_id=(p->>'villageId')::uuid AND e.space_id=p->>'spaceId' AND e.object_type=p->>'objectType' ORDER BY e.object_code LIMIT 1000)x;
 WHEN 'survey.getAttributes' THEN SELECT e.data INTO result FROM public.object_attribute_edits e WHERE e.teaching_project_id=(p->>'teachingProjectId')::uuid AND e.village_id=(p->>'villageId')::uuid AND e.space_id=p->>'spaceId' AND e.object_code=p->>'objectCode' AND e.object_type=p->>'objectType';
 WHEN 'survey.listComments' THEN SELECT coalesce(jsonb_agg(to_jsonb(c)-'local_actor_id'||jsonb_build_object('interaction',api_private.comment_interactions(c.id)) ORDER BY c.created_at DESC),'[]') INTO result FROM public.object_comments c WHERE c.teaching_project_id=(p->>'teachingProjectId')::uuid AND c.village_id=(p->>'villageId')::uuid AND c.space_id=p->>'spaceId' AND c.object_code=p->>'objectCode' AND c.object_type=p->>'objectType' AND c.deleted_at IS NULL;
 WHEN 'survey.listPhotos' THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'object_code',x.object_code,'object_type',x.object_type,'fileId',x.file_id,'uploaded_by',x.uploaded_by,'uploaded_at',coalesce((to_jsonb(x)->>'uploaded_at')::timestamptz,(to_jsonb(x)->>'created_at')::timestamptz)) ORDER BY coalesce((to_jsonb(x)->>'uploaded_at')::timestamptz,(to_jsonb(x)->>'created_at')::timestamptz) DESC),'[]') INTO result FROM public.object_photos x WHERE x.teaching_project_id=(p->>'teachingProjectId')::uuid AND x.village_id=(p->>'villageId')::uuid AND x.space_id=p->>'spaceId' AND x.object_code=p->>'objectCode' AND x.object_type=p->>'objectType' AND x.deleted_at IS NULL;
 WHEN 'survey.listReviews' THEN SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.layer_key,r.object_code),'[]') INTO result FROM public.survey_feature_reviews r WHERE r.teaching_project_id=(p->>'teachingProjectId')::uuid AND r.village_id=(p->>'villageId')::uuid AND r.space_id=p->>'spaceId';
 WHEN 'survey.getReview' THEN SELECT to_jsonb(r) INTO result FROM public.survey_feature_reviews r WHERE r.teaching_project_id=(p->>'teachingProjectId')::uuid AND r.village_id=(p->>'villageId')::uuid AND r.space_id=p->>'spaceId' AND r.layer_key=p->>'layerKey' AND r.object_code=p->>'objectCode';
 WHEN 'survey.dashboard' THEN IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;result:=public.get_shared_survey_dashboard((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId');
 WHEN 'survey.listFeatures' THEN IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;result:=public.list_shared_survey_features((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'layerKey',p->>'geometryStatus',(p->>'actorId')::uuid);
 WHEN 'survey.history' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM (SELECT id,action,created_at,created_by,created_by_user_id FROM public.feature_versions WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND layer_key=p->>'layerKey' AND object_code=p->>'objectCode' ORDER BY created_at DESC LIMIT 200)v;
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;RETURN result;
END$$;
CREATE FUNCTION api_private.survey_write(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE result jsonb;prior jsonb;comment public.object_comments;photo public.object_photos;actor text;BEGIN
 prior:=api_private.begin_operation(a,p);IF prior IS NOT NULL THEN RETURN prior->'result';END IF;
 SELECT display_name INTO actor FROM public.profiles WHERE id=auth.uid();
 IF a IN ('survey.editComment','survey.deleteComment','survey.likeComment','survey.replyComment') THEN
  SELECT * INTO comment FROM public.object_comments WHERE id=(p->>'commentId')::bigint AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF p ? 'spaceId' AND (p->>'spaceId'<>comment.space_id OR (p->>'villageId')::uuid<>comment.village_id OR (p->>'teachingProjectId')::uuid<>comment.teaching_project_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  PERFORM api_private.survey_gate(jsonb_build_object('teachingProjectId',comment.teaching_project_id,'villageId',comment.village_id,'spaceId',comment.space_id,'objectType',comment.object_type,'objectCode',comment.object_code,'surveyLayerKey',comment.survey_layer_key));
  IF a IN ('survey.editComment','survey.deleteComment') AND comment.local_actor_id IS DISTINCT FROM auth.uid() AND NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSIF a='survey.deletePhoto' THEN
  SELECT * INTO photo FROM public.object_photos WHERE id=(p->>'photoId')::bigint AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  PERFORM api_private.assert_context(jsonb_build_object('teachingProjectId',photo.teaching_project_id,'villageId',photo.village_id,'spaceId',photo.space_id));
  IF photo.local_actor_id IS DISTINCT FROM auth.uid() AND NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSE PERFORM api_private.assert_context(p);END IF;
 CASE a
 WHEN 'survey.saveAttributes' THEN
  IF p->>'objectType' IN ('object_comment_interactions','space_lock','message_replies','message_likes') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;PERFORM api_private.survey_gate(p);
  INSERT INTO public.object_attribute_edits(object_code,object_type,data,teaching_project_id,village_id,space_id,survey_layer_key,updated_at) VALUES(p->>'objectCode',p->>'objectType',p->'data',(p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'surveyLayerKey',now()) ON CONFLICT(teaching_project_id,village_id,space_id,object_code,object_type) DO UPDATE SET data=excluded.data,survey_layer_key=excluded.survey_layer_key,updated_at=now();result:=p->'data';
 WHEN 'survey.addComment' THEN PERFORM api_private.survey_gate(p);
  INSERT INTO public.object_comments(object_code,object_type,author_name,content,teaching_project_id,village_id,space_id,survey_layer_key,local_actor_id) VALUES(p->>'objectCode',p->>'objectType',actor,p->>'body',(p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'surveyLayerKey',auth.uid()) RETURNING to_jsonb(object_comments)-'local_actor_id' INTO result;
 WHEN 'survey.editComment' THEN UPDATE public.object_comments SET content=p->>'body' WHERE id=comment.id RETURNING to_jsonb(object_comments)-'local_actor_id' INTO result;
 WHEN 'survey.deleteComment' THEN UPDATE public.object_comments SET deleted_at=now() WHERE id=comment.id;result:=jsonb_build_object('deleted',true);
 WHEN 'survey.likeComment' THEN DELETE FROM api_private.comment_likes WHERE comment_id=comment.id AND actor_id=auth.uid();IF NOT FOUND THEN INSERT INTO api_private.comment_likes VALUES(comment.id,auth.uid());END IF;result:=api_private.comment_interactions(comment.id);
 WHEN 'survey.replyComment' THEN INSERT INTO api_private.comment_replies(comment_id,actor_id,body) VALUES(comment.id,auth.uid(),p->>'body');result:=api_private.comment_interactions(comment.id);
 WHEN 'survey.react' THEN PERFORM api_private.survey_gate(p);DELETE FROM api_private.object_reactions WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND object_code=p->>'objectCode' AND object_type=p->>'objectType' AND actor_id=auth.uid();IF p->>'reaction'<>'none' THEN INSERT INTO api_private.object_reactions VALUES((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'objectCode',p->>'objectType',auth.uid(),p->>'reaction');END IF;result:=jsonb_build_object('reaction',p->>'reaction');
 WHEN 'survey.deletePhoto' THEN UPDATE public.object_photos SET deleted_at=now() WHERE id=photo.id;result:=jsonb_build_object('deleted',true,'fileId',photo.file_id,'retainedForHistory',true);
 WHEN 'survey.initializeReviews' THEN result:=public.initialize_shared_survey_reviews((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',(p->>'datasetId')::uuid,p->'items');
 WHEN 'survey.confirmGeometry' THEN result:=public.confirm_survey_feature_geometry((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'layerKey',p->>'objectCode',(p->>'revision')::bigint,(p->>'lockToken')::uuid);
 WHEN 'survey.restoreVersion' THEN IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;result:=public.restore_survey_feature_version((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'layerKey',p->>'objectCode',(p->>'versionId')::uuid,(p->>'revision')::bigint);
 WHEN 'survey.freezeSnapshot' THEN IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;result:=public.freeze_shared_survey_snapshot((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'label',coalesce(p->>'description',''),coalesce((p->>'recommendedForGroups')::boolean,false));
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;RETURN api_private.finish_operation(a,p,result);
END$$;

CREATE FUNCTION api_private.community_read(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE result jsonb; issue public.community_tasks;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;PERFORM api_private.assert_context(p);
 IF p ? 'id' THEN SELECT * INTO issue FROM public.community_tasks WHERE id=(p->>'id')::bigint AND teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND deleted_at IS NULL;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;END IF;
 CASE a
 WHEN 'community.listTasks','community.listMessages' THEN SELECT coalesce(jsonb_agg(to_jsonb(t)-'local_actor_id'||jsonb_build_object('revision',t.local_revision)),'[]') INTO result FROM (SELECT * FROM public.community_tasks WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200)t;
 WHEN 'community.listReplies' THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'author',coalesce(u.display_name,r.author_snapshot),'content',r.body,'created_at',r.created_at,'likers',coalesce((SELECT jsonb_agg(name) FROM (SELECT pf.display_name name FROM api_private.message_likes l JOIN public.profiles pf ON pf.id=l.actor_id WHERE l.issue_id=issue.id AND l.reply_id=r.id UNION SELECT name FROM api_private.legacy_likes WHERE kind='message' AND object_id=issue.id AND reply_id=r.id)likes),'[]')) ORDER BY r.created_at),'[]') INTO result FROM api_private.message_replies r LEFT JOIN public.profiles u ON u.id=r.actor_id WHERE r.issue_id=issue.id AND r.deleted_at IS NULL;
 WHEN 'community.listLikes' THEN SELECT coalesce(jsonb_agg(name),'[]') INTO result FROM (SELECT u.display_name name FROM api_private.message_likes l JOIN public.profiles u ON u.id=l.actor_id WHERE l.issue_id=issue.id AND l.reply_id='' UNION SELECT name FROM api_private.legacy_likes WHERE kind='message' AND object_id=issue.id AND reply_id='')likes;
 WHEN 'community.stats' THEN SELECT jsonb_build_object('user_name',pf.display_name,'total_points',coalesce(base.total_points,0)+coalesce((SELECT sum(delta) FROM api_private.local_points WHERE actor_id=auth.uid()),0),'reports_count',coalesce(base.reports_count,0)+(SELECT count(*) FROM public.community_tasks WHERE local_actor_id=auth.uid()),'verify_count',coalesce(base.verify_count,0),'level',greatest(1,floor((coalesce(base.total_points,0)+coalesce((SELECT sum(delta) FROM api_private.local_points WHERE actor_id=auth.uid()),0))/100.0)+1)) INTO result FROM public.profiles pf LEFT JOIN api_private.legacy_statistics base ON base.actor_id=pf.id WHERE pf.id=auth.uid();
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;RETURN result;
END$$;
CREATE FUNCTION api_private.community_write(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE prior jsonb;result jsonb;issue public.community_tasks;reply api_private.message_replies;actor text;liked boolean;v_delta integer;BEGIN
 prior:=api_private.begin_operation(a,p);IF prior IS NOT NULL THEN RETURN prior->'result';END IF;
 PERFORM api_private.survey_gate(p);SELECT display_name INTO actor FROM public.profiles WHERE id=auth.uid();
 IF p ? 'id' THEN
  SELECT * INTO issue FROM public.community_tasks WHERE id=(p->>'id')::bigint AND teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF issue.target_layer_key IS NOT NULL THEN PERFORM api_private.survey_gate(p||jsonb_build_object('targetLayerKey',issue.target_layer_key,'targetObjectCode',issue.target_object_code));END IF;
  IF a IN ('community.updateTask','community.updateMessage','community.deleteTask','community.deleteMessage','community.transition') AND issue.local_actor_id IS DISTINCT FROM auth.uid() AND NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END IF;
 CASE a
 WHEN 'community.createTask','community.createMessage' THEN
 INSERT INTO public.community_tasks(teaching_project_id,village_id,space_id,reporter_name,description,category,lng,lat,geom,target_layer_key,target_object_code,local_actor_id) VALUES((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',actor,p->>'body',coalesce(p->>'category',''),(p->>'lng')::double precision,(p->>'lat')::double precision,CASE WHEN p->>'lng' IS NOT NULL AND p->>'lat' IS NOT NULL THEN jsonb_build_object('type','Point','coordinates',jsonb_build_array((p->>'lng')::double precision,(p->>'lat')::double precision)) END,p->>'targetLayerKey',p->>'targetObjectCode',auth.uid()) RETURNING * INTO issue;
 WHEN 'community.updateTask','community.updateMessage' THEN
 IF issue.local_revision<>(p->>'revision')::bigint THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE public.community_tasks SET description=p->>'body',local_revision=local_revision+1 WHERE id=issue.id RETURNING * INTO issue;
 WHEN 'community.deleteTask','community.deleteMessage' THEN UPDATE public.community_tasks SET deleted_at=now(),local_revision=local_revision+1 WHERE id=issue.id RETURNING * INTO issue;
 WHEN 'community.transition' THEN
 IF NOT ((issue.status='pending' AND p->>'status'='resolved') OR (issue.status='resolved' AND p->>'status'='archived')) THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE public.community_tasks SET status=p->>'status',settled_at=now(),local_revision=local_revision+1 WHERE id=issue.id RETURNING * INTO issue;
 IF issue.status='resolved' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'points',0));
  SELECT greatest(0,least(3,20-coalesce(sum(delta),0)-coalesce((SELECT positive_today FROM api_private.legacy_statistics WHERE actor_id=auth.uid() AND snapshot_day=(now() AT TIME ZONE 'Asia/Shanghai')::date),0))) INTO v_delta FROM api_private.local_points WHERE actor_id=auth.uid() AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
  INSERT INTO api_private.local_points VALUES(auth.uid(),issue.id,'resolved',v_delta,now()) ON CONFLICT DO NOTHING;
 END IF;
 WHEN 'community.addReply' THEN INSERT INTO api_private.message_replies(issue_id,actor_id,body) VALUES(issue.id,auth.uid(),p->>'body');result:=api_private.community_read('community.listReplies',p);
 WHEN 'community.deleteReply' THEN
  SELECT * INTO reply FROM api_private.message_replies WHERE issue_id=issue.id AND id=p->>'replyId' AND deleted_at IS NULL FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF reply.actor_id IS DISTINCT FROM auth.uid() AND NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;UPDATE api_private.message_replies SET deleted_at=now() WHERE issue_id=issue.id AND id=reply.id;result:=api_private.community_read('community.listReplies',p);
 WHEN 'community.react','community.likeReply' THEN
  IF a='community.likeReply' AND NOT EXISTS(SELECT 1 FROM api_private.message_replies WHERE issue_id=issue.id AND id=p->>'replyId' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  DELETE FROM api_private.message_likes WHERE issue_id=issue.id AND actor_id=auth.uid() AND reply_id=coalesce(p->>'replyId','');liked:=NOT FOUND;
  IF (a='community.likeReply' AND liked) OR (p->>'reaction'='like') OR (p->>'reaction'='toggle' AND liked) THEN INSERT INTO api_private.message_likes VALUES(issue.id,auth.uid(),coalesce(p->>'replyId','')) ON CONFLICT DO NOTHING;liked:=true;ELSE liked:=false;END IF;
  result:=jsonb_build_object('liked',liked,'count',(SELECT count(*) FROM api_private.message_likes WHERE issue_id=issue.id AND reply_id=coalesce(p->>'replyId','')));
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;
 IF a IN ('community.createTask','community.createMessage','community.updateTask','community.updateMessage','community.deleteTask','community.deleteMessage','community.transition') THEN
  INSERT INTO api_private.community_history VALUES(issue.id,issue.local_revision,to_jsonb(issue),auth.uid(),now());result:=to_jsonb(issue)-'local_actor_id'||jsonb_build_object('revision',issue.local_revision);
 END IF;
 RETURN api_private.finish_operation(a,p,result);
END$$;
-- Preserve legacy display snapshots without claiming ownership by display name.
INSERT INTO api_private.comment_replies(comment_id,author_snapshot,body,created_at)
 SELECT c.id,x.value->>'author',left(x.value->>'content',200),coalesce(c.created_at,now())
 FROM public.object_comments c JOIN public.object_attribute_edits e ON e.object_code='COMMENT_'||c.id AND e.object_type='object_comment_interactions' AND e.teaching_project_id=c.teaching_project_id AND e.village_id=c.village_id AND e.space_id=c.space_id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.data->'replies')='array' THEN e.data->'replies' ELSE '[]' END)x(value)
 WHERE length(coalesce(x.value->>'content',''))>0;
INSERT INTO api_private.message_replies(id,issue_id,author_snapshot,body,created_at)
 SELECT coalesce(nullif(x.value->>'id',''),'legacy-'||x.ordinality),t.id,x.value->>'author',left(x.value->>'content',200),t.created_at
 FROM public.community_tasks t JOIN public.object_attribute_edits e ON e.object_code='MSG_'||t.id AND e.object_type='message_replies' AND e.teaching_project_id=t.teaching_project_id AND e.village_id=t.village_id AND e.space_id=t.space_id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.data->'replies')='array' THEN e.data->'replies' ELSE '[]' END) WITH ORDINALITY x(value,ordinality)
 WHERE length(coalesce(x.value->>'content',''))>0 ON CONFLICT DO NOTHING;

-- Migrate recognizable likes to UUIDs; unresolvable names stay read-only snapshots.
CREATE TABLE api_private.like_import(kind text,object_id bigint,reply_id text,name text);
INSERT INTO api_private.like_import
 SELECT 'comment',c.id,'',x.name FROM public.object_comments c JOIN public.object_attribute_edits e ON e.object_code='COMMENT_'||c.id AND e.object_type='object_comment_interactions' AND e.teaching_project_id=c.teaching_project_id AND e.village_id=c.village_id AND e.space_id=c.space_id
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.data->'likes')='array' THEN e.data->'likes' ELSE '[]' END)x(name);
INSERT INTO api_private.like_import
 SELECT 'message',t.id,'',x.name FROM public.community_tasks t JOIN public.object_attribute_edits e ON e.object_code='MSG_'||t.id AND e.object_type='message_likes' AND e.teaching_project_id=t.teaching_project_id AND e.village_id=t.village_id AND e.space_id=t.space_id
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.data->'likers')='array' THEN e.data->'likers' ELSE '[]' END)x(name);
INSERT INTO api_private.like_import
 SELECT 'message',t.id,coalesce(nullif(x.value->>'id',''),'legacy-'||x.ordinality),l.name FROM public.community_tasks t JOIN public.object_attribute_edits e ON e.object_code='MSG_'||t.id AND e.object_type='message_replies' AND e.teaching_project_id=t.teaching_project_id AND e.village_id=t.village_id AND e.space_id=t.space_id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.data->'replies')='array' THEN e.data->'replies' ELSE '[]' END) WITH ORDINALITY x(value,ordinality)
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(x.value->'likers')='array' THEN x.value->'likers' ELSE '[]' END)l(name);
INSERT INTO api_private.comment_likes
 SELECT l.object_id,p.id FROM api_private.like_import l JOIN public.profiles p ON p.display_name=l.name WHERE kind='comment' AND (SELECT count(*) FROM public.profiles p2 WHERE p2.display_name=l.name)=1 ON CONFLICT DO NOTHING;
INSERT INTO api_private.message_likes
 SELECT l.object_id,p.id,l.reply_id FROM api_private.like_import l JOIN public.profiles p ON p.display_name=l.name WHERE kind='message' AND (SELECT count(*) FROM public.profiles p2 WHERE p2.display_name=l.name)=1 ON CONFLICT DO NOTHING;
INSERT INTO api_private.legacy_likes SELECT DISTINCT l.* FROM api_private.like_import l WHERE (SELECT count(*) FROM public.profiles p WHERE p.display_name=l.name)<>1 ON CONFLICT DO NOTHING;
DROP TABLE api_private.like_import;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION api_private.begin_operation(text,jsonb),api_private.finish_operation(text,jsonb,jsonb),api_private.survey_gate(jsonb),api_private.comment_interactions(bigint) FROM authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.survey_read(text,jsonb),api_private.survey_write(text,jsonb),api_private.community_read(text,jsonb),api_private.community_write(text,jsonb) TO authenticated;
