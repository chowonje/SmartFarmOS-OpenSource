# Cloud Pilot Checklist

Use this only for a controlled contest or pilot environment.

- Public DNS for `SMARTFARM_SITE_ADDRESS` points at the VM.
- `deploy/cloud-pilot/.env` exists and is not committed.
- `SMARTFARM_BASIC_AUTH_USER` is non-empty.
- `SMARTFARM_BASIC_AUTH_HASH` was generated for this pilot and stored in single quotes.
- `SMARTFARM_DEMO_KEY` was generated for this pilot.
- `SMARTFARM_OPENWEATHER_API_KEY` is blank for fixture mode or newly issued,
  quota-restricted, and server-only for live mode.
- The VM exposes only `80/tcp` and `443/tcp`.
- No host firewall rule publishes `3100` or `4173`.
- `npm run cloud-pilot:verify` passes locally before shipping files.
- `npm run cloud-pilot:up` succeeds on the VM.
- `https://<domain>/healthz` returns a healthy response.
- Browser access to `https://<domain>/` prompts for Basic Auth.
- Browser devtools do not show the demo key in HTML, JS, or request bodies.
- Stopping the stack with `npm run cloud-pilot:down` leaves the SQLite volume intact.
- Rotating the pilot requires replacing the auth hash and demo key.
