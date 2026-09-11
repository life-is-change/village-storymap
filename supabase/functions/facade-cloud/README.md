# Cloud facade Edge Function

This function is intentionally disabled until the following server-side secrets are configured:

```text
FACADE_CLOUD_ENABLED=true
DASHSCOPE_API_KEY=...
DASHSCOPE_WORKSPACE_ID=...
DASHSCOPE_REGION=cn-beijing
FACADE_CLOUD_MODEL=qwen-image-3.0
FACADE_CLOUD_ESTIMATED_COST_CNY=0
```

Apply `supabase_SQL/Cloud Facade Provider Runs.sql` before deploying the function. Set the optional cost value to the current per-image price for the selected model; it is reporting metadata only and defaults to `0`. Never place these values in the static site or browser storage. The generated provider URL is downloaded immediately and persisted in the private `facade-generation` bucket.
