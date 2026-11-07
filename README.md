# Emoji Charades 🎭

A live party game for the whole room: one player gets a secret phrase and can only describe it
with **emojis** — everyone else races to guess on their phones. Fastest correct guess wins the
most points, and the cluer scores when someone cracks their clue.

Built for **HackUTD 2026 — Spacetime Main Track**. Every game rule runs inside **SpacetimeDB**:
the round clock, the emoji-only rule, guess checking, and scoring. The web app is just a window
into the database — every screen subscribes to it, so a clue sent from one phone appears on
every screen in the room instantly.

## How a round works

1. **Everyone joins** — open the link, type a name, done. The first player in becomes the host.
2. **The cluer gets a secret phrase** — something silly like "Talking while muted" or
   "Distracted boyfriend" — and describes it with emojis only (letters are rejected server-side).
3. **The room races to guess** — 60 seconds on the clock. A correct guess scores
   100 + a speed bonus; the cluer gets 50 when someone cracks it.
4. Everyone gets one turn as cluer, then the final leaderboard crowns the winner.

## Why Spacetime is the backend (not just chat)

| Rule | Where it runs |
| --- | --- |
| Round clock (clue 30s / guess 60s / reveal 8s) | Scheduled `tick` reducer inside SpacetimeDB |
| Emoji-only clues | `submit_clue` reducer rejects letters and numbers |
| Guess matching (case/punctuation/plural-insensitive) | `submit_guess` reducer, against a private phrase table |
| Speed scoring + cluer bonus | Computed in `submit_guess` where the data lives |
| Host-only start/reset, turn rotation | Enforced by reducers, not the UI |

## Architecture

```text
phones + laptops + big screen
        │  subscribeToAllTables() + reducer calls
        ▼
┌─────────────────────────────── SpacetimeDB (Maincloud) ───────────────────────────────┐
│ tables: player · game · phrase (private) · guess · event_log · tick_schedule           │
│ reducers: join · start_game · submit_clue · submit_guess · reset_game · tick (500ms)   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Run it

```bash
npm install
npm run dev
```

Open `/` to play, `/board` for the projector view.

## Publish the backend

```bash
cd spacetime/firstwave
npm install
spacetime publish --server maincloud firstwave
```

`src/lib/engine.ts` is a browser stand-in that mirrors the module reducer-for-reducer, so the
game is fully testable offline; `src/lib/live.ts` is the real Maincloud client with the same API.

## Tests

```bash
bunx vitest run                                  # app + game-rule tests (14)
cd spacetime/firstwave && bunx vitest run --config vitest.config.ts   # module tests in SpacetimeDB's runtime (5)
```

## Demo script (2 minutes)

1. Big screen on the projector, lobby showing players joining live from their phones.
2. Host starts — the cluer's phone shows the secret phrase, everyone else sees them "picking emojis".
3. Clue lands on every screen at once; guesses fly in; someone cracks it — scores update live.
4. Show the leaderboard, then reset and let the judges play a round themselves.
