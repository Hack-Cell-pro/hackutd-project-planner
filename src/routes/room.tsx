import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CityMap } from "@/components/CityMap";
import { Feed, Queue } from "@/components/Panels";
import { AlertBanner, useEventAlerts } from "@/lib/alerts";
import {
  assignUnit, cancelIncident, claimUnit, distance, getMyId, reportIncident, resolveIncident,
  triggerDisaster, useLeaderTick, useNow, useRoom, type IncidentType, type State,
} from "@/lib/engine";

export const Route = createFileRoute("/room")({
  head: () => ({
    meta: [
      { title: "Dispatch Room · FirstWave" },
      { name: "description", content: "The live FirstWave dispatch room: map, incident queue and unit controls." },
      { property: "og:title", content: "Dispatch Room · FirstWave" },
      { property: "og:description", content: "Report, dispatch and resolve incidents live." },
    ],
  }),
  component: Room,
});

function Room() {
  const state = useRoom();
  const now = useNow(500);
  useLeaderTick();
  const alert = useEventAlerts(state);
  const [sel, setSel] = useState<number | null>(null);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState("");

  if (!state) return null;
  const meP = state.players.find((p) => p.id === getMyId());
  if (!meP) return (
    <main className="flex min-h-screen items-center justify-center">
      <Link to="/" className="rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground">Join the room first</Link>
    </main>
  );

  const run = (f: () => void) => { try { f(); setErr(""); } catch (x) { setErr((x as Error).message); } };
  const online = state.players.filter((p) => now - p.lastSeen < 15_000).length;
  const myUnit = state.units.find((u) => u.ownerId === meP.id);

  return (
    <main className="grid min-h-screen gap-4 p-4 lg:grid-cols-[1fr_380px]">
      <AlertBanner alert={alert} />
      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <Link to="/" className="text-xl font-bold">FirstWave <span className="font-mono text-xs text-primary">● LIVE</span></Link>
          <div className="font-mono text-xs text-muted-foreground">
            {meP.name} · <span className="text-primary">{meP.role.toUpperCase()}</span> · {meP.score} pts ·{" "}
            {online} online · <Link to="/board" className="underline">big screen</Link>
          </div>
        </header>
        <div className="aspect-square max-h-[calc(100vh-6rem)] w-full">
          <CityMap incidents={state.incidents} units={state.units} selectedId={sel} pin={pin} myUnitId={myUnit?.id}
            onSelect={setSel} onPick={meP.role === "caller" ? (x, y) => setPin({ x, y }) : undefined} />
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        {err && <div className="rounded-md border border-destructive p-2 text-sm text-destructive">{err}</div>}
        {meP.role === "caller" && <CallerPanel pin={pin} onDone={() => setPin(null)} run={run} />}
        {meP.role === "dispatcher" && <DispatcherPanel state={state} now={now} sel={sel} setSel={setSel} run={run} />}
        {meP.role === "responder" && <ResponderPanel state={state} now={now} run={run} />}
        <div className="rounded-md border border-border bg-card p-3">
          <h3 className="mb-2 font-mono text-xs tracking-widest text-muted-foreground">ACTIVITY</h3>
          <Feed state={state} limit={10} />
        </div>
      </aside>
    </main>
  );
}

type Run = (f: () => void) => void;

function CallerPanel({ pin, onDone, run }: { pin: { x: number; y: number } | null; onDone: () => void; run: Run }) {
  const [type, setType] = useState<IncidentType>("fire");
  const [sev, setSev] = useState(3);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">Report an emergency</h2>
      <p className="text-sm text-muted-foreground">{pin ? `Location set (${pin.x.toFixed(0)}, ${pin.y.toFixed(0)})` : "Click the map to drop a pin."}</p>
      <div className="grid grid-cols-4 gap-1">
        {(["fire", "medical", "flood", "power"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`rounded-md border px-2 py-2 text-xs capitalize ${type === t ? "border-primary bg-secondary" : "border-border"}`}>{t}</button>
        ))}
      </div>
      <label className="block text-sm">Severity: <span className="font-mono text-primary">{sev}</span>
        <input type="range" min={1} max={5} value={sev} onChange={(e) => setSev(+e.target.value)} className="w-full accent-primary" />
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's happening?" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <button disabled={!pin} onClick={() => run(() => { reportIncident(type, sev, pin!.x, pin!.y, note); setNote(""); setSent("Report sent — help is on the way."); onDone(); })}
        className="w-full rounded-md bg-primary py-2 font-semibold text-primary-foreground disabled:opacity-40">Send report</button>
      {sent && !pin && <p className="text-sm text-accent">{sent}</p>}
    </div>
  );
}

