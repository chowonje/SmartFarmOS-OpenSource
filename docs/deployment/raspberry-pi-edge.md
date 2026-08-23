# Raspberry Pi Edge Agent

This document covers the minimal runnable Raspberry Pi-side SmartFarmOS Edge
slice that now lives inside `services/edge`.

It is intentionally narrow:

- one-time enrollment token exchange from local TTY/stdin only;
- secret credential storage in a local JSON file with `0600`, atomic same-dir
  temp write, file fsync, rename, and parent-dir fsync on POSIX;
- daemon startup from a reviewed local config file;
- a Pi-local password change command that never touches the central API or a
  browser and writes the new password only to `/usr/sbin/chpasswd` stdin.

It is not a finished production deployment. It does not prove real GPIO,
serial, MQTT, sensor telemetry, watchdogs, hardware-safe pump behavior, or real
OS mutation beyond manual operator testing.

## Files

- example config: `deploy/edge/config.example.json`
- example systemd unit: `deploy/edge/smartfarm-edge.service.example`
- default config path: `/etc/smartfarm-edge/config.json`
- default credential path: `/var/lib/smartfarm-edge/credential.json`
- default execution journal: `/var/lib/smartfarm-edge/execution.sqlite`

## CLI Commands

```bash
smartfarm-edge enroll
smartfarm-edge credential-status
smartfarm-edge run
smartfarm-edge passwd --user smartfarm
```

`enroll` never accepts the token through argv or environment variables. Use the
hidden TTY prompt for normal operation. The program can also read from an
already-protected stdin stream for controlled provisioning automation; do not
put the token in a shell command, environment variable, or process argument.

`passwd` is local only. The command is restricted to the built-in allowlist:

- `pi`
- `smartfarm`
- `smartfarm-edge`

It never sends the password to the SmartFarmOS API. It spawns
`/usr/sbin/chpasswd` without a shell and sends only `username:newPassword` to
stdin. The default password flow requires a TTY and does not fall back to piped
stdin.

## Example Config

Start from:

```bash
npm ci
npm run build
(cd services/edge && sudo npm link)
sudo adduser --system --group --home /var/lib/smartfarm-edge \
  --no-create-home smartfarm-edge
sudo install -d -o root -g root -m 755 /etc/smartfarm-edge
sudo install -d -o smartfarm-edge -g smartfarm-edge -m 700 \
  /var/lib/smartfarm-edge
sudo install -o root -g root -m 644 deploy/edge/config.example.json \
  /etc/smartfarm-edge/config.json
```

Review and replace:

- `apiUrl`
- `farmId`
- `deviceId`

The backend contract for enrollment is:

- `POST /v1/gateway-enrollments/exchange`
- `Authorization: Bearer <enrollmentToken>`
- body `{}` only
- response `smartfarm.gateway-enrollment-exchange-response.v1`

That response returns two things:

- `credential`: a reviewed `EdgeCredentialRecord`
- `edgeKey`: the one-time returned secret used by the Pi afterward

The CLI checks that `credential.farmId` and `credential.deviceId` exactly match
the local config before storing the local credential file.

## Enroll On The Pi

Interactive:

```bash
sudo -u smartfarm-edge smartfarm-edge enroll \
  --config /etc/smartfarm-edge/config.json
```

The stored credential file remains local-only and is never printed back to the
terminal by the CLI.

The runtime directory must be a real directory owned by the current service
account with mode `0700`; symbolic-link and group/world-accessible parents are
rejected. The credential file must be owned by that account with mode `0600`.

## Check Local Credential State

```bash
sudo -u smartfarm-edge smartfarm-edge credential-status \
  --config /etc/smartfarm-edge/config.json
```

This prints farm/device/API metadata plus whether the credential file exists and
its issued time. It does not print `edgeKey`.

## Start The Daemon

```bash
sudo install -m 644 deploy/edge/smartfarm-edge.service.example \
  /etc/systemd/system/smartfarm-edge.service
sudo systemctl daemon-reload
sudo systemctl enable --now smartfarm-edge.service
```

The current `run` command is the daemon wrapper around the existing edge
gateway/journal core. It starts the normal command loop and the higher-priority
stop lane loop immediately. A telemetry loop runs only when a telemetry source
is injected in code. No real Raspberry Pi hardware adapter is included in this
slice yet, so a real deployment still needs a reviewed `DeviceCommandExecutor`
integration.

## Change A Local OS Password

```bash
sudo smartfarm-edge passwd --user smartfarm
```

The CLI asks for the new password twice with hidden TTY input. This command is a
local machine action only. It never calls the SmartFarmOS API, never uses a
browser, and never places the password on the process command line.

## Verification Status

Automated in this repository:

- config parsing and path defaults;
- credential-file atomic write/read and private-mode rejection;
- enrollment request/response handling;
- daemon loop wiring with injected ports;
- local password command spawning behavior through injected fake processes.

Manual only:

- real `/usr/sbin/chpasswd` execution on Linux;
- real Raspberry Pi service installation;
- any GPIO, MQTT, serial, sensor, or physical actuation path.
