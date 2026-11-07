// QuickFire SpacetimeDB module (TypeScript, SDK 2.x) — live trivia for the whole room.
// Every game rule runs here: the round clock, scoring, host controls. Mirrors src/lib/engine.ts.
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
  phase: t.string(), // lobby | question | reveal | final
  questionIndex: t.u32(),
  roundStartAt: t.u64(), // ms since epoch
  roundEndsAt: t.u64(),
  revealEndsAt: t.u64(),
});

const Question = table({ name: "question", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  text: t.string(),
  options: t.array(t.string()),
  correct: t.u8(),
});

const Answer = table({ name: "answer", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  player: t.identity(),
  questionId: t.u64(),
  choice: t.u8(),
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
  question: Question,
  answer: Answer,
  eventLog: EventLog,
  tickSchedule: Tick,
});

const TICK_EVERY = 500_000n; // microseconds -> 2 ticks per second
const ROUND_MS = 15_000;
const REVEAL_MS = 6_000;

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

const questionCount = (ctx: any) => {
  let n = 0;
  for (const _ of ctx.db.question.iter()) n++;
  return n;
};

const currentQuestion = (ctx: any, g: any) => {
  let i = 0;
  for (const q of ctx.db.question.iter()) {
    if (i === Number(g.questionIndex)) return q;
    i++;
  }
  return undefined;
};

// Speed scoring: 100 for a correct answer + up to 100 more for being fast
// (1 bonus point lost per 150ms of thinking time).
const pointsFor = (answeredAt: number, roundStartAt: number) =>
  100 + Math.max(0, 100 - Math.floor((answeredAt - roundStartAt) / 150));

const QUESTIONS: { text: string; options: string[]; correct: number }[] = [
  { text: "What year did the first iPhone come out?", options: ["2005", "2007", "2009", "2010"], correct: 1 },
  { text: "Which planet is closest to the Sun?", options: ["Venus", "Earth", "Mercury", "Mars"], correct: 2 },
  { text: "How many legs does a spider have?", options: ["6", "8", "10", "12"], correct: 1 },
  { text: "What does 'HTTP' stand for?", options: ["HyperText Transfer Protocol", "High Tech Transfer Process", "HyperText Transmission Program", "Host Transfer Text Protocol"], correct: 0 },
  { text: "Which company created SpacetimeDB?", options: ["Google", "Clockwork Labs", "Meta", "Amazon"], correct: 1 },
  { text: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 },
  { text: "How many bits are in a byte?", options: ["4", "8", "16", "32"], correct: 1 },
  { text: "Which animal is known as the King of the Jungle?", options: ["Tiger", "Elephant", "Lion", "Gorilla"], correct: 2 },
  { text: "What is 9 x 7?", options: ["56", "63", "72", "49"], correct: 1 },
  { text: "Which language runs in a web browser?", options: ["Java", "C++", "JavaScript", "Python"], correct: 2 },
  { text: "What color do you get mixing blue and yellow?", options: ["Purple", "Green", "Orange", "Brown"], correct: 1 },
  { text: "How many continents are there?", options: ["5", "6", "7", "8"], correct: 2 },
  { text: "What is the chemical symbol for gold?", options: ["Go", "Gd", "Au", "Ag"], correct: 2 },
  { text: "Which of these is NOT a programming language?", options: ["Rust", "Cobra", "Python", "TypeScript"], correct: 1 },
  { text: "How many seconds are in five minutes?", options: ["300", "360", "240", "500"], correct: 0 },
];

export const init = spacetimedb.init((ctx) => {
  for (const q of QUESTIONS) {
    ctx.db.question.insert({ id: 0n, text: q.text, options: q.options, correct: q.correct });
  }
  ctx.db.game.insert({ id: 1n, phase: "lobby", questionIndex: 0, roundStartAt: 0n, roundEndsAt: 0n, revealEndsAt: 0n });
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
  log(ctx, clean, "join", `${clean} joined the game${any ? "" : " as host"}`);
});

