import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { join, type Role } from "@/lib/engine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FirstWave: Live Emergency Dispatch" },
      { name: "description", content: "Multiplayer disaster-response command center: report, dispatch and resolve incidents in real time." },
      { property: "og:title", content: "FirstWave: Live Emergency Dispatch" },
      { property: "og:description", content: "Report, dispatch and resolve incidents together, live on one city map." },
    ],
  }),
  component: Index,
});

const ROLES: { id: Role; label: string; desc: string; icon: string }[] = [
  { id: "caller", label: "Caller", desc: "Drop a pin and report an emergency.", icon: "📞" },
  { id: "dispatcher", label: "Dispatcher", desc: "Rank incidents and send units.", icon: "🎛" },
  { id: "responder", label: "Responder", desc: "Crew a unit and resolve incidents.", icon: "🚒" },
  { id: "spectator", label: "Big screen", desc: "Live board for judges and the crowd.", icon: "📡" },
];

const FLOW = [
  { step: "01", title: "A call comes in", body: "A caller drops a pin on the live city map. Every screen in the room sees it the same instant." },
  { step: "02", title: "Dispatch decides", body: "The queue ranks itself by severity and wait time. The dispatcher sends the nearest free unit." },
  { step: "03", title: "The city responds", body: "The unit rolls across the map with a live ETA, arrives on scene, and the call is closed. Scores update." },
];

const SERVER_SIDE = [
  ["Assignment rules", "Only dispatchers can assign, and a busy unit can't be double-sent."],
  ["Escalation timer", "Incidents nobody touches for 60 seconds raise their own severity."],
  ["Travel simulation", "Units move toward their target on a server clock and arrive on schedule."],
  ["Scoring", "Response time and severity decide points — computed where the data lives."],
];

function Index() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("dispatcher");
  const [err, setErr] = useState("");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-16 px-6 py-16">
      <section>
        <div className="font-mono text-xs tracking-[0.3em] text-primary">● LIVE · HACKUTD 2026</div>
        <h1 className="mt-4 text-6xl font-bold tracking-tight md:text-7xl">FirstWave</h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          A live emergency dispatch room. Callers report, dispatchers send help, and responders close the call. Every screen updates instantly — and every rule runs inside SpacetimeDB.
        </p>

        <form
          className="mt-10 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              join(name, role);
              nav({ to: role === "spectator" ? "/board" : "/room" });
            } catch (x) { setErr((x as Error).message); }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {ROLES.map((r) => (
              <button type="button" key={r.id} onClick={() => setRole(r.id)}
                className={`rounded-md border p-4 text-left transition-colors ${role === r.id ? "border-primary bg-secondary" : "border-border bg-card hover:bg-secondary"}`}>
                <div className="text-xl">{r.icon}</div>
                <div className="mt-1 font-semibold">{r.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{r.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your call sign"
              className="flex-1 rounded-md border border-input bg-card px-4 py-3 font-mono outline-none focus:border-ring" />
            <button className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">Enter the room →</button>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </form>
      </section>

      <section>
        <h2 className="font-mono text-xs tracking-[0.3em] text-muted-foreground">HOW A CALL FLOWS</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {FLOW.map((f) => (
            <div key={f.step} className="rounded-md border border-border bg-card p-4">
              <div className="font-mono text-xs text-primary">{f.step}</div>
              <div className="mt-1 font-semibold">{f.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-xs tracking-[0.3em] text-muted-foreground">NO SERVERS WE WROTE — THE LOGIC LIVES IN SPACETIMEDB</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SERVER_SIDE.map(([t, b]) => (
            <div key={t} className="flex gap-3 rounded-md border border-border bg-card p-4">
              <span className="text-accent">▸</span>
              <div>
                <div className="font-semibold">{t}</div>
                <p className="mt-1 text-sm text-muted-foreground">{b}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
