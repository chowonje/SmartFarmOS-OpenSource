# Edge Gateway

Current slice: a TypeScript Edge Gateway core and bounded HTTP client for:

- exchanging a ten-minute, single-use enrollment bearer token for an exact
  farm/device Edge key and storing it atomically in a private local file;
- loading that key into the daemon's central-API authorization header without
  printing it;
- validating and forwarding telemetry;
- pulling the next pending command for one device;
- rejecting expired or out-of-scope commands before device execution;
- converting device exceptions or invalid responses into failed acknowledgements;
- waiting for a V2 device-local timed run to finish and rejecting an
  acknowledged final state that does not match the command;
- storing command execution state before device dispatch;
- giving the device executor a terminal-ACK sink so the simulator commits its
  final result before its execution promise resolves;
- storing that exact terminal ACK before central upload and replaying a pending
  ACK before polling new work;
- refusing to repeat an `executing` command after restart when device state is
  unknown;
- returning validated terminal acknowledgements to the central API.

`EdgeExecutionRepository` has in-memory and versioned SQLite implementations.
The local demo selects SQLite and keeps it separate from the central API
database. A terminal result survives ACK upload failure and Edge restart; its
original `processedAt` and result are resent without another device call.
The gateway also retains that result if an executor unwinds after invoking the
sink. A production adapter must invoke the sink only after its actual terminal
state is known.

The gateway depends on a `DeviceCommandExecutor` interface. The simulator
implements that boundary in the integration smoke. An `executing` record without
a terminal device result deliberately becomes `recovery_required`; the Edge
does not assume whether a physical actuator started or stopped. Timed execution
itself is not durable across an unimplemented physical adapter, and competing
Edge owners are not coordinated. A real MQTT adapter, durable telemetry buffer,
device-state reconciliation, command lease, physical watchdog, and manual or
emergency stop remain pending.

The `smartfarm-edge` executable provides `enroll`, `credential-status`, `run`,
and the Pi-local `passwd --user <allowlisted-user>` command. Password input is
TTY-only, is sent directly to `/usr/sbin/chpasswd` without a shell, and never
crosses the central API. See
[Raspberry Pi Edge Agent](../../docs/deployment/raspberry-pi-edge.md) for the
install and configuration boundary.

Legacy reference: `../../resberrypi/server`.
