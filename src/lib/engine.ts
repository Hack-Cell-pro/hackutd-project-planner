// Local stand-in for the Emoji Charades Spacetime module.
// Each function below has the same name and rules as a reducer in spacetime/firstwave/src/index.ts.
// State lives in localStorage and syncs across browser tabs, so the game works on one machine
// even before the module is published. live.ts swaps these for real Spacetime calls.
import { useEffect, useState } from "react";

export type Phase = "lobby" | "clue" | "guess" | "reveal" | "final";

export interface Player { id: string; name: string; score: number; online: boolean; isHost: boolean }
export interface Game {
  phase: Phase; round: number; totalRounds: number;
  cluerId?: string | undefined; cluerName: string;
  phrase: string; clue: string; phaseEndsAt: number; winnerName: string;
}
export interface Guess {
  id: number; playerId: string; playerName: string; round: number;
  text: string; correct: boolean; answeredAt: number; points: number;
}
export interface LogEvent { id: number; ts: number; actor: string; kind: string; text: string }
export interface State { players: Player[]; game: Game; guesses: Guess[]; events: LogEvent[]; nextId: number }

export const CLUE_MS = 30_000;  // cluer has 30s to send emojis
export const GUESS_MS = 60_000; // room has 60s to guess
export const REVEAL_MS = 8_000; // answer shown for 8s

export const PHRASES = [
  "Harry Potter", "Pizza at 3am", "Monday morning", "Rocket launch", "Zombie apocalypse",
  "Coffee addict", "Beach vacation", "Video game marathon", "Exam week", "Birthday party",
  "Robot uprising", "Pizza delivery", "Snow day", "Road trip", "Haunted house",
  "Time travel", "Superhero landing", "Cooking disaster", "Dance party", "Rainy day",
  "Camping trip", "Space cowboy", "Cat video", "Job interview",
];

const KEY = "emoji-charades-v1";

function freshGame(): Game {
  return { phase: "lobby", round: 0, totalRounds: 0, cluerId: undefined, cluerName: "", phrase: "", clue: "", phaseEndsAt: 0, winnerName: "" };
}
function fresh(): State {
  return { players: [], game: freshGame(), guesses: [], events: [], nextId: 100 };
}

function read(): State {
  if (typeof window === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as State) : fresh();
  } catch {
    return fresh();
  }
}

const listeners = new Set<(s: State) => void>();
function write(s: State) {
  localStorage.setItem(KEY, JSON.stringify(s));
  listeners.forEach((l) => l(s));
}

function tx(fn: (s: State) => void) {
  const s = read();
  fn(s);
  s.events = s.events.slice(-200);
  write(s);
}

function log(s: State, actor: string, kind: string, text: string) {
  s.events.push({ id: s.nextId++, ts: Date.now(), actor, kind, text });
}

export class ReducerError extends Error {}
function fail(msg: string): never { throw new ReducerError(msg); }

export function getMyId(): string {
  let id = localStorage.getItem("emoji-me");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("emoji-me", id); }
  return id;
}

// Guesses match on normalized text: lowercase, letters/numbers only, trailing "s" forgiven.
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
export function matches(guess: string, phrase: string): boolean {
  const a = norm(guess), b = norm(phrase);
  if (a === b) return true;
  const strip = (w: string) => w.split(" ").map((x) => (x.length > 3 && x.endsWith("s") ? x.slice(0, -1) : x)).join(" ");
  return strip(a) === strip(b);
}

// Emojis only: reject anything with letters or digits so the cluer can't spell the answer.
export const isEmojiOnly = (s: string) => s.length > 0 && s.length <= 24 && !/[a-zA-Z0-9]/.test(s);

// ---------- reducers ----------
export function join(name: string) {
  const id = getMyId();
  const clean = name.trim().slice(0, 16);
  if (!clean) fail("Name required");
  tx((s) => {
    const p = s.players.find((p) => p.id === id);
    if (p) { p.name = clean; p.online = true; return; }
    // The first player in the room becomes the host.
    const isHost = s.players.length === 0;
    s.players.push({ id, name: clean, score: 0, online: true, isHost });
    log(s, clean, "join", `${clean} joined${isHost ? " as host" : ""}`);
  });
}

function me(s: State): Player {
  const p = s.players.find((p) => p.id === getMyId());
  if (!p) fail("Join first");
  return p;
}

const playersInOrder = (s: State) => [...s.players].sort((a, b) => (a.id < b.id ? -1 : 1));

// Track dealt phrases inside the events log is fragile; keep a module-level deck per tab.
// The real module keeps a private phrase table server-side instead.
let dealt: string[] = [];
function pickPhrase(): string {
  let fresh = PHRASES.filter((p) => !dealt.includes(p));
  if (fresh.length === 0) { dealt = []; fresh = PHRASES; }
  const pick = fresh[Math.floor(Math.random() * fresh.length)]!;
  dealt.push(pick);
  return pick;
}

