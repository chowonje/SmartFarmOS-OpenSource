# SmartFarmOS Admin

Separately authorized operational UI for issuing and revoking Raspberry Pi
gateway enrollment credentials. It deliberately does not accept Linux, SSH, or
Edge passwords.

Local demo:

```sh
npm run demo:local
```

The launcher serves this app at `http://127.0.0.1:5174` with a local-only
administrator proxy identity. That identity is not production authentication.
A real deployment must protect this app and its `/api` proxy with a reviewed
administrator identity provider. `PUBLIC_API_BASE_URL` is intentionally limited
to a same-origin path such as `/api`; terminate TLS and forward the authenticated
administrator session through that reverse proxy rather than calling a separate
browser origin.

Legacy reference: `../../api/admin` and admin-only behavior found in
`../../resberrypi/client`.
