# Device Simulator

The simulator emits deterministic telemetry and acknowledges or rejects commands using the same runtime contracts as physical devices. It is part of the contest-critical demo, not a test-only afterthought.

```bash
npm run build
npm run demo:simulator
```

The demo prints JSON events only. It does not connect to the network, database, or a real MQTT broker.

The simulator preserves immediate `smartfarm.command.v1` pump-state behavior
and also implements `smartfarm.command.v2` `run_pump_for` for `1..300` seconds.
For V2 it owns the timer, exposes `on` while the timer is active, returns to
`off` on success or timer failure, and acknowledges only the final state. Exact
in-flight replays share one execution in the process, while idempotency keys
remain scoped by actor like the central store. This is deterministic
simulator evidence, not durable firmware, a physical interlock, or a
real-hardware safety result.
