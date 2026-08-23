# Legacy Baseline

## Preserved Inputs

| Legacy path | Role | Migration use |
| --- | --- | --- |
| `../MyApp` | Expo/React Native user app | Feature-parity and mobile interaction reference |
| `../api/client` | React user web | Primary PWA migration reference |
| `../api/admin` | React administrator web | Admin-only behavior reference |
| `../api/server/server.js` | REST API on the legacy 5003 default | Endpoint and domain behavior reference |
| `../api/server/app.js` | Socket.IO/MQTT server on the legacy 5004 default | Realtime behavior reference |
| `../resberrypi/client` | Device-control UI | Duplicate/admin behavior review |
| `../resberrypi/server` | MQTT/Socket.IO bridge on the legacy 5005 default | Edge Gateway behavior reference |

## Confirmed Baseline Facts

- `SmartFarmOS/` was initialized as a new local `main` Git repository on
  2026-07-19 and connected to the private `chowonje/SmartFarmOS` origin. No
  commit or push was created during initialization.
- The parent folder and `../resberrypi` are not Git repositories.
- `../MyApp` and `../api` are separate repositories with existing dirty work that must not be flattened or overwritten.
- The legacy API has separate REST and realtime entrypoints.
- Device, farm, and sensor routes do not consistently apply one shared authentication boundary.
- Multiple legacy clients contain hardcoded endpoint locations.
- No physical GPIO/MCU firmware was found in the inspected Raspberry Pi source.
- The existing API test script does not run real tests.

## Canonical Verification Baseline

Before the M0/M1 module-kernel change, `npm run verify` passed on 2026-07-19.
It covered build, typecheck, unit tests, simulator/API/Edge/SQLite roundtrips,
PWA production build, and the existing browser smoke. This is the regression
floor for the module conversion.

## Public Release Gate

The legacy source scan is BLOCKED by local environment files, a Firebase service-account private key, and additional credential-like assignments requiring review. This canonical repository starts clean and must not import those files or values.
