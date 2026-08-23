# Security policy

## Supported versions

SmartFarmOS has no production-supported release yet. Security fixes target the
current default branch and may change pre-release interfaces.

| Version | Supported |
| --- | --- |
| Default branch | Best-effort security fixes |
| Published releases | None yet |

## Reporting a vulnerability

Do not disclose a vulnerability, credential, private key, personal data, or
working exploit in a public issue.

1. Use GitHub's **Report a vulnerability** private reporting flow when it is
   available for this repository.
2. If private reporting is unavailable, open a public issue titled
   `Security contact requested` with no vulnerability details. A maintainer
   will establish a private channel before asking for technical information.
3. Include affected components, impact, prerequisites, and a minimal safe
   reproduction only in the private channel.

Do not test against systems, farms, accounts, or devices that you do not own or
have explicit permission to assess. Do not include live credentials in a proof
of concept.

## Security boundaries

The current local demo uses generated loopback-only credentials, SQLite, and
simulated devices. It does not claim:

- production authentication or tenant administration;
- production database scale, backup, or retention;
- MQTT or physical-device transport evidence;
- physical emergency-stop, interlock, or closed-loop safety;
- public-internet hardening of the local demo launcher.

Reports that cross these boundaries are still useful, but their severity must
not assume the simulator proves real-hardware impact.

## Repository safeguards

The repository keeps deterministic security checks inside the normal
verification path:

- common local credential files and private-key material are rejected;
- browser bundles are checked for demo-key leakage;
- GitHub Actions dependencies must use full commit SHAs;
- GitHub Actions and npm dependencies are monitored through Dependabot;
- CI uses read-only repository permissions and runs `npm run verify`.

Run the workflow-integrity check directly with:

```bash
npm run security:workflow-pins
```

Dependency advisories change over time and require network access, so run
`npm audit --audit-level=moderate` as a separate release preflight. These
checks reduce known risk; they are not a production-security certification.

## Handling expectations

Maintainers will acknowledge a private report when available, reproduce it,
assess affected boundaries, and coordinate a fix and disclosure plan. No fixed
response-time commitment is offered during the pre-release contest phase.