function DispatcherPanel({ state, now, sel, setSel, run }: { state: State; now: number; sel: number | null; setSel: (n: number) => void; run: Run }) {
  const inc = state.incidents.find((i) => i.id === sel && i.status !== "resolved");
  const free = state.units.filter((u) => u.status === "available");
  return (
    <>
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Priority queue <span className="font-mono text-xs text-muted-foreground">· {free.length} units free</span></h2>
          <button onClick={() => { if (confirm("Trigger a storm cell? This floods the room with incidents.")) run(() => triggerDisaster(6)); }}
            className="rounded-md border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10">Disaster mode</button>
        </div>
        <div className="max-h-72 overflow-auto"><Queue state={state} now={now} selectedId={sel} onSelect={setSel} /></div>
      </div>
      {inc && (
        <div className="rounded-md border border-primary bg-card p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">#{inc.id} {inc.type} · {inc.status.replace("_", " ")}</h3>
            <button onClick={() => run(() => cancelIncident(inc.id))} className="font-mono text-xs text-muted-foreground hover:text-warning">cancel</button>
          </div>
          {inc.note && <p className="mt-1 text-sm text-muted-foreground">{inc.note}</p>}
          {inc.status === "open" ? (
            <ul className="mt-2 space-y-1">
              {free.sort((a, b) => distance(a.x, a.y, inc.x, inc.y) - distance(b.x, b.y, inc.x, inc.y)).map((u) => (
                <li key={u.id}>
                  <button onClick={() => run(() => assignUnit(inc.id, u.id))} className="flex w-full justify-between rounded-md border border-border px-2 py-1.5 text-sm hover:border-accent">
                    <span className="font-mono">{u.callsign} <span className={u.kind === inc.type ? "text-accent" : "text-muted-foreground"}>{u.kind}</span></span>
                    <span className="font-mono text-muted-foreground">{distance(u.x, u.y, inc.x, inc.y).toFixed(0)}m</span>
                  </button>
                </li>
              ))}
              {free.length === 0 && <li className="text-sm text-muted-foreground">No units free.</li>}
            </ul>
          ) : inc.status === "on_scene" ? (
            <button onClick={() => run(() => resolveIncident(inc.id))} className="mt-2 w-full rounded-md bg-accent py-2 font-semibold text-accent-foreground">Mark resolved</button>
          ) : <p className="mt-2 text-sm text-muted-foreground">Unit en route…</p>}
        </div>
      )}
    </>
  );
}

function ResponderPanel({ state, now, run }: { state: State; now: number; run: Run }) {
  const myId = getMyId();
  const mine = state.units.find((u) => u.ownerId === myId);
  const target = state.incidents.find((i) => i.id === mine?.targetId);
  const progress = mine?.status === "en_route" && mine.departAt != null && mine.etaAt
    ? Math.min(1, (now - mine.departAt) / (mine.etaAt - mine.departAt)) : null;
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{mine ? mine.callsign : "Pick your unit"}</h2>
      {!mine && (
        <div className="grid grid-cols-2 gap-2">
          {state.units.map((u) => (
            <button key={u.id} disabled={!!u.ownerId} onClick={() => run(() => claimUnit(u.id))} className="rounded-md border border-border p-2 text-left font-mono text-xs disabled:opacity-40 hover:border-accent">
              {u.callsign}<div className="text-muted-foreground">{u.kind}</div>
            </button>
          ))}
        </div>
      )}
      {mine && (
        <>
          <div className="font-mono text-sm">STATUS <span className="text-accent">{mine.status.replace("_", " ").toUpperCase()}</span></div>
          {target && mine.status === "en_route" && (
            <>
              <div className="font-mono text-3xl">ETA {Math.max(0, Math.ceil((mine.etaAt! - now) / 1000))}s</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-accent transition-all" style={{ width: `${(progress ?? 0) * 100}%` }} />
              </div>
            </>
          )}
          {target && <p className="text-sm text-muted-foreground">#{target.id} {target.type} sev {target.severity}: {target.note || "no note"}</p>}
          {target && mine.status === "on_scene" && (
            <button onClick={() => run(() => resolveIncident(target.id))} className="w-full rounded-md bg-accent py-2 font-semibold text-accent-foreground">Resolve incident</button>
          )}
          {!target && <p className="text-sm text-muted-foreground">Standing by for dispatch.</p>}
        </>
      )}
    </div>
  );
}
