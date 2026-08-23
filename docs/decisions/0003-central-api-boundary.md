# Decision 0003: Injectable, Fail-Closed Central API Boundary

- Status: accepted for the in-memory vertical slice
- Date: 2026-07-17

## Context

The legacy backend exposes separate REST and realtime entrypoints with inconsistent authentication and farm scope. The new vertical slice needs real HTTP behavior without prematurely choosing production identity or database providers.

## Decision

Use Fastify 5 for a TypeScript application factory with:

- a mandatory injected authentication function;
- no unauthenticated listening server entrypoint;
- explicit role and farm authorization per route;
- Zod contract parsing at request and response boundaries;
- a bounded 64 KiB JSON body limit;
- sanitized versioned errors;
- an in-memory store behind a replaceable class boundary;
- Fastify injection for deterministic route tests.

## Consequences

- The HTTP contract and failure behavior can be verified before adding network deployment or credentials.
- A production server cannot accidentally start with an implicit allow-all authenticator.
- The store is not durable and is not evidence for database, concurrency, or restart behavior.
- A later authentication adapter and persistent repository must preserve the same route contract or introduce an explicit new version.

Decision 0014 later tightens the internal authentication context so every Edge
principal carries trusted exact farm/device scopes. The public route wire stays
unchanged.