function startRound(s: State, round: number) {
  const players = playersInOrder(s);
  if (players.length === 0) fail("No players");
  const cluer = players[round % players.length]!;
  s.game = {
    ...s.game, phase: "clue", round, cluerId: cluer.id, cluerName: cluer.name,
    phrase: pickPhrase(), clue: "", phaseEndsAt: Date.now() + CLUE_MS, winnerName: "",
  };
  log(s, "GAME", "round", `Round ${round + 1}: ${cluer.name} is picking emojis`);
}

export function startGame() {
  tx((s) => {
    const p = me(s);
    if (!p.isHost) fail("Only the host can start the game");
    if (s.game.phase !== "lobby" && s.game.phase !== "final") fail("Game already running");
    if (s.players.length < 2) fail("Need at least 2 players");
    // Everyone gets one turn as cluer (capped at 8 rounds).
    s.game.totalRounds = Math.min(s.players.length, 8);
    startRound(s, 0);
  });
}

export function submitClue(clue: string) {
  tx((s) => {
    const p = me(s);
    if (s.game.phase !== "clue") fail("Not the clue phase");
    if (s.game.cluerId !== p.id) fail("You are not the cluer");
    const clean = clue.trim();
    if (!isEmojiOnly(clean)) fail("Emojis only — no letters or numbers");
    s.game.phase = "guess";
    s.game.clue = clean;
    s.game.phaseEndsAt = Date.now() + GUESS_MS;
    log(s, p.name, "clue", `${p.name} sent the clue: ${clean}`);
  });
}

export function submitGuess(text: string) {
  tx((s) => {
    const p = me(s);
    if (s.game.phase !== "guess") fail("No clue to guess yet");
    if (s.game.cluerId === p.id) fail("The cluer can't guess");
    const clean = text.trim().slice(0, 60);
    if (!clean) fail("Empty guess");
    const now = Date.now();
    const correct = matches(clean, s.game.phrase);
    const roundStart = s.game.phaseEndsAt - GUESS_MS;
    const pts = correct ? 100 + Math.max(0, 120 - Math.floor((now - roundStart) / 500) * 2) : 0;
    s.guesses.push({
      id: s.nextId++, playerId: p.id, playerName: p.name, round: s.game.round,
      text: clean, correct, answeredAt: now, points: pts,
    });
    if (correct) {
      p.score += pts;
      // The cluer scores when someone cracks their clue.
      const cluer = s.players.find((x) => x.id === s.game.cluerId);
      if (cluer) cluer.score += 50;
      s.game.phase = "reveal";
      s.game.phaseEndsAt = now + REVEAL_MS;
      s.game.winnerName = p.name;
      log(s, "GAME", "correct", `${p.name} got it: "${s.game.phrase}" (+${pts})`);
    } else {
      log(s, p.name, "guess", `${p.name} guessed "${clean}"`);
    }
  });
}

export function resetGame() {
  tx((s) => {
    const p = me(s);
    if (!p.isHost) fail("Only the host can reset");
    s.game = freshGame();
    s.guesses = [];
    s.players.forEach((pl) => { pl.score = 0; });
    dealt = [];
    log(s, "GAME", "reset", `${p.name} reset the room — back to the lobby`);
  });
}

function advance(s: State) {
  const next = s.game.round + 1;
  if (next >= s.game.totalRounds) {
    s.game.phase = "final";
    s.game.phaseEndsAt = 0;
    s.game.clue = "";
    s.game.phrase = "";
    log(s, "GAME", "final", "That's the game! Check the leaderboard.");
  } else {
    startRound(s, next);
  }
}

// Scheduled reducer: enforces every phase deadline. Runs in exactly one tab (leader lock).
export function tick() {
  tx((s) => {
    if (!s.game.phaseEndsAt) return;
    const now = Date.now();
    if (now <= s.game.phaseEndsAt) return;
    if (s.game.phase === "clue") {
      // Cluer ran out of time — skip their turn.
      log(s, "GAME", "skip", `${s.game.cluerName} ran out of time — skipping`);
      advance(s);
    } else if (s.game.phase === "guess") {
      // Nobody cracked it.
      s.game.phase = "reveal";
      s.game.phaseEndsAt = now + REVEAL_MS;
      s.game.winnerName = "";
      log(s, "GAME", "reveal", `Time! Nobody got it — it was "${s.game.phrase}"`);
    } else if (s.game.phase === "reveal") {
      advance(s);
    }
  });
}

export function resetRoom() { write(fresh()); }

// ---------- subscription ----------
export function useRoom(): State | null {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    setState(read());
    const l = (s: State) => setState({ ...s });
    listeners.add(l);
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setState(read()); };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
  }, []);
  return state;
}

export function useLeaderTick() {
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () => { timer = setInterval(() => { if (!stop) tick(); }, 500); };
    if ("locks" in navigator) {
      navigator.locks.request("emoji-charades-leader", () => new Promise<void>((resolve) => {
        if (stop) return resolve();
        run();
        const check = setInterval(() => { if (stop) { clearInterval(check); resolve(); } }, 500);
      }));
    } else run();
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, []);
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
