# Local Integrated Demo

Loopback-only composition of the Central API, SQLite store, Edge Gateways, and
two deterministic device simulators. It exists to exercise the real PWA data
and command path without external accounts, credentials, or physical hardware.

The CLI refuses to start unless `SMARTFARM_DEMO_MODE=1`. The repository launcher
creates an ephemeral operator demo guard key for the Vite proxy and separate
random internal keys for each Edge device. Edge identity is derived from its
key, not from client-selected role/principal headers, and no Edge key is exposed
through the runtime result, browser bundle, logs, or SQLite.

Run from the repository root:

```bash
npm run demo:local
```

For an isolated production-preview usability session, run `npm run verify`
once and then start a new anonymous code without deleting prior evidence:

```bash
npm run demo:usability -- S01
```

The launcher refuses to overwrite an existing session. Use `--resume` only for
the same interrupted session. The usability launcher keeps the normal 5-second
telemetry updates but delays the bed-2 recovery until 120 emissions (about ten
minutes), so the first participant task does not lose its active low-water
evidence while the participant is still orienting. This is a facilitator
scenario setting, not a production irrigation rule. Set
`SMARTFARM_DEMO_LOW_WATER_EMISSIONS` only when a documented rehearsal requires
a different local window.

Runtime defaults:

- Central API: `http://127.0.0.1:3100`
- PWA: `http://127.0.0.1:5173`
- Central API SQLite: `.smartfarm-demo.sqlite`
- Edge execution/ACK SQLite: `.smartfarm-demo.sqlite.edge.sqlite`
- farm: `farm:demo`
- primary device: `device:bed-1`
- secondary device: `device:bed-2`
- growing areas: `area:bed-1`, `area:bed-2`
- active crop cycle: `cycle:basil-2026`, assigned to both areas
- alarm rule: `alarm-rule:bed-2-low-water`, critical below 68% water level
- approved irrigation strategies: compatibility V1 pump-on and default V2
  five-second device-local timed run under `strategy:basil-recovery`

The runtime inserts its demo farm, two devices, two areas, active crop cycle,
and two example crops only when they are absent. Each device owns an independent
telemetry sequence and receives deterministic but visibly different values.
User-created or edited crop records survive restart and are never replaced by
the seed step.

The two primary database files are one restart boundary. Startup and
`demo:usability --resume` fail when only one file exists; use a fresh pair or a
reviewed recovery instead of combining new central state with an old Edge
journal. Do not delete only the Edge file because it may contain an ACK that has
not reached the central API.

Under `#operations`, the two areas are rendered in crop-cycle assignment order
with four latest values and recent trends each. The deterministic water-level
values make 2번 베드 visibly lower than 1번 베드. A pump command completed through
the selected device's Edge path remains visible in the same page's recent
control history, including during a same-session API outage.

When a direct manual pump command reaches a terminal ACK, the central store
also appends one AuditEvent V2 with no invented crop-cycle relation. The alarm
center explicitly opts into these rows and displays them as `농장 공통 제어`;
ACK replay does not create a duplicate.

The default 2번 베드 water-level sequence begins below the rule threshold,
updates the same active alarm on repeated accepted readings, and then recovers
above the threshold. In the PWA, acknowledge it under `#alarms`; the exact retry
is idempotent, one audit event remains, and the alarm moves to cleared history.

Under `#operations`, select one or both eligible beds and apply the default V2
strategy. The API creates one `smartfarm.command.v2` timed command per target
atomically. Each simulator turns itself off after five seconds, and both
Edge/simulator paths return ACKs only after the final state is `off`. The PWA shows the aggregate result plus
`command.completed` and `strategy.applied` audit records. Exact application
retries reuse the original result. The V1 strategy remains visible as
compatibility evidence and still has no automatic stop. The V2 timer is a
simulator/device-local behavior; it does not claim a physical interlock,
sensor-feedback control, durable physical firmware, or hardware safety proof.
Each device has an independent command poll/in-flight slot, so a timed run on
one bed does not delay a command waiting on another bed.

Before a simulator command starts, its Edge Gateway records the command in the
companion Edge database. After reaching its final state, the simulator invokes
the Edge terminal-ACK sink before its command promise resolves, so the ACK is
stored there before upload. If only
the upload fails, restarting the demo resends the exact ACK before polling the
central API and does not execute the simulator command again. If the process
stopped after the `executing` record but before a final ACK, the demo reports
that device-state reconciliation is required and does not automatically repeat
the timed run. This journal is completed-result delivery evidence, not a
physical-device restart or full offline-telemetry guarantee.

This is not a production authentication or deployment entrypoint.
