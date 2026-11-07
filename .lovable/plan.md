# HackUTD 2026 — Spacetime Plan (Both Tracks)

## Rules that shape everything
- Main track: Spacetime must power the app's **main features**, not just chat or player movement. Judges will check that the game rules and data live in Spacetime.
- Source code must be public on GitHub.
- ScrabbleBot is live at **10:45 PM Saturday**. Build the bot first, then put the rest of the weekend into the main app.
- Redeem the free Maincloud credit (code HACKUTD2026) before you start.

---

## Track 1 — Main App: "FirstWave", a live emergency dispatch room

**Pitch:** A multiplayer disaster-response command center. Callers report incidents on a live city map. Dispatchers assign units, and responders move units and close incidents. Every screen updates instantly, and all the dispatch logic runs inside Spacetime.

**Why it can win:** it does social good, the multiplayer demo is easy to show (open 3 laptops), and Spacetime does the real work: it assigns units, keeps the timers, escalates incidents and keeps score. That is exactly what the rule asks for.

### Roles (picked at join, no passwords)
- **Caller**: drops a pin, picks a type (fire / medical / flood / power) and severity, adds a short note.
- **Dispatcher**: sees incoming incidents ranked by priority and assigns available units.
- **Responder**: owns one unit, marks it en route / on scene / resolved.
- **Spectator / Judge view**: a big screen with a live map, stats and an activity feed.

### Core features (MVP, must ship)
1. Live city map (UTD/Richardson area) with incident pins colored by severity and unit markers.
2. Incident queue sorted by a priority score that Spacetime works out (severity + wait time).
3. Unit assignment, with checks inside Spacetime (a unit must be free, a dispatcher can't double-assign).
4. Automatic escalation: Spacetime raises the severity of incidents nobody has handled for 60s, and the change shows on every screen.
5. Unit status changes, plus a simulated travel ETA that counts down on Spacetime's timer.
6. Live stats: open incidents, average response time, units busy, plus a leaderboard of dispatcher scores.
7. Activity feed showing every action as it happens.

### Stretch features (if time allows)
- "Disaster mode" button: Spacetime creates a burst of incidents (a storm sweeps across the map).
- Replay timeline of the session, built from Spacetime's event log.
- AI triage: write a free-text note and AI suggests the type and severity.
- Sound and toast alerts when a critical incident comes in.

### Screens
- `/` landing: pitch, "Join as…" role picker, name input.
- `/room` main view: map on the left, role panel on the right.
- `/board` big-screen spectator dashboard for the demo.

### Visual direction
A dark "command center" look: near-black navy, signal orange for critical, amber for medium, teal for units. Monospace numbers, strong sans-serif headings, subtle animated pulse rings on new incidents.

### Demo script (2 min)
1. Show the big-screen board. 2. A teammate on a phone reports a fire, and it appears everywhere instantly. 3. The dispatcher assigns a unit, and the ETA counts down. 4. Leave one incident alone and it escalates by itself. 5. Hit Disaster mode. 6. Close with: "No web server, no websockets we wrote — all logic runs in Spacetime."

---

## Track 2 — ScrabbleBot
1. Get the TypeScript starter from scrabblebot.spacetimedb.com and read the auction rules carefully.
2. Strategy, in order of value:
   - Load a word list (for example, the ENABLE list) into a fast lookup.
   - Value each tile by how many high-scoring words it opens up given the tiles you already hold.
   - Bid on a tile only up to its value to you, minus a safety margin. Never overspend early, and keep track of opponents' budgets.
   - Play the highest-scoring word you can make each turn. Hold tiles only when the expected gain is clearly better.
3. Test against copies of your own bot with slightly different settings, and keep the version that wins most.
4. Freeze the code by 9:30 PM. Log every decision so you can debug during the live match.

---

## Weekend timeline
- Sat afternoon: set up Spacetime and Maincloud, get the ScrabbleBot starter running, and finish the FirstWave data design.
- Sat until 9:30 PM: bot strategy and tuning. In parallel, a teammate builds the FirstWave map and join flow.
- 10:45 PM: tournament.
- Overnight: FirstWave core features 1–5.
- Sun morning: stats, board, polish, stretch features, README, demo video, Devpost.

---

## Technical details (paste into the build prompt)

**Stack:** TanStack Start + React front end, Tailwind, and Leaflet for the map (loaded only in the browser). The backend is a SpacetimeDB module written in TypeScript (or Rust) and published to Maincloud. The front end connects with the `spacetimedb` TypeScript client SDK, using generated bindings. Do not use Lovable Cloud for app data: Spacetime is the backend.

**Tables**
- `player` (identity PK, name, role, score, online)
- `incident` (id, type, severity 1–5, lat, lng, note, status: open/assigned/en_route/on_scene/resolved, created_at, assigned_unit_id, reporter)
- `unit` (id, callsign, kind, lat, lng, status: available/en_route/on_scene, owner identity, eta_at)
- `event_log` (id, ts, actor, kind, payload) — feeds the activity list and the replay
- `escalation_schedule` / `travel_schedule` — scheduled tables for the timer actions

**Reducers (the server functions inside Spacetime)**
- `join(name, role)`, `report_incident(type, severity, lat, lng, note)`
- `assign_unit(incident_id, unit_id)` — checks the dispatcher role and that the unit is free, sets the ETA, schedules arrival
- `update_unit_status(unit_id, status)`, `resolve_incident(id)` — works out response time and updates the score
- `escalate_tick` (scheduled every 10s): raises severity of open incidents older than 60s
- `travel_tick` (scheduled): moves units toward their target and sets on_scene at the ETA
- `trigger_disaster(n)` (stretch)
- `client_connected` / `client_disconnected` lifecycle hooks set `online`

**Client:** subscribe to `SELECT * FROM incident/unit/player/event_log`, keep the React state in sync from row insert/update/delete callbacks, and call reducers for every action. Priority score is computed in a shared view or on the client as severity*10 + minutes waiting.

**Repo:** public GitHub, a README with an architecture diagram showing how much logic lives in Spacetime, a link to the Maincloud database, and a demo GIF.
