# SmartFarmOS Agent Guidance

## Project Shape

- Type: monorepo under staged construction
- Product: smart-farm IoT platform for the 2026 Open Source Developer Contest
- Target stack: React/TypeScript PWA, Node/TypeScript central API, Node/TypeScript Edge Gateway
- Verification entrypoint: `./scripts/verify.sh`

## Canonical Boundaries

- `apps/pwa/`: installable user experience for desktop and mobile.
- `apps/admin/`: separately authorized operations UI; it must not define user-product behavior.
- `services/api/`: the only browser-facing data and control authority.
- `services/edge/`: HTTP/device connectivity, durable completed-ACK recovery,
  and safe command execution; the MQTT adapter and telemetry offline buffering
  remain pending.
- `packages/contracts/`: shared `Farm`, `Device`, `Telemetry`, `Command`, and `CommandAck` contracts.
- `packages/module-sdk/`: reviewed module manifests, permission vocabulary, and static registry rules.
- `tools/device-simulator/`: hardware-independent end-to-end demo source.

The sibling folders `../MyApp`, `../api`, and `../resberrypi` are legacy source inputs. Preserve them. Do not move, delete, rewrite, or copy their environment files, service-account files, dependency folders, or generated builds into this repository.

## Commands

- Verify current repository safety and structure: `npm run verify`
- Run the integrated local API, Edge, simulator, and PWA: `npm run demo:local`
- Run the production PWA bundle against the local demo: `npm run demo:local:preview`
- Start an isolated Slice E participant session: `npm run demo:usability -- S01`
- Record one strict anonymous session result: `npm run usability:record -- S01`
- Aggregate strict anonymous session results: `npm run usability:summarize`
- Verify complete external dependency license declarations: `npm run submission:license-audit`
- Create a silent, unreviewed candidate from the real PWA demo: `npm run submission:video-draft`
- Verify a reviewed final video and create its local proof: `npm run submission:video-proof -- artifacts/submission/smartfarm-demo.mp4 --reviewed`
- Run the full Slice F release gate: `npm run submission:rehearse`
- Run only the PWA development server: `npm run dev:pwa` (the integrated launcher is preferred because it injects the local-only proxy guard).

## Working Rules

- Move one verified vertical slice at a time. Telemetry/pump, local catalog/crop
  operations, alarm acknowledgement/audit, and selected-cycle area
  comparison/control history, and approved irrigation preset application with
  ACK aggregation are complete; the contest plan proceeds to Slice E field
  usability testing and submission rehearsal. The anonymous session launcher,
  protocol, internal rehearsal, and target/repeat confirmation safeguards are
  ready. The default simulator strategy now uses an additive device-local
  five-second timed command and completes only after final `off`; compatibility
  V1 remains unchanged. The local Edge now journals execution and terminal ACK
  delivery in a separate SQLite file: completed ACKs replay before new polling,
  while a restart record left at `executing` must not be automatically rerun.
  An independent device-local software-stop lane lets V1 `off` interrupt the
  active timed simulator command, emits causal ACK V2 `manual_stop`, and keeps
  a durable fence against older activation commands. This is not a physical
  emergency stop, safety interlock, or real-device proof.
  Direct/manual terminal ACKs outside a strategy application emit exactly one
  unscoped AuditEvent V2 in the same central update. Default audit queries hide
  that additive version; reviewed clients opt in and label it farm-wide rather
  than assigning a false crop-cycle scope.
  This is not telemetry buffering, device-state reconciliation, a multi-owner
  lease, or physical exactly-once evidence. Internal QA does not count as the required 3–5
  participant sessions, and timed simulator behavior is not physical-interlock
  evidence. Production authentication/device inventory remain a separate pilot boundary.
- Write all new runtime code in TypeScript. Migrate legacy JavaScript incrementally when behavior is covered.
- Browser apps call the central API; they do not receive privileged database or device credentials.
- Built-in module code is statically reviewed. Imported farmer templates are data-only and cannot add executable entrypoints.
- Module implementations use injected platform services and never open SQLite, MQTT, or credential files directly.
- Every control command must be farm-scoped, device-scoped, authenticated, idempotent, time-bounded, and observable.
- Every Edge principal must carry trusted exact `(farmId, deviceId)` scopes;
  telemetry, normal/stop pull, and ACK handlers reject a client-selected device
  outside those scopes before touching the store. Local demo Edge keys are
  per-device, internal-only, and distinct from the shared operator demo key.
- Edge control defaults to a safe state when connectivity or validation fails.
- Keep administrator authorization separate from the user PWA even when UI packages are shared.
- Preserve prior-project and public-support provenance. Never describe migrated legacy behavior as entirely new work.
- Do not add production dependencies, cloud services, or a GitHub remote without an explicit reviewed need.

## Sensitive Data

- Never copy real `.env` values or `serviceAccountKey.json` from the legacy folders.
- Keep secret values server-side and local-only. Public configuration must be explicitly classified.
- Do not print credentials during diagnosis or verification.
- A public release remains blocked until credentials reachable from the public
  release are rotated or excluded, and every privacy-scan BLOCK candidate is
  either remediated as a real secret or documented as a reviewed false positive
  with owner acceptance. Missing optional model scanning remains a disclosed
  WARN, never a privacy PASS.

## Verification

- Run `./scripts/verify.sh` before calling a non-trivial change complete.
- Add workspace-specific lint, typecheck, test, build, and end-to-end commands as those workspaces become runnable.
- Record changed files, commands run, results, and unverified hardware behavior in the completion report.
