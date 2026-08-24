# Cloud Pilot Finalization Checklist

Use this for the controlled contest/final-product pilot only. It is not a production hardware-control sign-off.

## Before Build

- The source archive is produced from the reviewed public-release branch, not the private historical branch or a dirty directory.
- The exact commit SHA, archive SHA-256, and immutable image tag are written in the deployment record.
- The expected SHA-256 was calculated on the trusted release workstation before transfer, retained separately, and compared with the VM copy; a digest recalculated only on the VM is not a source trust anchor.
- The commit SHA is an operator claim and matches the reviewed public release; it is not a substitute for the trusted archive digest.
- The archive is at most 512 MiB and contains one top-level directory with only regular files and directories; links, devices, FIFOs, and path escapes are rejected before build.
- The VM is Rocky Linux 8.10 with rootful Podman 4.9.4.
- The operator is root or is already configured for rootful Podman; no `sudo` wrapper is assumed in the commands.
- The VM has no requirement for host Node.js, Git, Docker, Docker Compose, or Caddy; standard `tar` is available for the source archive.
- DNS for `SMARTFARM_SITE_ADDRESS` resolves to the VM's public address.
- Cloud security group and host firewall allow only `80/tcp` and `443/tcp`.
- No rule exposes `3100`, `4173`, or `4174`.
- Outbound ACME access is permitted so Caddy can obtain HTTPS certificates.

## Pilot Secrets

- The pilot env file is outside the source archive and has mode `600`.
- `SMARTFARM_SITE_ADDRESS`, `SMARTFARM_BASIC_AUTH_USER`, `SMARTFARM_BASIC_AUTH_HASH`, and `SMARTFARM_DEMO_KEY` are non-empty.
- The Basic Auth hash and demo key were newly generated for this pilot.
- A single-quoted bcrypt hash is allowed; `podman.sh` normalizes it without `eval` or `source`.
- `SMARTFARM_OPENWEATHER_API_KEY` is blank for fixture mode, or is a newly issued, restricted, server-only key.
- No key is in the source archive, shell history, screenshot, ticket, or public repository.

## Start and Verify

- `./podman.sh build --archive … --archive-sha256 … --commit … --image …` completes.
- `./podman.sh up --env … --image …` starts without replacing an existing container.
- `./podman.sh status` reports `running` and eventually `healthy`.
- `https://<domain>/healthz` returns successfully.
- The root URL requests Basic Auth and loads the PWA after successful login.
- Browser network/devtools has no demo key, weather key, or API/SQLite credential.
- The admin UI has no public route and cannot be reached on port `4174`.
- Only `80` and `443` are listed as published Podman ports.
- `./podman.sh logs --tail 200` has no startup or certificate error.

## Recovery

- The prior image tag is retained until the pilot is accepted.
- The operator knows that `./podman.sh down` preserves SQLite and Caddy named volumes.
- Container and volume targets are fixed by the helper. `down` refuses a same-named container that lacks the helper's ownership label.
- Any rollback uses an explicit previous image tag and the same env file.
- A future persisted-SQLite schema change requires a volume backup and a non-public restore rehearsal before deployment.
