// Emoji Charades SpacetimeDB module (TypeScript, SDK 2.x).
// Every game rule runs here: round order, the clocks, emoji-only validation, guess
// checking, and scoring. Mirrors src/lib/engine.ts reducer-for-reducer.
import { schema, table, t, SenderError, ScheduleAt } from "spacetimedb/server";

const Player = table({ name: "player", public: true }, {
  identity: t.identity().primaryKey(),
  name: t.string(),
  score: t.u32(),
  online: t.bool(),
  isHost: t.bool(),
});

// One row (id 1): the shared game state every screen subscribes to.
const Game = table({ name: "game", public: true }, {
  id: t.u64().primaryKey(),
  phase: t.string(), // lobby | clue | guess | reveal | final
  round: t.u32(),
  totalRounds: t.u32(),
  cluer: t.option(t.identity()),
  cluerName: t.string(),
  phrase: t.string(), // shown only to the cluer in the UI (honor system)
  clue: t.string(),   // the emoji clue, visible to everyone once submitted
  phaseEndsAt: t.u64(), // ms since epoch; 0 = no deadline
  winnerName: t.string(),
});

// The phrase deck. Private: clients never subscribe to it, so answers stay server-side.
const Phrase = table({ name: "phrase", public: false }, {
  id: t.u64().primaryKey().autoInc(),
  text: t.string(),
  used: t.bool(),
});

const Guess = table({ name: "guess", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  player: t.identity(),
  playerName: t.string(),
  round: t.u32(),
  text: t.string(),
  correct: t.bool(),
  answeredAt: t.u64(), // ms since epoch
  points: t.u32(),
});

const EventLog = table({ name: "event_log", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  ts: t.timestamp(),
  actor: t.string(),
  kind: t.string(),
  text: t.string(),
});

// The clock. One row = one scheduled tick. Rows are deleted automatically
// after the scheduled reducer runs, so `tick` queues the next one itself.
const Tick = table({ name: "tick_schedule", public: false }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const spacetimedb = schema({
  player: Player,
  game: Game,
  phrase: Phrase,
  guess: Guess,
  eventLog: EventLog,
  tickSchedule: Tick,
});

const TICK_EVERY = 500_000n; // microseconds -> 2 ticks per second
const CLUE_MS = 30_000;   // cluer has 30s to send emojis
const GUESS_MS = 60_000;  // room has 60s to guess
const REVEAL_MS = 8_000;  // answer shown for 8s

const nowMs = (ctx: any) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

const log = (ctx: any, actor: string, kind: string, text: string) =>
  ctx.db.eventLog.insert({ id: 0n, ts: ctx.timestamp, actor, kind, text });

const me = (ctx: any) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new SenderError("Join first");
  return p;
};

const game = (ctx: any) => {
  const g = ctx.db.game.id.find(1n);
  if (!g) throw new SenderError("Game not initialized");
  return g;
};

const queueTick = (ctx: any) =>
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_EVERY) });

// Guesses match on normalized text: lowercase, letters/numbers only, trailing "s" forgiven.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const matches = (guess: string, phrase: string) => {
  const a = norm(guess), b = norm(phrase);
  if (a === b) return true;
  const strip = (w: string) => w.split(" ").map((x) => (x.length > 3 && x.endsWith("s") ? x.slice(0, -1) : x)).join(" ");
  return strip(a) === strip(b);
};

// Emojis only: reject anything with letters or digits so the cluer can't spell the answer.
const isEmojiOnly = (s: string) => s.length > 0 && s.length <= 24 && !/[a-zA-Z0-9]/.test(s);

const PHRASES = [
  // Silly everyday situations
  "Pizza at 3am", "Monday morning", "Talking while muted", "Fighting a fitted sheet",
  "Searching for Wi-Fi", "Stepping on a LEGO", "Waiting for the microwave", "Awkward small talk",
  "Running for the bus", "Untangling headphones", "Bad haircut", "Group project",
  "Job interview", "Dance party", "Road trip", "Coffee addict",
  // Meme classics
  "This is fine", "Distracted boyfriend", "Woman yelling at a cat", "Vibe check",
  "Doom scrolling", "Main character energy", "Touch grass", "Skill issue",
  "Side quest", "Girl dinner", "Rizz", "Delulu",
  "No cap", "Understood the assignment", "NPC energy", "Brain rot",
];

