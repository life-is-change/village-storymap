(function exposeFacadeQueueClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FacadeQueueClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function facadeQueueClientFactory() {
  const ARTIFACT_BUCKET = 'facade-generation';

  function unwrap(result) {
    if (result?.error) throw result.error;
    return result?.data;
  }

  function createFacadeQueueClient(supabaseClient) {
    if (!supabaseClient) throw new TypeError('An authenticated Supabase client is required');

    return {
      async submit({ courseId, spaceId, objectCode, photoId }) {
        return unwrap(await supabaseClient.rpc('submit_facade_run', {
          p_course_id: courseId,
          p_space_id: spaceId,
          p_object_code: objectCode,
          p_photo_id: Number(photoId)
        }));
      },

      async getRun(runId) {
        return unwrap(await supabaseClient
          .from('facade_generation_runs')
          .select('*')
          .eq('id', runId)
          .single());
      },

      async getWorkerAvailability() {
        const value = unwrap(await supabaseClient.rpc('get_facade_worker_availability'));
        return value || { available: false, last_seen_at: null };
      },

      async findLatestRun({ spaceId, objectCode }) {
        return unwrap(await supabaseClient
          .from('facade_generation_runs')
          .select('*')
          .eq('space_id', spaceId)
          .eq('object_code', objectCode)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle());
      },

      async confirmCrop(runId, { cropTop, roofType, buildingWidth, buildingDepth }) {
        return unwrap(await supabaseClient.rpc('confirm_facade_crop', {
          p_run_id: runId,
          p_crop_top: Number(cropTop),
          p_roof_type: roofType,
          p_building_width: Number(buildingWidth),
          p_building_depth: Number(buildingDepth)
        }));
      },

      async cancel(runId) {
        return unwrap(await supabaseClient.rpc('request_facade_cancel', {
          p_run_id: runId
        }));
      },

      async retryFailed(runId) {
        return unwrap(await supabaseClient.rpc('retry_failed_facade_run', {
          p_run_id: runId
        }));
      },

      async listArtifacts(runId) {
        return unwrap(await supabaseClient
          .from('facade_generation_artifacts')
          .select('*')
          .eq('run_id', runId)
          .order('created_at', { ascending: true }));
      },

      async createArtifactUrl(storagePath, expiresIn = 300) {
        const data = unwrap(await supabaseClient.storage
          .from(ARTIFACT_BUCKET)
          .createSignedUrl(storagePath, expiresIn));
        return data?.signedUrl || data?.signedURL || '';
      },

      subscribe(runId, onChange) {
        const channel = supabaseClient
          .channel(`facade-run-${runId}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'facade_generation_runs',
            filter: `id=eq.${runId}`
          }, onChange)
          .subscribe();
        return () => supabaseClient.removeChannel(channel);
      }
    };
  }

  return { ARTIFACT_BUCKET, createFacadeQueueClient };
});
