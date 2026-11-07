// Live client for the FirstWave Spacetime module on Maincloud.
// Same exported API as src/lib/engine.ts, but every action is a real reducer call and
// every read comes from table subscriptions. engine.ts stays as the offline stand-in for tests.
import { useEffect, useState } from "react";
import { DbConnection } from "@/module_bindings";
import type { Incident, IncidentStatus, IncidentType, LogEvent, Player, Role, State, Unit, UnitStatus } from "@/lib/engine";

export { priority, distance, useNow, ESCALATE_AFTER_MS } from "@/lib/engine";
export type { Incident, IncidentType, LogEvent, Player, Role, State, Unit } from "@/lib/engine";

const URI = "wss://maincloud.spacetimedb.com";
const DB = "firstwave";
const TOKEN_KEY = "firstwave-spacetime-token";

let conn: DbConnection | null = null;
let myId = "";
let snapshot: State | null = null;
let ready: Promise<DbConnection> | null = null;
const listeners = new Set<(s: State | null) => void>();

const ms = (v: { toMillis(): bigint }) => Number(v.toMillis());

function rebuild() {
  if (!conn) return;
  const db = conn.db;
  const players: Player[] = [...db.player.iter()].map((p) => ({
    id: p.identity.toHexString(), name: p.name, role: p.role as Role, score: p.score,
    lastSeen: p.online ? Date.now() : 0,
  }));
  const incidents: Incident[] = [...db.incident.iter()].map((i) => ({
    id: Number(i.id), type: i.kind as IncidentType, severity: i.severity, x: i.x, y: i.y, note: i.note,
    status: i.status as IncidentStatus, createdAt: ms(i.createdAt), lastEscalated: ms(i.lastEscalated),
    unitId: i.unitId == null ? undefined : Number(i.unitId),
    assignedBy: i.assignedBy ? i.assignedBy.toHexString() : undefined,
    resolvedAt: i.status === "resolved" ? ms(i.lastEscalated) : undefined,
    reporter: i.reporter,
  })).sort((a, b) => a.id - b.id);
  const units: Unit[] = [...db.unit.iter()].map((u) => ({
    id: Number(u.id), callsign: u.callsign, kind: u.kind as IncidentType, x: u.x, y: u.y,
    status: u.status as UnitStatus, ownerId: u.owner ? u.owner.toHexString() : undefined,
    targetId: u.targetId == null ? undefined : Number(u.targetId),
    fromX: u.fromX, fromY: u.fromY,
    departAt: u.departAt ? Number(u.departAt) : undefined, etaAt: u.etaAt ? Number(u.etaAt) : undefined,
  })).sort((a, b) => a.id - b.id);
  const events: LogEvent[] = [...db.eventLog.iter()].map((e) => ({
    id: Number(e.id), ts: ms(e.ts), actor: e.actor, kind: e.kind, text: e.text,
  })).sort((a, b) => a.id - b.id).slice(-200);
  snapshot = { players, incidents, units, events, nextId: 0 };
  listeners.forEach((l) => l(snapshot));
}

function connect(): Promise<DbConnection> {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
      .onConnect((c, identity, token) => {
        localStorage.setItem(TOKEN_KEY, token);
        conn = c; myId = identity.toHexString();
        for (const tbl of [c.db.player, c.db.incident, c.db.unit, c.db.eventLog] as const) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = tbl as any;
          t.onInsert(rebuild); t.onUpdate?.(rebuild); t.onDelete(rebuild);
        }
        c.subscriptionBuilder().onApplied(() => { rebuild(); resolve(c); }).subscribeToAllTables();
      })
      .onConnectError((_c, err) => { ready = null; reject(err); })
      .onDisconnect(() => { ready = null; conn = null; })
      .build();
  });
  return ready;
}

export function getMyId() { return myId; }

async function call<T>(fn: (c: DbConnection) => Promise<T>) {
  const c = await connect();
  return fn(c);
}

// ---------- reducers (snake_case in the module, camelCase here) ----------
export const join = (name: string, role: Role) => {
  const clean = name.trim().slice(0, 24);
  if (!clean) return Promise.reject(new Error("Name required"));
  return call((c) => c.reducers.join({ name: clean, role }));
};
export const reportIncident = (kind: IncidentType, severity: number, x: number, y: number, note: string) =>
  call((c) => c.reducers.reportIncident({ kind, severity, x, y, note }));
export const assignUnit = (incidentId: number, unitId: number) =>
  call((c) => c.reducers.assignUnit({ incidentId: BigInt(incidentId), unitId: BigInt(unitId) }));
export const claimUnit = (unitId: number) => call((c) => c.reducers.claimUnit({ unitId: BigInt(unitId) }));
export const resolveIncident = (incidentId: number) =>
  call((c) => c.reducers.resolveIncident({ incidentId: BigInt(incidentId) }));
export const cancelIncident = (incidentId: number) =>
  call((c) => c.reducers.cancelIncident({ incidentId: BigInt(incidentId) }));
export const triggerDisaster = (n = 6) => call((c) => c.reducers.triggerDisaster({ n }));

// The clock runs inside Spacetime (scheduled `tick` reducer), so the browser does nothing.
export function useLeaderTick() {}

export function useRoom(): State | null {
  const [state, setState] = useState<State | null>(snapshot);
  useEffect(() => {
    listeners.add(setState);
    connect().then(() => setState(snapshot)).catch((e) => console.error("Spacetime connect failed", e));
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}