export const init = spacetimedb.init((ctx) => {
  for (const text of PHRASES) ctx.db.phrase.insert({ id: 0n, text, used: false });
  ctx.db.game.insert({
    id: 1n, phase: "lobby", round: 0, totalRounds: 0, cluer: undefined, cluerName: "",
    phrase: "", clue: "", phaseEndsAt: 0n, winnerName: "",
  });
  queueTick(ctx);
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: true });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: false });
});

export const join = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.trim().slice(0, 16);
  if (!clean) throw new SenderError("Name required");
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, name: clean, online: true });
    return;
  }
  // The first player in the room becomes the host.
  let any = false;
  for (const _ of ctx.db.player.iter()) { any = true; break; }
  ctx.db.player.insert({ identity: ctx.sender, name: clean, score: 0, online: true, isHost: !any });
  log(ctx, clean, "join", `${clean} joined${any ? "" : " as host"}`);
});

// Players in join order; the cluer for round r is players[r % players.length].
const playersInOrder = (ctx: any) => {
  const ps: any[] = [];
  for (const p of ctx.db.player.iter()) ps.push(p);
  return ps.sort((a, b) => (a.identity.toHexString() < b.identity.toHexString() ? -1 : 1));
};

const pickPhrase = (ctx: any) => {
  const fresh: any[] = [];
  for (const ph of ctx.db.phrase.iter()) if (!ph.used) fresh.push(ph);
  if (fresh.length === 0) {
    for (const ph of ctx.db.phrase.iter()) ctx.db.phrase.id.update({ ...ph, used: false });
    for (const ph of ctx.db.phrase.iter()) fresh.push(ph);
  }
  const pick = fresh[Math.floor(ctx.random() * fresh.length)];
  ctx.db.phrase.id.update({ ...pick, used: true });
  return pick.text;
};

const startRound = (ctx: any, g: any, round: number) => {
  const players = playersInOrder(ctx);
  if (players.length === 0) throw new SenderError("No players");
  const cluer = players[round % players.length];
  const now = nowMs(ctx);
  ctx.db.game.id.update({
    ...g, phase: "clue", round, cluer: cluer.identity, cluerName: cluer.name,
    phrase: pickPhrase(ctx), clue: "", phaseEndsAt: BigInt(now + CLUE_MS), winnerName: "",
  });
  log(ctx, "GAME", "round", `Round ${round + 1}: ${cluer.name} is picking emojis`);
};

export const start_game = spacetimedb.reducer({}, (ctx) => {
  const p = me(ctx);
  if (!p.isHost) throw new SenderError("Only the host can start the game");
  const g = game(ctx);
  if (g.phase !== "lobby" && g.phase !== "final") throw new SenderError("Game already running");
  const players = playersInOrder(ctx);
  if (players.length < 2) throw new SenderError("Need at least 2 players");
  // Everyone gets one turn as cluer (capped at 8 rounds).
  const total = Math.min(players.length, 8);
  ctx.db.game.id.update({ ...g, totalRounds: total });
  startRound(ctx, { ...g, totalRounds: total }, 0);
});

export const submit_clue = spacetimedb.reducer({ clue: t.string() }, (ctx, { clue }) => {
  const p = me(ctx);
  const g = game(ctx);
  if (g.phase !== "clue") throw new SenderError("Not the clue phase");
  if (!g.cluer || !g.cluer.isEqual(ctx.sender)) throw new SenderError("You are not the cluer");
  const clean = clue.trim();
  if (!isEmojiOnly(clean)) throw new SenderError("Emojis only — no letters or numbers");
  const now = nowMs(ctx);
  ctx.db.game.id.update({ ...g, phase: "guess", clue: clean, phaseEndsAt: BigInt(now + GUESS_MS) });
  log(ctx, p.name, "clue", `${p.name} sent the clue: ${clean}`);
});

