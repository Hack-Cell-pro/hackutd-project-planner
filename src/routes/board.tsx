import { createFileRoute, Link } from "@tanstack/react-router";
import { Feed, Leaderboard, TimerBar } from "@/components/Panels";
import { AlertBanner, useEventAlerts } from "@/lib/alerts";
import { CLUE_MS, GUESS_MS, useLeaderTick, useNow, useRoom } from "@/lib/live";

export const Route = createFileRoute("/board")({
  head: () => ({
    meta: [
      { title: "Big Screen · Emoji Charades" },
      { name: "description", content: "The Emoji Charades big screen: live clue, countdown and leaderboard for the whole room." },
      { property: "og:title", content: "Big Screen · Emoji Charades" },
      { property: "og:description", content: "Watch the game unfold live." },
    ],
  }),
  component: Board,
});

function Board() {
  const state = useRoom();
  const now = useNow(250);
  useLeaderTick();
  const alert = useEventAlerts(state);

  if (!state) return null;
  const g = state.game;
  const roundGuesses = state.guesses.filter((x) => x.round === g.round);

  return (
    <main className="flex min-h-screen flex-col gap-6 p-8">
      <AlertBanner alert={alert} />
      <header className="flex items-center justify-between">
        <Link to="/" className="text-2xl font-bold">Emoji Charades <span className="font-mono text-xs text-primary">● LIVE</span></Link>
        <div className="font-mono text-sm text-muted-foreground">{state.players.length} players</div>
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_320px]">
        <section className="flex flex-col justify-center rounded-md border border-border bg-card p-8">
          {g.phase === "lobby" && (
            <div className="text-center">
              <div className="text-7xl">🎭</div>
              <h1 className="mt-4 text-5xl font-bold">Emoji Charades</h1>
              <p className="mt-4 text-xl text-muted-foreground">Join on your phone — one of you describes a secret phrase with emojis, everyone else races to guess.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {state.players.map((p) => (
                  <span key={p.id} className="rounded-full border border-border px-4 py-1.5 font-mono">{p.name}{p.isHost ? " 👑" : ""}</span>
                ))}
              </div>
            </div>
          )}

          {g.phase === "clue" && (
            <div className="space-y-6 text-center">
              <h2 className="font-mono text-sm tracking-widest text-muted-foreground">ROUND {g.round + 1} OF {g.totalRounds}</h2>
              <div className="text-7xl">🤔</div>
              <p className="text-4xl font-bold"><span className="text-primary">{g.cluerName}</span> is picking emojis…</p>
              <TimerBar endsAt={g.phaseEndsAt} now={now} total={CLUE_MS} />
            </div>
          )}

          {g.phase === "guess" && (
            <div className="space-y-6 text-center">
              <h2 className="font-mono text-sm tracking-widest text-muted-foreground">ROUND {g.round + 1} OF {g.totalRounds} · WHAT IS {g.cluerName.toUpperCase()} DESCRIBING?</h2>
              <div className="py-6 text-8xl tracking-widest">{g.clue}</div>
              <TimerBar endsAt={g.phaseEndsAt} now={now} total={GUESS_MS} />
              <p className="font-mono text-sm text-muted-foreground">{roundGuesses.length} guess{roundGuesses.length === 1 ? "" : "es"} in</p>
            </div>
          )}

          {g.phase === "reveal" && (
            <div className="space-y-4 text-center">
              <div className="text-7xl">{g.winnerName ? "🎉" : "😅"}</div>
              <p className="text-xl text-muted-foreground">The phrase was</p>
              <p className="text-6xl font-bold text-primary">"{g.phrase}"</p>
              {g.winnerName
                ? <p className="text-2xl"><span className="font-semibold text-accent">{g.winnerName}</span> cracked it!</p>
                : <p className="text-2xl text-muted-foreground">Nobody got it!</p>}
            </div>
          )}

          {g.phase === "final" && (
            <div className="mx-auto w-full max-w-md space-y-4">
              <h2 className="text-center text-5xl font-bold">🏆 Final scores</h2>
              <Leaderboard players={state.players} big />
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">LEADERBOARD</h3>
            <Leaderboard players={state.players} />
          </div>
          <div className="flex-1 rounded-md border border-border bg-card p-4">
            <h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">ACTIVITY</h3>
            <Feed events={state.events} limit={14} />
          </div>
        </aside>
      </div>
    </main>
  );
}
