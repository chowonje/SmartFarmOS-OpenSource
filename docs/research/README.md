# SmartFarmOS research index

This directory contains public-source research that informs SmartFarmOS product,
architecture, interoperability, and post-contest decisions. Research findings do
not change the verified product boundary by themselves; a code or contract change
still requires a separate decision, implementation, and verification step.

## 2026-08-12 research snapshot

- 10 research and synthesis reports plus this index
- 219 unique public URLs after Markdown-aware duplicate removal
- 9 commercial greenhouse/CEA companies compared
- 14 SHA-pinned open-source implementations reviewed
- proprietary algorithms, private protocols, confidential material, and copied
  vendor UI/assets: 0

## Current research set

- [Commercial greenhouse and CEA landscape](commercial-landscape.md)
- [Greenhouse control and agronomy](control-agronomy.md)
- [Open standards, Edge reliability, and security](open-standards-edge-security.md)
- [Korean smart-farm standards and public data](korea-standards-and-data.md)
- [Standards and open-source validation](standards-validation.md)
- [Public datasets, simulation, and evaluation](datasets-simulation-evaluation.md)
- [Operator workflows and maintenance](operator-workflows-maintenance.md)
- [Greenhouse economics, KPIs, and product positioning](economics-kpi-product-positioning.md)
- [Open-source reference implementations](open-source-reference-implementations.md)
- [Cross-source synthesis and decisions](smartfarm-research-synthesis.md)
- Existing baseline: [Priva benchmark](../benchmarks/priva-one.md)

## Evidence grades

| Grade | Evidence type | How it is used |
| --- | --- | --- |
| A | Peer-reviewed research, normative standard, government technical plan | Supports technical or policy conclusions, subject to stated scope and version |
| B | Official manuals, API documentation, security papers, public terms | Supports product behavior and integration boundaries |
| C | Vendor product pages and official case studies | Supports only what the vendor publicly claims; not independent performance proof |
| D | Reputable secondary analysis | Used for discovery or context and cross-checked before a key claim |
| E | Forums, social posts, unverified summaries | Not used for decision-critical claims |

## Research rules

- Distinguish confirmed facts, evidence-backed inference, and open questions.
- Link major claims to the most direct available source.
- Prefer two independent sources for decisions that change safety, contracts, or architecture.
- Do not infer, extract, or reproduce proprietary algorithms, private APIs,
  protocols, UI assets, product wording, or confidential implementation details.
- Treat vendor efficacy statements as claims unless independent evidence confirms them.
- Keep SmartFarmOS simulator, HTTP Edge, and local SQLite evidence distinct from
  physical-device, MQTT, production-identity, and certified-safety evidence.
- Separate contest-before decisions from post-contest pilots to prevent research-driven scope expansion.
- Never send legacy source, credentials, environment files, private repository
  contents, or user data to external services.

## Decision vocabulary

- `adopt`: fits current boundaries and has enough evidence to act.
- `adapt`: useful principle, but the external shape should not become the internal model.
- `defer`: valuable only after a named gate or dependency.
- `reject`: creates unjustified complexity, risk, coupling, or unsupported claims.
