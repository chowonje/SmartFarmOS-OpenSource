# Getting started

This guide runs the simulator-backed SmartFarmOS product on one development
machine. It does not configure production identity, physical devices, MQTT, or
public internet access.

## Requirements

- macOS, Linux, or Windows with WSL/Git Bash (the full verification entrypoint
  is a POSIX shell script)
- Node.js 24 (`.nvmrc` is provided)
- npm 10 or newer
- Git
- Chrome or Chromium for the complete browser verification path

Docker is required only for the optional cloud-pilot packaging workflow.

## Clone and run

```bash
git clone https://github.com/chowonje/SmartFarmOS-OpenSource.git
cd SmartFarmOS-OpenSource
```

The local quick start is three commands:

```bash
nvm use
npm ci
npm run demo:local
```

If `nvm` is unavailable, install a Node.js version accepted by the `engines`
field in `package.json` and skip `nvm use`.

The command builds every workspace and starts:

- the central API with local SQLite persistence;
- two isolated Edge/simulator device paths;
- deterministic environment telemetry and a low-water alarm scenario;
- the Vite PWA development server;
- the separate gateway enrollment admin console.

The launcher generates its demo credential in memory and binds the PWA, admin
console, and API to loopback. Do not expose this local demo directly to a
public network. Stop the launcher with `Ctrl+C`.

| Surface | Development URL | Preview URL |
| --- | --- | --- |
| User PWA | `http://127.0.0.1:5173` | `http://127.0.0.1:4173` |
| Gateway admin console | `http://127.0.0.1:5174` | `http://127.0.0.1:4174` |

To test the production bundles and PWA install flow:

```bash
npm run demo:local:preview
```

## Port and database overrides

The launcher accepts these optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMARTFARM_DEMO_PORT` | `3100` | Central API loopback port |
| `SMARTFARM_PWA_PORT` | `5173` or `4173` | PWA loopback port |
| `SMARTFARM_ADMIN_PORT` | PWA port + 1 | Admin console loopback port |
| `SMARTFARM_DEMO_DB_PATH` | `.smartfarm-demo.sqlite` | Central SQLite file path |

Example:

```bash
SMARTFARM_DEMO_PORT=3200 \
SMARTFARM_PWA_PORT=5273 \
SMARTFARM_ADMIN_PORT=5274 \
npm run demo:local
```

The launcher injects the selected admin URL into the PWA. Set all three ports
explicitly when a test harness cannot use the adjacent-port default.

Use a new database path when a test must start from a clean scenario. The Edge
journal is stored beside it as `<database-path>.edge.sqlite`; treat those two
files as one restart boundary and do not delete only one of them. SQLite files
and local artifacts are ignored by Git.

## Verify

Run the complete repository gate before submitting a change:

```bash
npm run verify
```

Useful narrower checks are:

```bash
npm run build
npm run typecheck
npm run test
npm run smoke:simulator
npm run smoke:api
npm run smoke:edge
npm run smoke:persistence
npm run smoke:pwa
npm run smoke:pwa:browser
```

The browser smoke uses an installed Chrome or Chromium. Set `CHROME_PATH` when
the executable is outside a standard location. Set
`SMARTFARM_REQUIRE_BROWSER=1` to fail instead of skip when no browser exists.

## Collect safe diagnostics

Record the exact failing command and only the smallest relevant error excerpt.
These commands provide useful, non-secret version context:

```bash
node --version
npm --version
git rev-parse --short HEAD
```

Before sharing output, remove tokens, authorization headers, farm or participant
data, private hostnames, and personal filesystem paths. Do not run or paste
`env`, `printenv`, an environment file, a SQLite database, or a full browser
profile. Follow [Support](../SUPPORT.md) for the issue checklist and
[Security policy](../SECURITY.md) for suspected vulnerabilities.

## Common problems

### The Node.js version is rejected

Run `node --version`, compare it with `package.json#engines`, and use
`nvm use` when possible.

### A port is already in use

Stop the other process or override `SMARTFARM_DEMO_PORT` and
`SMARTFARM_PWA_PORT` as shown above. Set `SMARTFARM_ADMIN_PORT` too when the
adjacent admin port is occupied.

### Old demo state changes the scenario

Stop the launcher and use a new `SMARTFARM_DEMO_DB_PATH`. Do not delete an
unknown database file just to reset the demo.

### Browser verification is skipped

Install Chrome or Chromium, set `CHROME_PATH` if needed, and rerun
`npm run smoke:pwa:browser`.

## Raspberry Pi test boundary

Start with the [field-test checklist](testing/field-test-checklist.md), then
follow the [Raspberry Pi Edge guide](deployment/raspberry-pi-edge.md) for the
current enrollment, credential-file, daemon, and local password commands. Its
automated checks do not prove Raspberry Pi installation, Linux password
mutation, GPIO, serial, MQTT, sensor, or actuator behavior; those steps remain
manual and hardware-specific.

## Next reading

- [Architecture](architecture.md)
- [Feature parity](feature-parity.md)
- [HTTP V1 contract](contracts/http-v1.md)
- [Field-test checklist](testing/field-test-checklist.md)
- [Raspberry Pi Edge guide](deployment/raspberry-pi-edge.md)
- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
