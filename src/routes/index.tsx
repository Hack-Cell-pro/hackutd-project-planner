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

const ROLES: { id: Role; label: string; desc: string }[] = [
  { id: "caller", label: "Caller", desc: "Drop a pin and report an emergency." },
  { id: "dispatcher", label: "Dispatcher", desc: "Rank incidents and send units." },
  { id: "responder", label: "Responder", desc: "Crew a unit and resolve incidents." },
  { id: "spectator", label: "Big screen", desc: "Live board for judges and the crowd." },
];

function Index() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("dispatcher");
  const [err, setErr] = useState("");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <div className="font-mono text-xs tracking-[0.3em] text-primary">● LIVE · HACKUTD 2026</div>
      <h1 className="mt-4 text-6xl font-bold tracking-tight md:text-7xl">FirstWave</h1>
      <p className="mt-4 max-w-xl text-lg text-muted-foreground">
        A live emergency dispatch room. Callers report, dispatchers send help, and responders close the call. Every screen updates instantly.
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
              <div className="font-semibold">{r.label}</div>
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
    </main>
  );
}
