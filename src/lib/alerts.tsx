// Live alerts: plays a short tone and surfaces a banner when important events land.
// Used by the room and the big screen. Sound starts only after the first user gesture
// (browser autoplay policy), so the first beep may be skipped until someone clicks.
import { useEffect, useRef, useState } from "react";
import type { LogEvent, State } from "@/lib/engine";

const ALERT_KINDS: Record<string, { freq: number; ms: number }> = {
  round: { freq: 520, ms: 150 },
  clue: { freq: 660, ms: 120 },
  correct: { freq: 880, ms: 250 },
  reveal: { freq: 440, ms: 250 },
  final: { freq: 740, ms: 400 },
};

let ctx: AudioContext | null = null;
function beep(freq: number, ms: number) {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    // No audio available — banner still shows.
  }
}

export interface Alert { id: number; text: string; kind: string }

export function useEventAlerts(state: State | null): Alert | null {
  const [alert, setAlert] = useState<Alert | null>(null);
  const lastSeen = useRef<number | null>(null);

  useEffect(() => {
    if (!state) return;
    const latest = state.events.at(-1);
    if (!latest) return;
    if (lastSeen.current === null) {
      // First load: don't replay history, just mark the position.
      lastSeen.current = latest.id;
      return;
    }
    if (latest.id === lastSeen.current) return;
    const fresh = state.events.filter((e) => e.id > lastSeen.current!);
    lastSeen.current = latest.id;
    const important = [...fresh].reverse().find((e: LogEvent) => ALERT_KINDS[e.kind]);
    if (!important) return;
    const tone = ALERT_KINDS[important.kind]!;
    beep(tone.freq, tone.ms);
    setAlert({ id: important.id, text: important.text, kind: important.kind });
    const t = setTimeout(() => setAlert(null), 4000);
    return () => clearTimeout(t);
  }, [state]);

  return alert;
}

export function AlertBanner({ alert }: { alert: Alert | null }) {
  if (!alert) return null;
  const hot = alert.kind === "correct" || alert.kind === "final";
  return (
    <div
      className={`pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-md border px-4 py-2 font-mono text-sm shadow-lg ${
        hot ? "border-accent bg-card text-accent" : "border-primary bg-card text-primary"
      }`}
    >
      {hot ? "★ " : "● "}{alert.text}
    </div>
  );
}
