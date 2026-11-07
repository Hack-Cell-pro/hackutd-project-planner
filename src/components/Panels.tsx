// Shared display pieces for the play screen and the big screen.
import type { LogEvent, Player } from "@/lib/live";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({ players, big = false }: { players: Player[]; big?: boolean }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <ol className="space-y-1">
      {sorted.map((p, i) => (
        <li key={p.id}
          className={`flex items-center justify-between rounded-md border px-3 py-2 ${i === 0 ? "border-primary bg-secondary" : "border-border"}`}>
          <span className={big ? "text-lg" : "text-sm"}>
            {MEDALS[i] ?? `${i + 1}.`} <span className="font-semibold">{p.name}</span>
            {p.isHost && <span className="ml-1 font-mono text-xs text-muted-foreground">HOST</span>}
          </span>
          <span className={`font-mono ${big ? "text-lg" : "text-sm"} text-primary`}>{p.score}</span>
        </li>
      ))}
      {sorted.length === 0 && <li className="text-sm text-muted-foreground">No players yet.</li>}
    </ol>
  );
}

const KIND_CLASS: Record<string, string> = {
  join: "text-muted-foreground",
  round: "text-primary",
  clue: "text-accent",
  guess: "text-muted-foreground",
  correct: "text-accent",
  reveal: "text-warning",
  skip: "text-warning",
  final: "text-primary",
  reset: "text-muted-foreground",
};

export function Feed({ events, limit = 10 }: { events: LogEvent[]; limit?: number }) {
  const shown = events.slice(-limit).reverse();
  return (
    <ul className="space-y-1 font-mono text-xs">
      {shown.map((e) => (
        <li key={e.id} className={KIND_CLASS[e.kind] ?? "text-foreground"}>{e.text}</li>
      ))}
      {shown.length === 0 && <li className="text-muted-foreground">Nothing yet — start a game!</li>}
    </ul>
  );
}

export function TimerBar({ endsAt, now, total }: { endsAt: number; now: number; total: number }) {
  const left = Math.max(0, endsAt - now);
  const pct = Math.min(100, (left / total) * 100);
  const urgent = left < 5_000;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full transition-all ${urgent ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-sm ${urgent ? "text-destructive" : "text-muted-foreground"}`}>{Math.ceil(left / 1000)}s</span>
    </div>
  );
}
