import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Feed, Leaderboard, TimerBar } from "@/components/Panels";
import { AlertBanner, useEventAlerts } from "@/lib/alerts";
import {
  CLUE_MS, GUESS_MS, getMyId, join, resetGame, startGame, submitClue, submitGuess,
  useLeaderTick, useNow, useRoom, type State,
} from "@/lib/live";

export const Route = createFileRoute("/room")({
  head: () => ({
    meta: [
      { title: "Play · Emoji Charades" },
      { name: "description", content: "The live Emoji Charades room: clues, guesses and scores." },
      { property: "og:title", content: "Play · Emoji Charades" },
      { property: "og:description", content: "Guess the phrase from emojis, live." },
    ],
  }),
  component: Room,
});

function Room() {
  const state = useRoom();
  const now = useNow(250);
  useLeaderTick();
  const alert = useEventAlerts(state);
  const [err, setErr] = useState("");

  if (!state) return null;
  const meP = state.players.find((p) => p.id === getMyId());
  if (!meP) return (
    <main className="flex min-h-screen items-center justify-center">
      <Link to="/" className="rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground">Join the game first</Link>
    </main>
  );

  const run = (f: () => unknown) => { try { Promise.resolve(f()).then(() => setErr(""), (x) => setErr((x as Error).message)); } catch (x) { setErr((x as Error).message); } };
  const online = state.players.filter((p) => p.online).length;
  const g = state.game;
  const isCluer = g.cluerId === meP.id;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4">
      <AlertBanner alert={alert} />
      <header className="flex items-center justify-between">
        <Link to="/" className="text-xl font-bold">Emoji Charades <span className="font-mono text-xs text-primary">● LIVE</span></Link>
        <div className="font-mono text-xs text-muted-foreground">
          {meP.name} · <span className="text-primary">{meP.score} pts</span> · {online} in room ·{" "}
          <Link to="/board" className="underline">big screen</Link>
        </div>
      </header>

      {err && <div className="rounded-md border border-destructive p-2 text-sm text-destructive">{err}</div>}

      {g.phase === "lobby" && (
        <section className="space-y-4 rounded-md border border-border bg-card p-6 text-center">
          <div className="text-5xl">🎭</div>
          <h2 className="text-2xl font-bold">Waiting in the lobby</h2>
          <p className="text-muted-foreground">{state.players.length} player{state.players.length === 1 ? "" : "s"} here. Everyone plays — one person describes with emojis, everyone else guesses.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {state.players.map((p) => (
              <span key={p.id} className="rounded-full border border-border px-3 py-1 font-mono text-sm">
                {p.name}{p.isHost ? " 👑" : ""}
              </span>
            ))}
          </div>
          {meP.isHost ? (
            <button disabled={state.players.length < 2} onClick={() => run(startGame)}
              className="rounded-md bg-primary px-8 py-3 text-lg font-semibold text-primary-foreground disabled:opacity-40">
              Start the game
            </button>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">Waiting for the host to start…</p>
          )}
          {meP.isHost && state.players.length < 2 && (
            <p className="text-sm text-warning">You need at least 2 players — have a friend open this page on their phone.</p>
          )}
        </section>
      )}

      {g.phase === "clue" && (
        <section className="space-y-4 rounded-md border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs tracking-widest text-muted-foreground">ROUND {g.round + 1} OF {g.totalRounds}</h2>
          </div>
          <TimerBar endsAt={g.phaseEndsAt} now={now} total={CLUE_MS} />
          {isCluer ? (
            <CluerView phrase={g.phrase} run={run} />
          ) : (
            <div className="py-8 text-center">
              <div className="text-5xl">🤔</div>
              <p className="mt-4 text-xl"><span className="font-semibold text-primary">{g.cluerName}</span> is picking emojis…</p>
              <p className="mt-1 text-sm text-muted-foreground">Get ready to guess!</p>
            </div>
          )}
        </section>
      )}

      {g.phase === "guess" && (
        <section className="space-y-4 rounded-md border border-border bg-card p-6">
          <h2 className="font-mono text-xs tracking-widest text-muted-foreground">ROUND {g.round + 1} OF {g.totalRounds} · {g.cluerName}'S CLUE</h2>
          <TimerBar endsAt={g.phaseEndsAt} now={now} total={GUESS_MS} />
          <div className="rounded-md border border-primary bg-secondary py-8 text-center text-6xl tracking-widest">{g.clue}</div>
          {isCluer ? (
            <p className="text-center text-muted-foreground">The room is guessing your clue…</p>
          ) : (
            <GuesserView state={state} myId={meP.id} run={run} />
          )}
        </section>
      )}

      {g.phase === "reveal" && (
        <section className="space-y-4 rounded-md border border-border bg-card p-6 text-center">
          <div className="text-5xl">{g.winnerName ? "🎉" : "😅"}</div>
          <p className="text-lg text-muted-foreground">The phrase was</p>
          <p className="text-4xl font-bold text-primary">"{g.phrase}"</p>
          {g.winnerName
            ? <p className="text-lg"><span className="font-semibold text-accent">{g.winnerName}</span> cracked it!</p>
            : <p className="text-lg text-muted-foreground">Nobody got it this time.</p>}
        </section>
      )}

      {g.phase === "final" && (
        <section className="space-y-4 rounded-md border border-border bg-card p-6">
          <h2 className="text-center text-3xl font-bold">🏆 Final scores</h2>
          <Leaderboard players={state.players} big />
          {meP.isHost && (
            <button onClick={() => run(resetGame)}
              className="w-full rounded-md border border-primary py-2 font-semibold text-primary hover:bg-secondary">
              Play again
            </button>
          )}
        </section>
      )}

      <aside className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-3">
          <h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">LEADERBOARD</h3>
          <Leaderboard players={state.players} />
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">ACTIVITY</h3>
          <Feed events={state.events} limit={8} />
        </div>
      </aside>
    </main>
  );
}

type Run = (f: () => void) => void;

function CluerView({ phrase, run }: { phrase: string; run: Run }) {
  const [clue, setClue] = useState("");
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-warning bg-secondary p-4 text-center">
        <p className="font-mono text-xs tracking-widest text-muted-foreground">YOUR SECRET PHRASE — DON'T SAY IT OUT LOUD</p>
        <p className="mt-2 text-3xl font-bold text-warning">"{phrase}"</p>
      </div>
      <p className="text-sm text-muted-foreground">Describe it with emojis only. Letters and numbers are rejected by the server.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => submitClue(clue)); }}>
        <input value={clue} onChange={(e) => setClue(e.target.value)} placeholder="🍕🕒😴 …"
          className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-2xl outline-none focus:border-ring" />
        <button className="rounded-md bg-primary px-6 font-semibold text-primary-foreground">Send clue</button>
      </form>
    </div>
  );
}

function GuesserView({ state, myId, run }: { state: State; myId: string; run: Run }) {
  const [text, setText] = useState("");
  const mine = state.guesses.filter((x) => x.round === state.game.round && x.playerId === myId);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { run(() => submitGuess(text)); setText(""); } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your guess…" autoFocus
          className="flex-1 rounded-md border border-input bg-background px-4 py-3 outline-none focus:border-ring" />
        <button className="rounded-md bg-accent px-6 font-semibold text-accent-foreground">Guess</button>
      </form>
      {mine.length > 0 && (
        <ul className="space-y-1">
          {mine.map((x) => (
            <li key={x.id} className="font-mono text-sm text-muted-foreground">✗ {x.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Re-exported so the join page and room share one import surface.
export { join };
