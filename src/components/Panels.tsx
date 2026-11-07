import { priority, type State } from "@/lib/engine";

export function Stats({ state, now }: { state: State; now: number }) {
  const open = state.incidents.filter((i) => i.status !== "resolved");
  const done = state.incidents.filter((i) => i.resolvedAt);
  const avg = done.length ? done.reduce((a, i) => a + (i.resolvedAt! - i.createdAt), 0) / done.length / 1000 : 0;
  const busy = state.units.filter((u) => u.status !== "available").length;
  const crit = open.filter((i) => i.severity >= 4).length;
  const items = [
    ["OPEN", open.length, ""], ["CRITICAL", crit, "text-destructive"],
    ["AVG RESPONSE", done.length ? `${avg.toFixed(0)}s` : "—", ""], ["UNITS BUSY", `${busy}/${state.units.length}`, "text-accent"],
  ] as const;
  void now;
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map(([l, v, c]) => (
        <div key={l} className="rounded-md border border-border bg-card p-3">
          <div className="font-mono text-[10px] tracking-widest text-muted-foreground">{l}</div>
          <div className={`font-mono text-2xl font-bold ${c}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const KIND_CLASS: Record<string, string> = {
  escalate: "text-destructive", disaster: "text-destructive", cancel: "text-warning",
  resolve: "text-accent", arrive: "text-accent", assign: "text-primary",
};

export function Feed({ state, limit = 12 }: { state: State; limit?: number }) {
  return (
    <ul className="space-y-1 font-mono text-xs">
      {state.events.slice(-limit).reverse().map((e) => (
        <li key={e.id} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
          <span className={KIND_CLASS[e.kind] ?? ""}>{e.text}</span>
        </li>
      ))}
      {state.events.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
    </ul>
  );
}

export function Leaderboard({ state }: { state: State }) {
  const ps = [...state.players].filter((p) => p.role !== "spectator" && p.role !== "caller").sort((a, b) => b.score - a.score).slice(0, 6);
  const medal = ["text-warning", "text-foreground", "text-primary"];
  return (
    <ol className="space-y-1 text-sm">
      {ps.map((p, i) => (
        <li key={p.id} className="flex justify-between">
          <span><span className={`font-mono ${medal[i] ?? "text-muted-foreground"}`}>{i + 1}.</span> {p.name} <span className="text-xs text-muted-foreground">{p.role}</span></span>
          <span className="font-mono text-primary">{p.score}</span>
        </li>
      ))}
      {ps.length === 0 && <li className="text-muted-foreground">No dispatchers or responders yet.</li>}
    </ol>
  );
}

const STATUS_CLASS: Record<string, string> = {
  open: "text-destructive", en_route: "text-primary", on_scene: "text-accent",
};

export function Queue({ state, now, selectedId, onSelect }: { state: State; now: number; selectedId?: number | null; onSelect: (id: number) => void }) {
  const q = state.incidents.filter((i) => i.status !== "resolved").sort((a, b) => priority(b, now) - priority(a, now));
  return (
    <ul className="space-y-1.5">
      {q.map((i) => {
        const unit = state.units.find((u) => u.id === i.unitId);
        const eta = unit?.etaAt && i.status === "en_route" ? Math.max(0, Math.ceil((unit.etaAt - now) / 1000)) : null;
        return (
          <li key={i.id}>
            <button onClick={() => onSelect(i.id)} className={`w-full rounded-md border p-2 text-left text-sm transition-colors ${selectedId === i.id ? "border-primary bg-secondary" : "border-border bg-card hover:bg-secondary"}`}>
              <div className="flex justify-between font-mono text-xs">
                <span>#{i.id} {i.type.toUpperCase()}</span>
                <span className={i.severity >= 4 ? "text-destructive" : "text-warning"}>SEV {i.severity} · P{priority(i, now)}</span>
              </div>
              <div className="truncate text-muted-foreground">{i.note || "No note"} · {Math.floor((now - i.createdAt) / 1000)}s ago</div>
              <div className={`font-mono text-[10px] tracking-widest ${STATUS_CLASS[i.status] ?? "text-muted-foreground"}`}>
                {i.status.replace("_", " ").toUpperCase()}{unit ? ` · ${unit.callsign}` : ""}{eta != null ? ` · ETA ${eta}s` : ""}
              </div>
            </button>
          </li>
        );
      })}
      {q.length === 0 && <li className="text-sm text-muted-foreground">All clear — no active incidents.</li>}
    </ul>
  );
}
