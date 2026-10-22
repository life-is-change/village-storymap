-- One restored legacy building, not a general review-index initializer.
-- The initial snapshot must prove baseline membership in this exact context.
DO $h001$
DECLARE
 target_space public.planning_spaces;
 target_feature public.planning_features;
 target_review public.survey_feature_reviews;
 n bigint;
BEGIN
 IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN
  RAISE EXCEPTION 'H001_LOCAL_DATABASE_REQUIRED';
 END IF;
 IF __APPLY__ THEN
  LOCK TABLE public.planning_spaces, public.planning_features, public.village_datasets,
   public.feature_snapshots, public.feature_snapshot_items, public.survey_feature_reviews
   IN SHARE ROW EXCLUSIVE MODE;
 END IF;
 SELECT count(1) INTO n FROM public.planning_features f JOIN public.planning_spaces s
  ON s.id=f.space_id AND s.teaching_project_id=f.teaching_project_id AND s.village_id=f.village_id
  WHERE f.layer_key='building' AND f.object_code='H001' AND s.space_type IN ('practice_shared','formal_shared');
 IF n<>1 THEN RAISE EXCEPTION 'H001_UNIQUE_SHARED_CONTEXT_REQUIRED';END IF;
 SELECT * INTO target_space FROM public.planning_spaces
  WHERE id='practice-shared-00000000-0000-4000-8000-000000000003'
   AND teaching_project_id='00000000-0000-4000-8000-000000000003'
   AND village_id='00000000-0000-4000-8000-000000000001';
 IF NOT FOUND OR target_space.space_type IS DISTINCT FROM 'practice_shared' OR target_space.readonly IS DISTINCT FROM false
  OR target_space.edit_enabled IS DISTINCT FROM true OR NOT EXISTS (
   SELECT 1 FROM public.village_datasets d WHERE d.id=target_space.base_dataset_id
    AND d.village_id=target_space.village_id AND d.status='published'
  ) THEN RAISE EXCEPTION 'H001_PUBLISHED_PRACTICE_CONTEXT_REQUIRED';END IF;
 SELECT * INTO target_feature FROM public.planning_features WHERE teaching_project_id=target_space.teaching_project_id
  AND village_id=target_space.village_id AND space_id=target_space.id AND layer_key='building' AND object_code='H001';
 IF NOT FOUND THEN RAISE EXCEPTION 'H001_EXISTING_FEATURE_REQUIRED';END IF;
 SELECT count(1) INTO n FROM public.feature_snapshots b JOIN public.feature_snapshot_items i ON i.snapshot_id=b.id
  WHERE b.teaching_project_id=target_space.teaching_project_id AND b.village_id=target_space.village_id AND b.space_id=target_space.id
   AND b.version_type='initial' AND i.layer_key='building' AND i.object_code='H001' AND i.is_deleted=false;
 IF n<>1 THEN RAISE EXCEPTION 'H001_MATCHING_INITIAL_BASELINE_REQUIRED';END IF;
 SELECT * INTO target_review FROM public.survey_feature_reviews WHERE teaching_project_id=target_space.teaching_project_id
  AND village_id=target_space.village_id AND space_id=target_space.id AND layer_key='building' AND object_code='H001';
 IF FOUND THEN
  -- A later user edit/delete is valid: never reset its revision or status.
  IF target_review.base_dataset_id IS DISTINCT FROM target_space.base_dataset_id OR target_review.is_v0_baseline IS DISTINCT FROM true
   OR target_review.baseline_object_code IS DISTINCT FROM 'H001' THEN RAISE EXCEPTION 'H001_EXISTING_REVIEW_CHANGED';END IF;
 ELSE
  IF target_feature.is_deleted IS DISTINCT FROM false THEN RAISE EXCEPTION 'H001_ACTIVE_FEATURE_REQUIRED';END IF;
  IF __APPLY__ THEN
   INSERT INTO public.survey_feature_reviews(teaching_project_id,village_id,space_id,base_dataset_id,
    layer_key,object_code,is_v0_baseline,baseline_object_code,geometry_status,geometry_revision,is_deleted)
   VALUES(target_space.teaching_project_id,target_space.village_id,target_space.id,target_space.base_dataset_id,'building','H001',true,'H001','pending',0,false);
  END IF;
 END IF;
END;
$h001$;
