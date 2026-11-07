// Live client for the Emoji Charades Spacetime module on Maincloud.
// Same exported API as src/lib/engine.ts, but every action is a real reducer call and
// every read comes from table subscriptions. engine.ts stays as the offline stand-in for tests.
import { useEffect, useState } from "react";
import { DbConnection } from "@/module_bindings";
import type { Game, Guess, LogEvent, Phase, Player, State } from "@/lib/engine";

export { CLUE_MS, GUESS_MS, REVEAL_MS, matches, isEmojiOnly, useNow } from "@/lib/engine";
export type { Game, Guess, LogEvent, Phase, Player, State } from "@/lib/engine";

const URI = "wss://maincloud.spacetimedb.com";
const DB = "firstwave";
const TOKEN_KEY = "firstwave-spacetime-token";

let conn: DbConnection | null = null;
let myId = "";
let snapshot: State | null = null;
let ready: Promise<DbConnection> | null = null;
const listeners = new Set<(s: State | null) => void>();

const ms = (v: { toMillis(): bigint }) => Number(v.toMillis());

function rebuild() {
  if (!conn) return;
  const db = conn.db;
  const players: Player[] = [...db.player.iter()].map((p) => ({
    id: p.identity.toHexString(), name: p.name, score: p.score, online: p.online, isHost: p.isHost,
  }));
  const g = db.game.id.find(1n);
  const game: Game = g
    ? {
        phase: g.phase as Phase, round: g.round, totalRounds: g.totalRounds,
        cluerId: g.cluer ? g.cluer.toHexString() : undefined, cluerName: g.cluerName,
        phrase: g.phrase, clue: g.clue, phaseEndsAt: Number(g.phaseEndsAt), winnerName: g.winnerName,
      }
    : { phase: "lobby", round: 0, totalRounds: 0, cluerId: undefined, cluerName: "", phrase: "", clue: "", phaseEndsAt: 0, winnerName: "" };
  const guesses: Guess[] = [...db.guess.iter()].map((x) => ({
    id: Number(x.id), playerId: x.player.toHexString(), playerName: x.playerName, round: x.round,
    text: x.text, correct: x.correct, answeredAt: Number(x.answeredAt), points: x.points,
  })).sort((a, b) => a.id - b.id);
  const events: LogEvent[] = [...db.eventLog.iter()].map((e) => ({
    id: Number(e.id), ts: ms(e.ts), actor: e.actor, kind: e.kind, text: e.text,
  })).sort((a, b) => a.id - b.id).slice(-200);
  snapshot = { players, game, guesses, events, nextId: 0 };
  listeners.forEach((l) => l(snapshot));
}

function connect(): Promise<DbConnection> {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
      .onConnect((c, identity, token) => {
        localStorage.setItem(TOKEN_KEY, token);
        conn = c; myId = identity.toHexString();
        for (const tbl of [c.db.player, c.db.game, c.db.guess, c.db.eventLog] as const) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = tbl as any;
          t.onInsert(rebuild); t.onUpdate?.(rebuild); t.onDelete(rebuild);
        }
        c.subscriptionBuilder().onApplied(() => { rebuild(); resolve(c); }).subscribeToAllTables();
      })
      .onConnectError((_c, err) => { ready = null; reject(err); })
      .onDisconnect(() => { ready = null; conn = null; })
      .build();
  });
  return ready;
}

export function getMyId() { return myId; }

async function call<T>(fn: (c: DbConnection) => Promise<T>) {
  const c = await connect();
  return fn(c);
}

// ---------- reducers (snake_case in the module, camelCase here) ----------
export const join = (name: string) => {
  const clean = name.trim().slice(0, 16);
  if (!clean) return Promise.reject(new Error("Name required"));
  return call((c) => c.reducers.join({ name: clean }));
};
export const startGame = () => call((c) => c.reducers.startGame({}));
export const submitClue = (clue: string) => call((c) => c.reducers.submitClue({ clue }));
export const submitGuess = (text: string) => call((c) => c.reducers.submitGuess({ text }));
export const resetGame = () => call((c) => c.reducers.resetGame({}));

// The clock runs inside Spacetime (scheduled `tick` reducer), so the browser does nothing.
export function useLeaderTick() {}

export function useRoom(): State | null {
  const [state, setState] = useState<State | null>(snapshot);
  useEffect(() => {
    listeners.add(setState);
    connect().then(() => setState(snapshot)).catch((e) => console.error("Spacetime connect failed", e));
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}
