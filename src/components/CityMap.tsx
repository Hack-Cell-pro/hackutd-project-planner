import type { Incident, Unit } from "@/lib/engine";

const SEV_CLASS = ["", "fill-accent", "fill-accent", "fill-warning", "fill-primary", "fill-destructive"];
const ICON: Record<string, string> = { fire: "F", medical: "+", flood: "W", power: "⚡" };

export function CityMap({
  incidents, units, selectedId, onPick, onSelect,
}: {
  incidents: Incident[]; units: Unit[]; selectedId?: number | null;
  onPick?: (x: number, y: number) => void; onSelect?: (id: number) => void;
}) {
  const active = incidents.filter((i) => i.status !== "resolved");
  return (
    <svg
      viewBox="0 0 100 100"
      className={`h-full w-full rounded-md border border-border bg-map ${onPick ? "cursor-crosshair" : ""}`}
      onClick={(e) => {
        if (!onPick) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPick(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
      }}
    >
      {[10, 30, 50, 70, 90].map((v) => (
        <g key={v} className="stroke-map-road">
          <line x1={v} y1={0} x2={v} y2={100} strokeWidth={v === 50 ? 1.6 : 0.8} />
          <line x1={0} y1={v} x2={100} y2={v} strokeWidth={v === 50 ? 1.6 : 0.8} />
        </g>
      ))}
      <path d="M0 78 Q30 70 55 85 T100 80" className="fill-none stroke-accent/30" strokeWidth={2.5} />
      <text x={2} y={4} className="fill-muted-foreground font-mono" fontSize={2.4}>RICHARDSON · SECTOR GRID</text>
      {units.filter((u) => u.targetId).map((u) => {
        const t = incidents.find((i) => i.id === u.targetId);
        return t ? <line key={`l${u.id}`} x1={u.x} y1={u.y} x2={t.x} y2={t.y} className="stroke-accent/60" strokeWidth={0.4} strokeDasharray="1 1" /> : null;
      })}
      {active.map((i) => (
        <g key={i.id} onClick={(e) => { if (onSelect) { e.stopPropagation(); onSelect(i.id); } }} className="cursor-pointer">
          {i.status === "open" && <circle cx={i.x} cy={i.y} r={2} className={`pulse-ring ${SEV_CLASS[i.severity]}`} />}
          <circle cx={i.x} cy={i.y} r={selectedId === i.id ? 2.6 : 2} className={`${SEV_CLASS[i.severity]} stroke-background`} strokeWidth={0.5} />
          <text x={i.x} y={i.y + 0.9} textAnchor="middle" fontSize={2.2} className="fill-background font-bold">{ICON[i.type]}</text>
        </g>
      ))}
      {units.map((u) => (
        <g key={u.id}>
          <rect x={u.x - 1.6} y={u.y - 1.6} width={3.2} height={3.2} rx={0.6} className={u.status === "available" ? "fill-accent" : "fill-accent/50 stroke-accent"} strokeWidth={0.3} />
          <text x={u.x} y={u.y - 2.4} textAnchor="middle" fontSize={1.8} className="fill-foreground font-mono">{u.callsign}</text>
        </g>
      ))}
    </svg>
  );
}