export const submit_guess = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const p = me(ctx);
  const g = game(ctx);
  if (g.phase !== "guess") throw new SenderError("No clue to guess yet");
  if (g.cluer && g.cluer.isEqual(ctx.sender)) throw new SenderError("The cluer can't guess");
  const clean = text.trim().slice(0, 60);
  if (!clean) throw new SenderError("Empty guess");
  const now = nowMs(ctx);
  const correct = matches(clean, g.phrase);
  const roundStart = Number(g.phaseEndsAt) - GUESS_MS;
  const pts = correct ? 100 + Math.max(0, 120 - Math.floor((now - roundStart) / 500) * 2) : 0;
  ctx.db.guess.insert({
    id: 0n, player: ctx.sender, playerName: p.name, round: g.round,
    text: clean, correct, answeredAt: BigInt(now), points: pts,
  });
  if (correct) {
    ctx.db.player.identity.update({ ...p, score: p.score + pts });
    // The cluer scores when someone cracks their clue.
    const cluer = ctx.db.player.identity.find(g.cluer);
    if (cluer) ctx.db.player.identity.update({ ...cluer, score: cluer.score + 50 });
    ctx.db.game.id.update({ ...g, phase: "reveal", phaseEndsAt: BigInt(now + REVEAL_MS), winnerName: p.name });
    log(ctx, "GAME", "correct", `${p.name} got it: "${g.phrase}" (+${pts})`);
  } else {
    log(ctx, p.name, "guess", `${p.name} guessed "${clean}"`);
  }
});

export const reset_game = spacetimedb.reducer({}, (ctx) => {
  const p = me(ctx);
  if (!p.isHost) throw new SenderError("Only the host can reset");
  const g = game(ctx);
  ctx.db.game.id.update({
    ...g, phase: "lobby", round: 0, totalRounds: 0, cluer: undefined, cluerName: "",
    phrase: "", clue: "", phaseEndsAt: 0n, winnerName: "",
  });
  for (const gu of ctx.db.guess.iter()) ctx.db.guess.id.delete(gu.id);
  for (const pl of ctx.db.player.iter()) ctx.db.player.identity.update({ ...pl, score: 0 });
  log(ctx, "GAME", "reset", `${p.name} reset the room — back to the lobby`);
});

// Advance to the next round, or end the game when every round is done.
const advance = (ctx: any, g: any) => {
  const next = Number(g.round) + 1;
  if (next >= Number(g.totalRounds)) {
    ctx.db.game.id.update({ ...g, phase: "final", phaseEndsAt: 0n, clue: "", phrase: "" });
    log(ctx, "GAME", "final", "That's the game! Check the leaderboard.");
  } else {
    startRound(ctx, g, next);
  }
};

// The heartbeat: enforces every phase deadline. Queues the next tick first.
export const tick = spacetimedb.reducer(
  { onSchedule: Tick },
  { arg: Tick.rowType },
  (ctx) => {
    queueTick(ctx);
    const g = ctx.db.game.id.find(1n);
    if (!g || g.phaseEndsAt === 0n) return;
    const now = nowMs(ctx);
    if (now <= Number(g.phaseEndsAt)) return;

    if (g.phase === "clue") {
      // Cluer ran out of time — skip their turn.
      log(ctx, "GAME", "skip", `${g.cluerName} ran out of time — skipping`);
      advance(ctx, g);
    } else if (g.phase === "guess") {
      // Nobody cracked it.
      ctx.db.game.id.update({ ...g, phase: "reveal", phaseEndsAt: BigInt(now + REVEAL_MS), winnerName: "" });
      log(ctx, "GAME", "reveal", `Time! Nobody got it — it was "${g.phrase}"`);
    } else if (g.phase === "reveal") {
      advance(ctx, g);
    }
  },
);

export default spacetimedb;
