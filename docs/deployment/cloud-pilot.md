# Cloud Pilot Packaging

This deployment is for the August 10, 2026 contest/demo window and a tightly
controlled pilot only. It packages the existing simulator-backed local demo
behind Caddy so the browser still talks to `/api` on the same origin, while the
demo key stays server-side.

It is not a production release. It does not add real identity, device
provisioning, MQTT transport, telemetry buffering, hardware-safe pump
interlocks, or production database operations.

## What This Package Does

- builds the existing monorepo once inside Docker
- runs `node scripts/run-local-demo.mjs --preview`
- serves the built PWA through Vite preview on loopback only
- fronts the preview with Caddy for HTTPS and outer Basic Auth
- persists the central API and Edge SQLite files on a named Docker volume
- exposes only ports `80` and `443` from the VM

Because the bundled demo runtime already binds the API and preview servers to
`127.0.0.1`, Caddy and the demo run in the same container. That keeps the demo
key out of the browser bundle without changing application code.

## Prepare Secrets

1. Copy `deploy/cloud-pilot/.env.example` to `deploy/cloud-pilot/.env`.
2. Set `SMARTFARM_SITE_ADDRESS` to the exact public domain for the VM.
3. Generate a Basic Auth hash without putting the plaintext password in shell
   history or the process list:

   ```bash
   npm run cloud-pilot:hash-password
   ```

   The command reads from stdin when `--plaintext` is omitted; on a TTY the
   password is not echoed.

4. Put the chosen username in `SMARTFARM_BASIC_AUTH_USER`.
5. Put the generated hash in `SMARTFARM_BASIC_AUTH_HASH`, wrapped in single
   quotes so it stays literal in `.env`:

   ```dotenv
   SMARTFARM_BASIC_AUTH_HASH='$2a$14$replace-with-your-generated-hash'
   ```

   Docker Compose applies interpolation to unquoted and double-quoted `.env`
   values, while single-quoted values are literal. The local wrapper script
   strips those single quotes before it hands the value to Compose.

6. Generate a random demo key and set `SMARTFARM_DEMO_KEY`:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

7. Optional: leave `SMARTFARM_OPENWEATHER_API_KEY` blank for the reproducible
   fixture, or set a newly issued server-side key to enable the fixed official
   OpenWeather endpoint. See [weather-provider.md](./weather-provider.md).

Do not commit `deploy/cloud-pilot/.env`.

## Start And Stop

Start the pilot stack:

```bash
npm run cloud-pilot:up
```

Tail logs:

```bash
npm run cloud-pilot:logs
```

Stop the pilot stack:

```bash
npm run cloud-pilot:down
```

## Runtime Layout

```text
browser
  -> HTTPS + Basic Auth
  -> Caddy
  -> Vite preview (127.0.0.1:4173)
  -> local demo API proxy
  -> local demo API (127.0.0.1:3100)
  -> SQLite in /data/smartfarm-demo.sqlite
  -> Edge SQLite in /data/smartfarm-demo.sqlite.edge.sqlite
```

`/healthz` is intentionally left outside Basic Auth and rewrites to the local
demo API `/health` endpoint so a VM or external monitor can check liveness
without touching app routes.

## Access Control Notes

- The browser never receives `SMARTFARM_DEMO_KEY`.
- The optional weather key is passed only to the server process and is never a
  `PUBLIC_` build variable.
- The app container does not publish ports `3100` or `4173`.
- The only public entrypoint is Caddy on `80/443`.
- Basic Auth is mandatory; the compose file refuses empty credentials.
- `npm run cloud-pilot:*` reads `deploy/cloud-pilot/.env` itself, so a quoted
  bcrypt hash is passed through literally and Compose does not reinterpret it.

## Residual Risks

- Basic Auth is only an outer gate for a contest/pilot environment.
- The payload behind Caddy is still simulator-backed.
- Automatic HTTPS depends on a working public DNS record for
  `SMARTFARM_SITE_ADDRESS`.
- The packaged runtime inherits the current local demo limitations documented in
  `README.md` and the architecture notes.
