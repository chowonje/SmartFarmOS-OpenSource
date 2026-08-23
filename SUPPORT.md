# Support

SmartFarmOS is a pre-release, simulator-backed project. Community support is
best effort; there is no production service-level agreement.

## Usage questions

Before opening an issue:

1. Read [Getting started](docs/getting-started.md).
2. Check [Feature parity](docs/feature-parity.md) to confirm the capability is
   implemented.
3. Run the relevant verification command and keep the non-sensitive output.
4. Search existing GitHub issues.

Use the bug report template for reproducible defects and the feature request
template for new capabilities. Include the operating system, Node.js version,
command, expected result, actual result, and a minimal reproduction.

## Safe diagnostic bundle

Start with version information that does not expose runtime configuration:

```bash
node --version
npm --version
git rev-parse --short HEAD
```

Then provide the exact failing command, whether the PWA or admin console was in
development or preview mode, any port overrides by variable name, and the
smallest sanitized error excerpt. Replace tokens, authorization headers,
private hostnames, farm/device names, participant details, and personal paths
with explicit placeholders.

Do not run or paste `env`, `printenv`, shell history, an environment file, a
SQLite database, a full browser profile, or a complete process dump to diagnose
an issue. If a maintainer needs more context, share only the specific
non-sensitive lines requested.

## Do not post

Do not include credentials, tokens, environment-file values, service-account
files, private farm or participant details, local databases, full browser
profiles, or unredacted logs. Replace sensitive values with clear placeholders.

Suspected vulnerabilities follow [SECURITY.md](SECURITY.md). Do not place
exploit details in a public support issue.

## Raspberry Pi and hardware reports

Start with the [field-test checklist](docs/testing/field-test-checklist.md), then
read the [Raspberry Pi Edge guide](docs/deployment/raspberry-pi-edge.md). State
the board model, OS version, transport or adapter, command, and whether the
result came from a simulator, injected test double, or physical device. Never
include an enrollment token, Edge key, OS password, private configuration file,
or system log that has not been reviewed and redacted.

## Unsupported production claims

The repository does not currently provide production identity, multi-instance
database operation, backup automation, physical MQTT/device proof, emergency
stop certification, or a hardware safety guarantee. The local demo and cloud
pilot must not be treated as production deployment guidance.
