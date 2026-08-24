# SmartFarmOS documentation

Use this page as the repository-local documentation index.

SmartFarmOS is pre-release and simulator-backed. These documents distinguish
automated local evidence from field, physical-device, production, legal, and
owner-reviewed evidence. Project-owned SmartFarmOS source is licensed under
Apache-2.0; third-party dependencies and materials retain their own licenses.

## Start here

- [Getting started](getting-started.md): install, run, verify, and troubleshoot
- [Architecture](architecture.md): components, boundaries, data flow, and risks
- [Feature parity](feature-parity.md): implemented behavior and remaining scope
- [Baseline](baseline.md): preserved legacy evidence and migration baseline

## Contracts and extension boundaries

- [Domain contracts](contracts/v1.md)
- [HTTP V1](contracts/http-v1.md)
- [Module manifest V1](contracts/module-manifest-v1.md)
- [Legacy parity map](contracts/legacy-parity-map.md)
- [Architecture decisions](decisions/)

## Deployment and operations

- [Raspberry Pi Edge agent and manual test boundary](deployment/raspberry-pi-edge.md)
- [Cloud pilot](deployment/cloud-pilot.md)
- [Cloud pilot checklist](deployment/cloud-pilot-checklist.md)
- [Weather provider](deployment/weather-provider.md)
- [External services](external-services.md)
- [Credential rotation](credential-rotation.md)

The cloud-pilot package is a contest/pilot boundary. It is not a production
security, availability, backup, or physical-device certification.

## Validation and contest evidence

- [Field-test checklist](testing/field-test-checklist.md)
- [Usability field-test protocol](usability/field-test-protocol.md)
- [Submission guide](submission/README.md)
- [Cloud productization and submission priorities](submission/cloud-productization-plan.md)
- [Public-release and contest gate checklist](submission/release-checklist.md)
- [Provenance review](provenance.md)

These documents distinguish simulator evidence from real-user, physical-device,
legal, licensing, and owner-reviewed evidence.

## Product and technical research

- [Research index](research/README.md)
- [SmartFarmOS research synthesis and decisions](research/smartfarm-research-synthesis.md)
- [Existing Priva One benchmark](benchmarks/priva-one.md)

Research documents use public sources to inform product and post-contest
decisions. They do not expand the verified product boundary or prove vendor,
standard, physical-device, or agronomic compatibility by themselves.

## Community

- [Contributing](../CONTRIBUTING.md)
- [Support](../SUPPORT.md)
- [Security](../SECURITY.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
