# ADR 0006: Keep local demo authentication outside the browser bundle

## Status

Accepted for the Stage 2 local vertical slice.

## Context

The user PWA needs a real HTTP server, persisted telemetry, an active Edge command consumer, and an installable browser build before production identity and deployment are selected. The Central API intentionally has no allow-all server entrypoint, and the browser must not receive privileged device or server credentials.

## Decision

- Compose the Central API, SQLite adapter, Edge Gateway, and device simulator in `tools/local-demo`.
- Bind the demo API to `127.0.0.1` only.
- Refuse CLI startup unless `SMARTFARM_DEMO_MODE=1` is explicit.
- Generate the demo guard key in the root launcher and pass it through process environment only.
- Inject user demo headers in the Vite loopback proxy. Do not place the guard key in PWA source, runtime storage, or the production browser bundle.
- Keep the PWA API client on HTTP V1 and validate responses with shared contracts.
- Use a same-origin `/api` path by default so production can replace the demo proxy with a real authenticated reverse proxy.
- Generate the production service worker after the Vite build so the exact hashed JS/CSS assets are precached before the first offline restart.
- Cache the last contract-valid command projection in browser-local state and revalidate it through the API after reload.

## Consequences

The complete simulator-to-PWA path can be demonstrated with one local command and no external secrets. This composition must not be deployed as production authentication. Production identity, audit persistence, and transport hardening remain separate goals.

ADR 0008 subsequently added local dynamic farm/device discovery and persisted
crop management. Contest Slice B later added local alarm-acknowledgement audit
persistence in SQLite schema 4. Contest Slice D added approved strategy
applications and their command/aggregate audit in schema 5. Production
identity and transport hardening remain separate goals. Decision 0013 later
adds an opt-in, unscoped audit for direct commands outside strategy
applications.
