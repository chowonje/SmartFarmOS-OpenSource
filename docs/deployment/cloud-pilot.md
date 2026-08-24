# Cloud Pilot: Rootful Podman on Rocky Linux 8.10

This is the contest/final-product pilot path for SmartFarmOS. It deploys the existing simulator-backed PWA behind HTTPS and Basic Auth so the final demo can be evaluated on a real VM without exposing a developer machine.

It is deliberately not a production farm-control deployment. It does not add production identity, hardware safety interlocks, MQTT, telemetry buffering, or production database operations.

## What Is Exposed

The only public listeners are `80/tcp` and `443/tcp` on Caddy. Caddy serves the PWA and the simulator-backed API behind the same origin. The API, PWA preview, and admin app stay on container loopback; `3100`, `4173`, and `4174` are never published and Caddy has no admin route. The optional weather key is server-only and may be blank for the reproducible fixture mode.

SQLite and Caddy certificate/config state use named Podman volumes. Each mount uses `:Z`, so the rootful Podman container has the SELinux label it needs on Rocky Linux.

## Server Preconditions

- Rocky Linux 8.10 with **rootful Podman 4.9.4** available to the operator.
- Run the commands as `root` in the Rocky web terminal, or as an operator already configured for the rootful Podman service; the documented commands do not rely on `sudo`.
- Standard base utilities: `/bin/sh`, `tar`, `mktemp`, `awk`, `sha256sum`, and `chmod`.
- No host Node.js, Git, Docker, Docker Compose, or Caddy installation is required.
- Host ports `80` and `443` are free and permitted by the VM/cloud firewall.
- A public DNS record for the final domain points at the VM before Caddy starts. Automatic HTTPS also needs outbound access to the ACME service.
- A reviewed public-release source archive and its exact Git commit SHA are available. Do not build contest deployment images from a private or dirty working tree.

## Prepare the VM

On the trusted release workstation, calculate the reviewed archive's SHA-256
**before** transferring it and keep that expected value in the deployment
record. Copy the archive to the VM, compare the VM's actual digest with the
separately retained expected value, then unpack it only to obtain the deployment
helper. Recalculating both the archive and its expected value on the VM does not
authenticate the source.

```sh
sha256sum SmartFarmOS-public-release.tar.gz  # run first on the release workstation
# After transfer, run on the VM and compare with the retained workstation value:
sha256sum SmartFarmOS-public-release.tar.gz
tar -xzf SmartFarmOS-public-release.tar.gz
cd SmartFarmOS-public-release/deploy/cloud-pilot
chmod 700 podman.sh
```

Create a separate, mode-600 pilot environment file outside the source archive, for example `~/smartfarm-pilot.env`:

```dotenv
SMARTFARM_SITE_ADDRESS=demo.example.org
SMARTFARM_BASIC_AUTH_USER=
SMARTFARM_BASIC_AUTH_HASH=
SMARTFARM_DEMO_KEY=
SMARTFARM_OPENWEATHER_API_KEY=
```

Do not commit, archive, email, or paste this file into an issue. The helper accepts only those five names and does not source or evaluate the file. A single-quoted bcrypt value is normalized safely, so this is valid:

```dotenv
SMARTFARM_BASIC_AUTH_HASH='$2a$14$replace-with-a-new-hash'
```

Generate the hash with Podman, not a host Caddy binary:

```sh
podman run --rm -it caddy:2.10 caddy hash-password
```

Generate the demo key with the Rocky base system, then paste the result into the file; do not put it in shell history:

```sh
head -c 32 /dev/urandom | base64
chmod 600 ~/smartfarm-pilot.env
```

Leave `SMARTFARM_OPENWEATHER_API_KEY` empty for fixture mode. If live weather is needed for a limited pilot, use a newly issued, restricted server key; see [weather-provider.md](./weather-provider.md).

## Build and Start

Use the exact public commit, the expected SHA-256 retained from the trusted
release workstation, and a meaningful immutable image tag. `--commit` is an
operator claim recorded on the image; the required `--archive-sha256` checks
that the VM received the same source bytes. The helper rejects archives over
512 MiB, archive paths outside one top-level directory, and non-regular tar
members such as links, devices, and FIFOs before it extracts or builds them.

```sh
./podman.sh build \
  --archive ../../../SmartFarmOS-public-release.tar.gz \
  --archive-sha256 <copy-the-trusted-lowercase-64-character-sha256> \
  --commit <public-release-commit-sha> \
  --image smartfarm-os-cloud-pilot:2026-final

./podman.sh up \
  --env ~/smartfarm-pilot.env \
  --image smartfarm-os-cloud-pilot:2026-final

./podman.sh status
./podman.sh logs --follow
```

`up` refuses to start if `smartfarm-cloud-pilot` already exists. It never silently replaces a running pilot. Container and volume names are fixed by the helper rather than environment overrides. `down` additionally requires the helper's ownership label before it can stop or remove a same-named container. The helper creates three named volumes when absent: one for the API/Edge SQLite pair, and two for Caddy state.

The container has an internal health check for the local demo API. After it reports `healthy`, confirm the actual route and the browser experience:

```sh
curl --fail --silent --show-error https://demo.example.org/healthz
```

Open the root URL in a browser. It must request Basic Auth, load the PWA, and must not offer a reachable admin console. The health endpoint is deliberately outside Basic Auth so a VM monitor can use it; it reveals only liveness.

## Stop, Logs, and Rollback

```sh
./podman.sh logs --tail 200
./podman.sh down
```

`down` stops and removes only the named container. It preserves the image and all named volumes, including SQLite and Caddy certificates. It never removes volumes automatically.

For a rollback, keep the previously verified image tag. Stop the failed container yourself, then explicitly start the previous image against the preserved volumes:

```sh
./podman.sh down
./podman.sh up --env ~/smartfarm-pilot.env --image smartfarm-os-cloud-pilot:previous
./podman.sh status
```

Rollback is safe only when the release notes confirm database compatibility. Before any version that changes persisted SQLite schema or data meaning, back up the named data volume and rehearse restoring it on a non-public VM.

## Local Packaging Check

On a development machine, before creating the public source archive, run:

```sh
npm run cloud-pilot:verify
node --test scripts/podman-cloud-pilot.test.mjs
```

The `npm run cloud-pilot:podman:*` aliases are conveniences for a development machine with npm. They are not required on the Rocky VM; use `podman.sh` directly there.
