# Optional cloud facade on the autonomous instance

This option is disabled by default. The campus 4090 facade pipeline remains available independently. Enabling the provider requires an explicit server configuration, private `DASHSCOPE_KEY_FILE` and validated workspace/region; inline API keys and browser-supplied provider URLs are rejected. No paid provider request is made by tests or deployment validation.

The local task references the same immutable local photo UUID/digest as the normal upload. Only the bounded image bytes are sent directly to the provider; no Supabase URL or public photo capability is created. Result images are streamed, validated and atomically promoted to a digest-derived local blob identity before a lease-checked metadata commit.

Before submitting a potentially billable request, the database stores its intent. Missing acknowledgements and crashes after intent become `PROVIDER_SUBMISSION_UNKNOWN`; automatic task retry cannot bill again. A known provider ID is retained across lost database acknowledgements and used only for polling. Reconciliation requires the database owner through a private operator procedure; the ordinary API login is denied that operation. The unified deployment handoff must include the operator wrapper rather than exposing recovery as a public endpoint.

Canceling an accepted job prevents publishing its output locally. It does not claim to cancel provider billing or refund an already accepted request. Polling has a bounded deadline and backoff. Keys, provider messages, temporary result URLs and private rows are excluded from user-facing errors.

The adapter uses the documented Qwen Image 3.0 asynchronous endpoint and Base64 image input, with strict result-host and byte limits. Source deployments retain their existing adapters unchanged. The endpoint distinction was checked against the [official Qwen API reference](https://help.aliyun.com/en/model-studio/qwen-image-generation-and-editing-api-reference) on 2026-10-21.

Local unit tests cover uncertain acknowledgements, repeated calls, cancel state, invalid/oversized outputs and independent configuration. Native acceptance must additionally prove durable SQL intent, owner-only reconciliation, same-file ownership and canceled publication. Real provider credentials and a real paid job remain a separate optional acceptance gate.
