# SmartFarmOS Field Test Checklist

Current pre-release boundary: SmartFarmOS can be field-tested as a simulator-backed browser flow and as a Raspberry Pi enrollment/service flow. It does **not** yet prove GPIO, relay, sensor, MQTT, emergency-stop, interlock, or physical actuator safety.

## Prerequisites

- Use only the local demo, simulator, and a non-production Raspberry Pi.
- Do not connect a real pump, valve, or relay load to claim this checklist passed.
- Never put enrollment tokens, `edgeKey`, Linux passwords, or any secret value in:
  notes, screenshots, shell history, environment variables, process arguments, or Git-tracked files.
- Record only date, tester code, device used, pass/fail, and a short non-secret observation.
- If browser checks are in scope, have Node.js 24, npm 10+, and Chrome/Chromium available.

## A. Simulator / Browser Acceptance (can run now)

Run:

```bash
npm ci
npm run verify
npm run demo:local:preview
```

Open:

- User PWA: `http://127.0.0.1:4173`
- Admin UI: `http://127.0.0.1:4174`

Pass this section only if all items are true:

- The PWA loads on loopback and shows two growing areas.
- A low-water alarm is visible for the simulator scenario.
- The operator can find the affected area, explain the cause, and acknowledge the alarm.
- The reviewed irrigation preset can be applied only after the explicit confirmation step.
- The final command result and audit/history evidence appear after completion.
- The browser flow stays simulator-only; no step asks for a real device credential or Linux password.

Required evidence:

- `npm run verify` passed.
- Date/time of the check.
- One privacy-safe screenshot or short note that names the screen and result, not a person.

Hard rule: a pass here proves only the browser and simulator contract. It must **not** be described as proof of relay behavior, emergency stop, interlock behavior, irrigation safety, or physical crop protection.

## B. Raspberry Pi Enrollment / Credential / Service Test (can run on Pi now, with no real actuator)

The current demo API binds to loopback only. For this rehearsal, run the demo on
the **same Raspberry Pi** as the Edge service. Do not rebind the demo to a LAN
interface just to make this checklist easier.

On the Pi, prepare the documented Edge install:

```bash
npm ci
npm run build
(cd services/edge && sudo npm link)
sudo adduser --system --group --home /var/lib/smartfarm-edge --no-create-home smartfarm-edge
sudo install -d -o root -g root -m 755 /etc/smartfarm-edge
sudo install -d -o smartfarm-edge -g smartfarm-edge -m 700 /var/lib/smartfarm-edge
sudo install -o root -g root -m 644 deploy/edge/config.example.json /etc/smartfarm-edge/config.json
```

Then start the local demo in a separate Pi terminal and leave it running:

```bash
npm run demo:local
```

Before enrollment:

- Set `apiUrl` to `http://127.0.0.1:3100`, then confirm `farmId` and `deviceId`
  exactly match the device shown in the admin UI.
- Open the admin UI at `http://127.0.0.1:5174` in a Pi-local browser. If the Pi
  is headless, use an SSH local-port forward from the workstation; keep the
  demo itself bound to loopback.
- Issue the one-time enrollment token from that separate admin UI.
- Do not paste that token into a command, environment variable, or notes.

Run the Pi-side checks:

```bash
sudo -u smartfarm-edge smartfarm-edge enroll --config /etc/smartfarm-edge/config.json
sudo -u smartfarm-edge smartfarm-edge credential-status --config /etc/smartfarm-edge/config.json
sudo install -m 644 deploy/edge/smartfarm-edge.service.example /etc/systemd/system/smartfarm-edge.service
sudo systemctl daemon-reload
sudo systemctl enable --now smartfarm-edge.service
```

Optional local-only password check, only if the test plan explicitly includes it:

```bash
sudo smartfarm-edge passwd --user smartfarm
```

Pass this section only if all items are true:

- Enrollment succeeds through the hidden prompt, not through argv or environment variables.
- `credential-status` shows non-secret metadata and does not print `edgeKey`.
- The service starts from the reviewed config and credential paths.
- No browser flow ever asks for, stores, or changes a Linux password.
- No real actuator is wired or claimed to be controlled.

Required evidence:

- Date/time, Pi hostname or tester code, and pass/fail.
- Non-secret note that enrollment, credential readout, and service start all completed.

## C. Network Loss / Restart / Revocation Tests (partially blocked for field evidence)

The automated contract and runtime tests run under `npm run verify`. On a real
Pi, the current loopback rehearsal can prove local credential persistence and
service restart only. It cannot yet produce complete, non-secret field evidence
for a remote network outage or rejected revoked credential.

### Network loss

- Record `BLOCKED` for a real network-loss claim. The demo API and Edge service
  share the Pi's loopback interface, so disconnecting the LAN does not interrupt
  their path.
- Unblock this only with a reviewed, reachable TLS test backend and an observable
  non-secret connection status or sanitized operator log.

### Restart

- Start from a passed Section B setup.
- Restart the Pi or the Edge service using the team's normal local operator method.
- After it comes back, re-run:

