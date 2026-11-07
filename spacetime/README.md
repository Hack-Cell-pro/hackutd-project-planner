# FirstWave Spacetime module

`src/index.ts` is the real backend: the same tables and reducers as `src/lib/engine.ts`,
which is the browser stand-in the preview uses today.

**Verified:** `tsc --noEmit` passes against `spacetimedb@2.14.1`, and `module.test.ts`
(5 rule tests: seed, report→assign→travel→resolve, escalation, validation/cancel, storm)
passes inside SpacetimeDB's own in-process test runtime.

## 1. Publish (needs your own Spacetime login)

```bash
# once: redeem the free Maincloud credit with code HACKUTD2026
#       at https://maincloud.spacetimedb.com
spacetime login                      # opens a browser

cd spacetime/firstwave
npm install                          # or: bun install
spacetime publish --server maincloud firstwave
spacetime generate --lang typescript --out-dir ../../src/module_bindings
```

`package.json` and `tsconfig.json` are already here, so publish won't fail with
"could not detect language" or "TsconfigNotFound".

## 2. Re-run the module tests (no server needed)

```bash
cd spacetime/firstwave && bunx vitest run --config vitest.config.ts
```

## 3. Wire the app to the live database

Tell Claude the publish succeeded. The swap is mechanical:

- `conn.reducers.join({ name, role })`, `conn.reducers.reportIncident({ ... })`,
  `conn.reducers.assignUnit({ incidentId, unitId })`, `claimUnit`, `resolveIncident`,
  `cancelIncident`, `triggerDisaster` — one per function in `src/lib/engine.ts`.
- `useRoom` becomes subscriptions: `conn.subscriptionBuilder().subscribeToAll()` plus
  `conn.db.incident.onInsert/onUpdate`, `conn.db.unit.onUpdate`, `conn.db.player.onInsert`,
  `conn.db.eventLog.onInsert`.
- Connect with `DbConnection.builder().withUri("wss://maincloud.spacetimedb.com").withDatabaseName("firstwave")`.

Reducer names are snake_case in the module and camelCase on the client
(`report_incident` → `conn.reducers.reportIncident`).

## Notes

- The clock is a `tick_schedule` row: `tick` queues the next tick every 500ms, so the
  escalation and travel rules keep running with no web server.
- If publish reports a compile error, it's an SDK version drift — paste it and the module
  gets matched to your version; the table and reducer design stays the same.
