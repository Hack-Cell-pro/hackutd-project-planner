# FirstWave — live emergency dispatch, powered by SpacetimeDB

**HackUTD 2026 · Spacetime track**

FirstWave is a multiplayer disaster-response command center. Callers drop pins on a live
city map, dispatchers assign units from a self-ranking priority queue, and responders crew
units and close calls. Every screen updates instantly — and every rule of the game runs
**inside SpacetimeDB**, not in a web server we wrote.

## Why Spacetime is the backend, not a sidecar

All dispatch logic lives in the Spacetime module (`spacetime/firstwave/src/index.ts`):

| Rule | Where it runs |
| --- | --- |
| Only dispatchers can assign units; a busy unit can't be double-sent | `assign_unit` reducer |
| Incidents ignored for 60s raise their own severity | scheduled `tick` reducer (every 500ms) |
| Units travel toward their target and arrive on a live ETA | scheduled `tick` reducer |
| Response-time scoring and dispatcher half-credit | `resolve_incident` reducer |
| Storm cells that flood the map with incidents | `trigger_disaster` reducer |
| Presence (who's online) | `client_connected` / `client_disconnected` hooks |

The front end holds no game state of its own — it subscribes to tables and calls reducers.

```text
 phone (caller)        laptop (dispatcher)       big screen (judges)
      │                       │                        │
      └───────────┬───────────┴────────────────────────┘
                  │   WebSocket subscriptions + reducer calls
                  ▼
        ┌───────────────────────┐
        │      SpacetimeDB      │
        │  ┌─────────────────┐  │
        │  │ tables: player, │  │
        │  │ incident, unit, │  │
        │  │ event_log, tick │  │
        │  └─────────────────┘  │
        │  reducers: join,      │
        │  report_incident,     │
        │  assign_unit,         │
        │  claim_unit,          │
        │  resolve_incident,    │
        │  cancel_incident,     │
        │  trigger_disaster,    │
        │  tick (scheduled)     │
        └───────────────────────┘
```

## Run it

```bash
npm install
npm run dev
```

Open `/` to join as a caller, dispatcher or responder, and `/board` for the big-screen view.

## Publish the Spacetime module

```bash
curl -sSf https://install.spacetimedb.com | sh
spacetime login
cd spacetime/firstwave
spacetime publish --server maincloud firstwave
spacetime generate --lang typescript --out-dir ../../src/module_bindings
```

The app ships with a browser stand-in (`src/lib/engine.ts`) that mirrors every reducer
name and rule one-to-one, so swapping in the generated bindings is mechanical.

## Demo script (2 minutes)

1. Open `/board` on the big screen.
2. A teammate reports a fire from their phone — it appears everywhere instantly.
3. The dispatcher assigns the nearest unit; the ETA counts down live.
4. Leave one incident untouched — it escalates by itself after 60 seconds.
5. Hit **Disaster mode** and watch the room scramble.
6. Close with: "No web server, no websockets we wrote — all logic runs in Spacetime."

## Built with

TanStack Start · React · Tailwind CSS · SpacetimeDB (TypeScript module)
