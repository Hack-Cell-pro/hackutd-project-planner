// Local stand-in for the FirstWave Spacetime module.
// Each function below has the same name and rules as a reducer in spacetime/firstwave/src/index.ts.
// State lives in localStorage and syncs across browser tabs, so the multiplayer demo works on one
// machine. To switch to Spacetime, swap these calls for conn.reducers.* and these reads for table
// subscriptions.
import { useEffect, useState } from "react";

export type Role = "caller" | "dispatcher" | "responder" | "spectator";
export type IncidentType = "fire" | "medical" | "flood" | "power";
export type IncidentStatus = "open" | "assigned" | "en_route" | "on_scene" | "resolved";
export type UnitStatus = "available" | "en_route" | "on_scene";

export interface Player { id: string; name: string; role: Role; score: number; lastSeen: number }
export interface Incident {
  id: number; type: IncidentType; severity: number; x: number; y: number; note: string;
  status: IncidentStatus; createdAt: number; assignedAt?: number | undefined; resolvedAt?: number | undefined;
  unitId?: number | undefined; reporter: string; lastEscalated: number;
}
export interface Unit {
  id: number; callsign: string; kind: IncidentType; x: number; y: number;
  status: UnitStatus; ownerId?: string | undefined; targetId?: number | undefined; etaAt?: number | undefined;
  fromX?: number | undefined; fromY?: number | undefined; departAt?: number | undefined;
}
export interface LogEvent { id: number; ts: number; actor: string; kind: string; text: string }
export interface State { players: Player[]; incidents: Incident[]; units: Unit[]; events: LogEvent[]; nextId: number }

const KEY = "firstwave-state-v1";
const ESCALATE_AFTER_MS = 60_000;

export const UNIT_SEED: Unit[] = [
  { id: 1, callsign: "ENGINE 7", kind: "fire", x: 20, y: 25, status: "available" },
  { id: 2, callsign: "LADDER 3", kind: "fire", x: 75, y: 70, status: "available" },
  { id: 3, callsign: "MEDIC 12", kind: "medical", x: 50, y: 50, status: "available" },
  { id: 4, callsign: "MEDIC 4", kind: "medical", x: 85, y: 20, status: "available" },
  { id: 5, callsign: "SWIFT 1", kind: "flood", x: 15, y: 80, status: "available" },
  { id: 6, callsign: "GRID 9", kind: "power", x: 60, y: 15, status: "available" },
];

function fresh(): State {
  return { players: [], incidents: [], units: UNIT_SEED.map((u) => ({ ...u })), events: [], nextId: 100 };
}

function read(): State {
  if (typeof window === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as State) : fresh();
  } catch {
    return fresh();
  }
}

const listeners = new Set<(s: State) => void>();
function write(s: State) {
  localStorage.setItem(KEY, JSON.stringify(s));
  listeners.forEach((l) => l(s));
}

function tx(fn: (s: State) => void) {
  const s = read();
  fn(s);
  s.events = s.events.slice(-200);
  write(s);
}

function log(s: State, actor: string, kind: string, text: string) {
  s.events.push({ id: s.nextId++, ts: Date.now(), actor, kind, text });
}

export class ReducerError extends Error {}
function fail(msg: string): never { throw new ReducerError(msg); }

export function getMyId(): string {
  let id = localStorage.getItem("firstwave-me");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("firstwave-me", id); }
  return id;
}

export function priority(i: Incident, now = Date.now()): number {
  return i.severity * 10 + Math.floor((now - i.createdAt) / 60_000);
}

export function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

// Travel time: 1 map unit ≈ 0.25s, min 5s, so the demo stays snappy.
export function travelMs(d: number) { return Math.max(5_000, Math.round(d * 250)); }

// ---------- reducers ----------
export function join(name: string, role: Role) {
  const id = getMyId();
  const clean = name.trim().slice(0, 24);
  if (!clean) fail("Name required");
  tx((s) => {
    const p = s.players.find((p) => p.id === id);
    if (p) { p.name = clean; p.role = role; p.lastSeen = Date.now(); }
    else s.players.push({ id, name: clean, role, score: 0, lastSeen: Date.now() });
    log(s, clean, "join", `${clean} joined as ${role}`);
  });
}

function me(s: State): Player {
  const p = s.players.find((p) => p.id === getMyId());
  if (!p) fail("Join first");
  return p;
}

export function reportIncident(type: IncidentType, severity: number, x: number, y: number, note: string) {
  if (severity < 1 || severity > 5) fail("Severity must be 1–5");
  tx((s) => {
    const p = me(s);
    const now = Date.now();
    const id = s.nextId++;
    s.incidents.push({ id, type, severity, x, y, note: note.slice(0, 140), status: "open", createdAt: now, reporter: p.name, lastEscalated: now });
    log(s, p.name, "report", `#${id} ${type.toUpperCase()} sev ${severity} reported by ${p.name}`);
  });
}

