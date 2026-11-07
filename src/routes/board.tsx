import { createFileRoute, Link } from "@tanstack/react-router";
import { CityMap } from "@/components/CityMap";
import { Feed, Leaderboard, Queue, Stats } from "@/components/Panels";
import { AlertBanner, useEventAlerts } from "@/lib/alerts";
import { resetRoom, useLeaderTick, useNow, useRoom } from "@/lib/engine";

export const Route = createFileRoute("/board")({
  head: () => ({
    meta: [
      { title: "Live Board · FirstWave" },
      { name: "description", content: "Big-screen live view of every incident, unit and responder in FirstWave." },
      { property: "og:title", content: "Live Board · FirstWave" },
      { property: "og:description", content: "Watch the whole city respond in real time." },
    ],
  }),
  component: Board,
});

function Board() {
  const state = useRoom();
  const now = useNow(500);
  useLeaderTick();
  const alert = useEventAlerts(state);
  if (!state) return null;
  return (
    <main className="grid min-h-screen gap-4 p-4 lg:grid-cols-[1fr_400px]">
      <AlertBanner alert={alert} />
      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold">FirstWave <span className="font-mono text-xs text-primary">● LIVE</span></Link>
          <button onClick={() => { if (confirm("Clear the whole room?")) resetRoom(); }} className="font-mono text-xs text-muted-foreground hover:text-destructive">reset room</button>
        </header>
        <Stats state={state} now={now} />
        <div className="aspect-square max-h-[calc(100vh-11rem)] w-full">
          <CityMap incidents={state.incidents} units={state.units} />
        </div>
      </section>
      <aside className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">LEADERBOARD</h3><Leaderboard state={state} /></div>
        <div className="max-h-80 overflow-auto rounded-md border border-border bg-card p-3"><h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">QUEUE</h3><Queue state={state} now={now} onSelect={() => {}} /></div>
        <div className="rounded-md border border-border bg-card p-3"><h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">ACTIVITY</h3><Feed state={state} limit={14} /></div>
      </aside>
    </main>
  );
}
