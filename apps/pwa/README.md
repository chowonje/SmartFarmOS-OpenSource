# User PWA

Installable React/TypeScript user experience expanded one verified vertical slice at a time.

## Implemented

- authenticated farm/device discovery and a selection that survives reload;
- latest temperature, humidity, illuminance, and water level from Central API HTTP V1;
- per-metric cached last-known telemetry when the network is unavailable;
- pump on/off command creation and terminal status polling;
- contract-validated restoration of the last command and pump state after reload;
- selected-cycle comparison of both assigned areas across four latest values
  and their bounded recent 24-point histories;
- farm-scoped recent command results filtered to the selected cycle's
  representative devices;
- explicit loading, freshness, stale, empty, error, online, offline, and
  command lifecycle states;
- responsive desktop/mobile layout;
- seven focused deep links in a responsive application shell:
  - `#overview`: scope summary and page entry points only;
  - `#operations`: active crop-cycle selection, two-area telemetry comparison,
    active-alarm summary, approved irrigation strategy application with
    per-target/aggregate results, assigned area cards, and recent control results;
  - `#alarms`: active alarms, cleared history, acknowledgement, and audit records;
  - `#crops`: persisted crop journal and CRUD;
  - `#control`: pump control and command acknowledgement;
  - `#environment`: real temperature, humidity, illuminance, and water level plus clearly unconnected water-temperature state;
  - `#weather`: weather/location design shell, explicitly marked as not integrated;
- farm-scoped crop list, create, edit, and delete with explicit loading, empty,
  validation, submission, and error states;
- crop-operations alarm summary plus farm/cycle-scoped alarm and audit polling;
- approved-strategy loading, eligible-area selection, idempotent application,
  and resumable result polling. Accepted pending work remains visible and cannot
  be submitted again or have its strategy/targets changed after a transient
  status-read failure. Each target shows
  recent water-level/low-water-alarm evidence, and application requires an
  explicit selected-target/timed-device/physical-safety-boundary confirmation
  that resets after submit;
- web app manifest, 192/512/maskable icons, and a build-generated offline app shell that precaches hashed JS/CSS assets.

The browser never owns the local demo guard key. `vite.config.ts` injects it only inside the loopback development proxy. A deployed PWA should use `PUBLIC_API_BASE_URL` or a same-origin `/api` reverse proxy with a production authentication adapter.

The default V2 demo strategy exposes its five-second device-local timer and
waits for final `off` before completion. The compatibility V1 pump-on strategy
still has no automatic stop. Neither path claims closed-loop safety, a physical
interlock, or real-hardware verification. The weather/location page and water-temperature row remain interface structure
only. They display `연동 전` and `--`; the PWA does not invent values or call an
unimplemented provider. Environment values come from the validated local-demo
device path; physical MQTT sensor input remains a separate gate.

## Run

From the repository root:

```bash
npm run demo:local
```

Open `http://127.0.0.1:5173`. To test the production bundle and install prompt, run:

```bash
npm run demo:local:preview
```

Open `http://127.0.0.1:4173`.

## Verify

```bash
npm run typecheck --workspace=@smartfarm-os/pwa
npm run test --workspace=@smartfarm-os/pwa
npm run build --workspace=@smartfarm-os/pwa
npm run smoke:pwa
npm run smoke:pwa:browser
```

The browser smoke uses an installed Chrome/Chromium when available. Set `CHROME_PATH` to a non-standard executable or `SMARTFARM_REQUIRE_BROWSER=1` to make absence a hard failure.

Legacy parity references remain `../../api/client` first and selected checks
against `../../MyApp`. Production login, device-inventory mutations, realtime
delivery, and the remaining capabilities in `../../docs/feature-parity.md` are
not yet implemented.
