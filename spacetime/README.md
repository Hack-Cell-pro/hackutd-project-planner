# FirstWave Spacetime module

`firstwave/src/index.ts` is the real backend: the same tables and reducers as `src/lib/engine.ts`,
which is the browser stand-in the preview uses today.

## Publish (needs your own Spacetime login)
```bash
curl -sSf https://install.spacetimedb.com | sh
spacetime login
cd spacetime/firstwave && spacetime init --lang typescript . # if no package.json yet, then keep src/index.ts
spacetime publish --server maincloud firstwave
spacetime generate --lang typescript --out-dir ../../src/module_bindings
```
Then in the app, replace each call in `src/lib/engine.ts` with `conn.reducers.<name>(...)` and `useRoom`
with table subscriptions (`conn.db.incident.onInsert/onUpdate`, etc.).

The SDK API changes between versions. If `index.ts` doesn't compile, match it to the version
`spacetime init` gives you. The table and reducer design stays the same.