export function assignUnit(incidentId: number, unitId: number) {
  tx((s) => {
    const p = me(s);
    if (p.role !== "dispatcher") fail("Only dispatchers can assign units");
    const inc = s.incidents.find((i) => i.id === incidentId) ?? fail("No such incident");
    const unit = s.units.find((u) => u.id === unitId) ?? fail("No such unit");
    if (inc.status !== "open") fail("Incident already handled");
    if (unit.status !== "available") fail("Unit is busy");
    const now = Date.now();
    inc.status = "en_route"; inc.unitId = unit.id; inc.assignedAt = now;
    Object.assign(unit, {
      status: "en_route", targetId: inc.id, fromX: unit.x, fromY: unit.y, departAt: now,
      etaAt: now + travelMs(distance(unit.x, unit.y, inc.x, inc.y)),
    });
    p.score += 5;
    log(s, p.name, "assign", `${unit.callsign} dispatched to #${inc.id} by ${p.name}`);
  });
}

export function claimUnit(unitId: number) {
  tx((s) => {
    const p = me(s);
    if (p.role !== "responder") fail("Only responders can crew a unit");
    s.units.forEach((u) => { if (u.ownerId === p.id) u.ownerId = undefined; });
    const u = s.units.find((u) => u.id === unitId) ?? fail("No such unit");
    if (u.ownerId && u.ownerId !== p.id) fail("Unit already crewed");
    u.ownerId = p.id;
    log(s, p.name, "crew", `${p.name} is crewing ${u.callsign}`);
  });
}

export function resolveIncident(incidentId: number) {
  tx((s) => {
    const p = me(s);
    const inc = s.incidents.find((i) => i.id === incidentId) ?? fail("No such incident");
    const unit = s.units.find((u) => u.id === inc.unitId);
    if (inc.status !== "on_scene") fail("Unit must be on scene first");
    if (p.role === "responder" && unit?.ownerId !== p.id) fail("Not your unit");
    if (p.role !== "responder" && p.role !== "dispatcher") fail("Not allowed");
    inc.status = "resolved"; inc.resolvedAt = Date.now();
    if (unit) Object.assign(unit, { status: "available", targetId: undefined, etaAt: undefined });
    const mins = (inc.resolvedAt - inc.createdAt) / 60_000;
    const pts = Math.max(5, Math.round(inc.severity * 20 - mins * 5));
    p.score += pts;
    const dispatcher = s.players.find((x) => x.role === "dispatcher" && x.id !== p.id);
    if (dispatcher) dispatcher.score += Math.round(pts / 2);
    log(s, p.name, "resolve", `#${inc.id} resolved in ${mins.toFixed(1)} min (+${pts})`);
  });
}

export function triggerDisaster(n = 6) {
  tx((s) => {
    const p = me(s);
    const now = Date.now();
    const types: IncidentType[] = ["fire", "medical", "flood", "power"];
    const cx = 20 + Math.random() * 60;
    for (let k = 0; k < n; k++) {
      const id = s.nextId++;
      s.incidents.push({
        id, type: types[k % 4]!, severity: 2 + Math.floor(Math.random() * 4),
        x: Math.min(95, Math.max(5, cx + (Math.random() - 0.5) * 40)), y: 5 + Math.random() * 90,
        note: "Storm cell damage", status: "open", createdAt: now, reporter: "STORM", lastEscalated: now,
      });
    }
    log(s, p.name, "disaster", `⚠ Storm cell triggered by ${p.name}: ${n} new incidents`);
  });
}

export function resetRoom() { write(fresh()); }

// Scheduled reducer: escalation + travel. Runs in exactly one tab (leader lock).
export function tick() {
  tx((s) => {
    const now = Date.now();
    for (const i of s.incidents) {
      if (i.status === "open" && i.severity < 5 && now - i.lastEscalated >= ESCALATE_AFTER_MS) {
        i.severity += 1; i.lastEscalated = now;
        log(s, "SYSTEM", "escalate", `#${i.id} escalated to sev ${i.severity}: no response`);
      }
    }
    for (const u of s.units) {
      if (u.status !== "en_route" || !u.etaAt || u.departAt == null) continue;
      const inc = s.incidents.find((i) => i.id === u.targetId);
      if (!inc) { u.status = "available"; continue; }
      const t = Math.min(1, (now - u.departAt) / (u.etaAt - u.departAt));
      u.x = u.fromX! + (inc.x - u.fromX!) * t;
      u.y = u.fromY! + (inc.y - u.fromY!) * t;
      if (t >= 1) {
        u.status = "on_scene"; inc.status = "on_scene";
        log(s, "SYSTEM", "arrive", `${u.callsign} on scene at #${inc.id}`);
      }
    }
  });
}

// ---------- subscription ----------
export function useRoom(): State | null {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    setState(read());
    const l = (s: State) => setState({ ...s });
    listeners.add(l);
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setState(read()); };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
  }, []);
  return state;
}

export function useLeaderTick() {
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () => { timer = setInterval(() => { if (!stop) tick(); }, 500); };
    if ("locks" in navigator) {
      navigator.locks.request("firstwave-leader", () => new Promise<void>((resolve) => {
        if (stop) return resolve();
        run();
        const check = setInterval(() => { if (stop) { clearInterval(check); resolve(); } }, 500);
      }));
    } else run();
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, []);
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