```bash
sudo -u smartfarm-edge smartfarm-edge credential-status --config /etc/smartfarm-edge/config.json
sudo systemctl is-active smartfarm-edge.service
```

- Confirm the credential metadata is still readable and the service is active.
- Record this only as a Pi process/credential restart pass. Command replay and
  duplicate-result behavior remain covered by automated tests until the daemon
  exposes safe field diagnostics.

### Revocation

- In the admin UI at `http://127.0.0.1:5174`, revoke the active Edge credential for that Pi.
- Confirm the admin UI shows that credential as revoked.
- Record direct Pi-side proof that the old key was rejected as `BLOCKED`: the
  current daemon does not expose a non-secret connection-status command or
  sanitized authentication failure log.
- Stop the service, re-enroll with a fresh one-time token, and start it again:

```bash
sudo systemctl stop smartfarm-edge.service
sudo -u smartfarm-edge smartfarm-edge enroll --config /etc/smartfarm-edge/config.json
sudo -u smartfarm-edge smartfarm-edge credential-status --config /etc/smartfarm-edge/config.json
sudo systemctl start smartfarm-edge.service
```

Stop and investigate if any of these occur:

- A blocked field claim is reported as passed.
- A restart causes an older activation to be described as newly executed without evidence.
- A tester writes down a token, `edgeKey`, or password.

## D. Physical Sensor / Relay Test (blocked until a hardware adapter exists)

This section is intentionally blocked today.

Do **not** claim completion for:

- GPIO relay switching
- sensor reads or calibration
- MQTT transport
- physical timed run accuracy
- hardwired emergency stop or safety interlock behavior

Reason: the current repository documents no real Raspberry Pi hardware adapter yet. A reviewed real-device `DeviceCommandExecutor` integration and separate physical safety validation are still missing.

Required evidence today:

- Record `BLOCKED` with date and tester code.
- Link the blocker to the missing real hardware adapter, not to simulator failure.

## E. 3-5 Person Usability Sessions and Privacy-Safe Evidence

Run the participant session flow exactly from the local docs:

```bash
npm run verify
npm run demo:usability -- S01
npm run usability:record -- S01
npm run usability:summarize
```

Session rules:

- Collect 3 to 5 real participants.
- Prefer at least 2 current or recent agricultural operators; otherwise clearly label domain-proxy participants.
- Do not count developers who built the system.
- Use only session codes such as `S01` to `S05`.
- Do not record names, phone numbers, farm names, account IDs, faces, or secret values.
- Use a new session DB each time; use `--resume` only for the same interrupted session.
- Default evidence is de-identified notes plus the strict result JSON, not raw personal recordings.

Minimum task set per participant:

1. Find the area that needs attention.
2. Explain which metric is abnormal and since when.
3. Acknowledge the alarm.
4. Apply the reviewed irrigation preset to the correct area.
5. Confirm the command result and who/when processed it.

Stop the whole field-test track if any participant session shows:

- wrong-area submission,
- duplicate submission while pending,
- real-device or production-credential use,
- false claim that the five-second simulator stop proves physical safety.

## F. Stop / Go Criteria and Evidence Table

Overall decision:

- `GO for simulator-backed demo and Pi enrollment/service rehearsal` only if A,
  B, and E pass, the restart portion of C passes, and the remaining C/D limits
  stay clearly marked `BLOCKED`.
- `NO-GO for remote outage or Pi-side revocation field claims` until C has a
  reachable TLS test backend and safe observable diagnostics.
- `NO-GO for any real actuator or safety claim` until D is unblocked by a reviewed hardware adapter and separate physical validation.

Immediate stop conditions:

- Any secret value is written down or exposed.
- Any blocked result is reported as passed.
- Any restart is described as proving command replay behavior without observable evidence.
- Any participant sends a command to the wrong area.
- Any report describes simulator evidence as physical safety evidence.

| Area | Minimum evidence | Go only when | Stop / no-go when |
| --- | --- | --- | --- |
| A. Simulator/browser | `npm run verify` pass, local browser note/screenshot | Full local browser flow works on loopback | Alarm/control/audit path is broken |
| B. Pi enrollment/service | Non-secret enrollment note, `credential-status` pass, service start note | Pi enrolls, stores credential privately, and starts service | Token/password handling is unsafe or service cannot start |
| C. Network/restart/revocation | Restart evidence plus explicit `BLOCKED` entries for unavailable field checks | Credential/service restart passes; network and Pi-side revocation proof stay blocked | A blocked claim is reported as passed or restart evidence is overstated |
| D. Physical relay/sensor | `BLOCKED` entry only | Not applicable yet | Anyone marks this as passed without a real adapter |
| E. Usability sessions | 3-5 coded sessions, result JSONs, summary output | Required participant count and safety rules are met | Too few participants, privacy breach, or any safety guardrail violation |

Recommended storage for evidence:

- local `artifacts/usability/` outputs for participant sessions,
- one separate local field-test log with only date, tester code, device, section, pass/fail, and non-secret notes.
