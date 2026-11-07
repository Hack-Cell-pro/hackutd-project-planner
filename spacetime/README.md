# Publishing the Emoji Charades module

The module in `firstwave/` is the real backend: tables, reducers, and the scheduled game clock.
The web app talks to it through the generated client in `src/module_bindings`.

## Publish (from your laptop)

```bash
git pull                       # get the latest module code
cd spacetime/firstwave
npm install
spacetime publish --server maincloud firstwave
```

The module changed since the last publish (new tables), so Spacetime will warn that existing
data must be cleared — confirm with `y`. Old game data is throwaway test data.

## Re-run the module tests

```bash
cd spacetime/firstwave
bunx vitest run --config vitest.config.ts
```

5 tests run the real module code against SpacetimeDB's in-process test runtime — no server needed.
(Multi-player round flow is covered by `src/test/engine.test.ts`, which mirrors these reducers.)

## If you change the module

1. Keep `src/lib/engine.ts` (the browser stand-in) in sync — same reducer names, same rules.
2. Regenerate the client bindings:

```bash
spacetime generate --lang typescript --out-dir ../../src/module_bindings
```

3. Republish with the command above.
