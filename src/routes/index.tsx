import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { join } from "@/lib/live";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Emoji Charades: The Live Party Game" },
      { name: "description", content: "One player gets a secret phrase and can only describe it with emojis. The whole room races to guess — live, on every phone at once." },
      { property: "og:title", content: "Emoji Charades: The Live Party Game" },
      { property: "og:description", content: "Describe the secret phrase with emojis only. Fastest guess wins. Every screen stays in sync, live." },
    ],
  }),
  component: Index,
});

const FLOW = [
  { step: "01", title: "Everyone joins", body: "Open the link on your phone, type a name, done. No accounts, no app store." },
  { step: "02", title: "One player gets a secret phrase", body: "They can only describe it with emojis — no letters allowed. The server enforces it." },
  { step: "03", title: "The room races to guess", body: "Fastest correct guess scores the most. The cluer scores too when someone cracks it." },
];

const SERVER_SIDE = [
  ["The round clock", "Clue time, guessing time and reveals all run on a timer inside SpacetimeDB — nobody's browser is in charge."],
  ["Emoji-only rules", "Try to sneak letters into your clue and the server rejects it."],
  ["Guess checking", "Answers are matched where the data lives, so the phrase never has to be trusted to a browser."],
  ["Scoring", "Speed bonuses and cluer points are computed server-side the instant someone guesses right."],
];

function Index() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-16 px-6 py-16">
      <section>
        <div className="font-mono text-xs tracking-[0.3em] text-primary">● LIVE · HACKUTD 2026</div>
        <h1 className="mt-4 text-6xl font-bold tracking-tight md:text-7xl">Emoji Charades</h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          The party game where one player gets a secret phrase and can only describe it with emojis. Everyone else races to guess. Every screen in the room updates instantly — and every rule runs inside SpacetimeDB.
        </p>

        <form
          className="mt-10 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErr("");
            join(name)
              .then(() => nav({ to: "/room" }))
              .catch((x) => setErr((x as Error).message));
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              className="flex-1 rounded-md border border-input bg-card px-4 py-3 font-mono outline-none focus:border-ring" />
            <button className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">Join the game →</button>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <p className="text-sm text-muted-foreground">
            First person in becomes the host. Put the <a href="/board" className="underline">big screen</a> on a projector so everyone can watch.
          </p>
        </form>
      </section>

      <section>
        <h2 className="font-mono text-xs tracking-[0.3em] text-muted-foreground">HOW A ROUND WORKS</h2>
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