export const start_game = spacetimedb.reducer({}, (ctx) => {
  const p = me(ctx);
  if (!p.isHost) throw new SenderError("Only the host can start the game");
  const g = game(ctx);
  if (g.phase !== "lobby" && g.phase !== "final") throw new SenderError("Game already running");
  const now = nowMs(ctx);
  ctx.db.game.id.update({
    ...g, phase: "question", questionIndex: 0,
    roundStartAt: BigInt(now), roundEndsAt: BigInt(now + ROUND_MS), revealEndsAt: 0n,
  });
  log(ctx, "GAME", "start", `${p.name} started the game — question 1 is live`);
});

export const submit_answer = spacetimedb.reducer({ choice: t.u8() }, (ctx, { choice }) => {
  const p = me(ctx);
  const g = game(ctx);
  if (g.phase !== "question") throw new SenderError("No question is live");
  const now = nowMs(ctx);
  if (now > Number(g.roundEndsAt)) throw new SenderError("Time is up");
  const q = currentQuestion(ctx, g);
  if (!q) throw new SenderError("No question found");
  if (choice >= q.options.length) throw new SenderError("Bad choice");
  for (const a of ctx.db.answer.iter()) {
    if (a.questionId === q.id && a.player.isEqual(ctx.sender)) throw new SenderError("Already answered");
  }
  ctx.db.answer.insert({ id: 0n, player: ctx.sender, questionId: q.id, choice, answeredAt: BigInt(now), points: 0 });
});

export const reset_game = spacetimedb.reducer({}, (ctx) => {
  const p = me(ctx);
  if (!p.isHost) throw new SenderError("Only the host can reset");
  const g = game(ctx);
  ctx.db.game.id.update({ ...g, phase: "lobby", questionIndex: 0, roundStartAt: 0n, roundEndsAt: 0n, revealEndsAt: 0n });
  for (const a of ctx.db.answer.iter()) ctx.db.answer.id.delete(a.id);
  for (const pl of ctx.db.player.iter()) ctx.db.player.identity.update({ ...pl, score: 0 });
  log(ctx, "GAME", "reset", `${p.name} reset the room — back to the lobby`);
});

// The heartbeat: ends rounds, scores answers, advances the game. Queues the next tick first.
export const tick = spacetimedb.reducer(
  { onSchedule: Tick },
  { arg: Tick.rowType },
  (ctx) => {
    queueTick(ctx);
    const g = ctx.db.game.id.find(1n);
    if (!g) return;
    const now = nowMs(ctx);

    if (g.phase === "question" && now > Number(g.roundEndsAt)) {
      // Time's up: score every answer to this question.
      const q = currentQuestion(ctx, g);
      let correctCount = 0;
      if (q) {
        for (const a of ctx.db.answer.iter()) {
          if (a.questionId !== q.id) continue;
          const pts = a.choice === q.correct ? pointsFor(Number(a.answeredAt), Number(g.roundStartAt)) : 0;
          ctx.db.answer.id.update({ ...a, points: pts });
          if (pts > 0) {
            correctCount++;
            const pl = ctx.db.player.identity.find(a.player);
            if (pl) ctx.db.player.identity.update({ ...pl, score: pl.score + pts });
          }
        }
      }
      ctx.db.game.id.update({ ...g, phase: "reveal", revealEndsAt: BigInt(now + REVEAL_MS) });
      log(ctx, "GAME", "reveal", `Time! ${correctCount} correct answer${correctCount === 1 ? "" : "s"}`);
      return;
    }

    if (g.phase === "reveal" && now > Number(g.revealEndsAt)) {
      const total = questionCount(ctx);
      const next = Number(g.questionIndex) + 1;
      if (next >= total) {
        ctx.db.game.id.update({ ...g, phase: "final" });
        log(ctx, "GAME", "final", "That's the game! Check the leaderboard.");
      } else {
        ctx.db.game.id.update({
          ...g, phase: "question", questionIndex: next,
          roundStartAt: BigInt(now), roundEndsAt: BigInt(now + ROUND_MS), revealEndsAt: 0n,
        });
        log(ctx, "GAME", "question", `Question ${next + 1} of ${total} is live`);
      }
    }
  },
);

export default spacetimedb;
