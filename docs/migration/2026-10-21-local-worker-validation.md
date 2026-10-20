# Outbound Linux Worker migration boundary

`VILLAGE_TASK_BACKEND=aliyun` selects the independent Aliyun queue and fixed `https://8.148.248.237` HTTPS endpoint. The default remains `supabase` for the original installation. An unknown selection, missing private key, certificate failure, redirect or local queue error never falls back to the source SDK.

Each Worker uses a separate private credential file. Its UUID is the Worker identity; the database checks its assigned kind, digest and revocation state on every operation. Leases are held in memory only for the active process and rechecked by the server. A restarted Worker waits for an old claim to expire rather than taking over an unfenced computation.

The adapters retain the existing geo and facade pipeline interfaces. They change transport, not inference, Blender, model files or GPU locks. Uploads use the immutable 8 MiB chunk protocol and stable receipts; photo downloads stream, resume byte ranges and verify the full immutable digest. The facade protocol includes its existing bounded diagnostics JSON and requires the building mask before entering generation.

The Compose overlay names only `geo-worker` and `facade-worker`. Its image layer copies Python code over a locally verified existing Worker image; it performs no package/model installation. The coordinated deployment must verify actual existing image IDs, service commands, mounts, users and container egress first, then update only those two services with `--no-deps`. The base image and original source-mode configuration remain rollback material. No commands in this document deploy the overlay on their own.

Synthetic tests cover method compatibility, source-client exclusion, bounded file transfer, TLS/redirect rejection, lost claim response, lease loss, cancellation, ranged download interruption and restart adoption. These tests do not prove current campus connectivity or GPU output. Final acceptance still requires the actual two containers to reach the public HTTPS endpoint and run one authorized job of each kind.
