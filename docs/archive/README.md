# Archived implementation references

Files in this directory are non-runtime snapshots retained to explain a
specific architecture transition. They are not compiled, imported, or treated
as an alternative application entrypoint.

- `api-app-pre-module-kernel.ts.txt`: the pre-M1 single-file API registrar that
  was previously stored as the duplicate `services/api/src/app 2.ts`. The
  active implementation is the module registry and server entrypoints under
  `services/api/src/`.
