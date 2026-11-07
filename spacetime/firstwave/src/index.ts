// FirstWave SpacetimeDB module (TypeScript, SDK 2.x).
// Every dispatch rule runs here. Mirrors src/lib/engine.ts reducer-for-reducer.
import { schema, table, t, SenderError, ScheduleAt } from "spacetimedb/server";

const Player = table({ name: "player", public: true }, {
  identity: t.identity().primaryKey(),
  name: t.string(),
  role: t.string(),
  score: t.u32(),
  online: t.bool(),
});

const Incident = table({ name: "incident", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  kind: t.string(),
  severity: t.u8(),
  x: t.f32(),
  y: t.f32(),
  note: t.string(),
  status: t.string(),
  createdAt: t.timestamp(),
  lastEscalated: t.timestamp(),
  unitId: t.option(t.u64()),
  assignedBy: t.option(t.identity()),
  reporter: t.string(),
});

const Unit = table({ name: "unit", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  callsign: t.string(),
  kind: t.string(),
  x: t.f32(),
  y: t.f32(),
  status: t.string(),
  owner: t.option(t.identity()),
  targetId: t.option(t.u64()),
  fromX: t.f32(),
  fromY: t.f32(),
  departAt: t.u64(),
  etaAt: t.u64(),
});

const EventLog = table({ name: "event_log", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  ts: t.timestamp(),
  actor: t.string(),
  kind: t.string(),
  text: t.string(),
});

// The clock. One row = one scheduled tick. Rows are deleted automatically
// after the scheduled reducer runs, so `tick` queues the next one itself.
const Tick = table({ name: "tick_schedule", public: false }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const spacetimedb = schema({
  player: Player,
  incident: Incident,
  unit: Unit,
  eventLog: EventLog,
  tickSchedule: Tick,
});

const TICK_EVERY = 500_000n; // microseconds -> 2 ticks per second
const ESCALATE_AFTER_MS = 60_000;

const nowMs = (ctx: any) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

const log = (ctx: any, actor: string, kind: string, text: string) =>
  ctx.db.eventLog.insert({ id: 0n, ts: ctx.timestamp, actor, kind, text });

const me = (ctx: any) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new SenderError("Join first");
  return p;
};

const queueTick = (ctx: any) =>
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_EVERY) });

export const init = spacetimedb.init((ctx) => {
  const seed = [
    ["ENGINE 7", "fire", 20, 25],
    ["LADDER 3", "fire", 75, 70],
    ["MEDIC 12", "medical", 50, 50],
    ["MEDIC 4", "medical", 85, 20],
    ["SWIFT 1", "flood", 15, 80],
    ["GRID 9", "power", 60, 15],
  ] as const;
  for (const [callsign, kind, x, y] of seed) {
    ctx.db.unit.insert({
      id: 0n, callsign, kind, x, y, status: "available", owner: undefined, targetId: undefined,
      fromX: x, fromY: y, departAt: 0n, etaAt: 0n,
    });
  }
  queueTick(ctx);
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: true });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: false });
});

export const join = spacetimedb.reducer({ name: t.string(), role: t.string() }, (ctx, { name, role }) => {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError("Name required");
  if (!["caller", "dispatcher", "responder", "spectator"].includes(role)) throw new SenderError("Bad role");
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, name: clean, role });
  else ctx.db.player.insert({ identity: ctx.sender, name: clean, role, score: 0, online: true });
  log(ctx, clean, "join", `${clean} joined as ${role}`);
});

export const report_incident = spacetimedb.reducer(
  { kind: t.string(), severity: t.u8(), x: t.f32(), y: t.f32(), note: t.string() },
  (ctx, a) => {
    const p = me(ctx);
    if (!["fire", "medical", "flood", "power"].includes(a.kind)) throw new SenderError("Bad incident type");
    if (a.severity < 1 || a.severity > 5) throw new SenderError("Severity must be 1-5");
    if (a.x < 0 || a.x > 100 || a.y < 0 || a.y > 100) throw new SenderError("Location is off the map");
    const row = ctx.db.incident.insert({
      id: 0n, kind: a.kind, severity: a.severity, x: a.x, y: a.y, note: a.note.slice(0, 140),
      status: "open", createdAt: ctx.timestamp, lastEscalated: ctx.timestamp,
      unitId: undefined, assignedBy: undefined, reporter: p.name,
    });
    log(ctx, p.name, "report", `#${row.id} ${a.kind.toUpperCase()} sev ${a.severity} reported by ${p.name}`);
  },
);

export const assign_unit = spacetimedb.reducer({ incidentId: t.u64(), unitId: t.u64() }, (ctx, { incidentId, unitId }) => {
  const p = me(ctx);
  if (p.role !== "dispatcher") throw new SenderError("Only dispatchers can assign units");
  const inc = ctx.db.incident.id.find(incidentId);
  const u = ctx.db.unit.id.find(unitId);
  if (!inc || !u) throw new SenderError("Not found");
  if (inc.status !== "open") throw new SenderError("Incident already handled");
  if (u.status !== "available") throw new SenderError("Unit is busy");
  const now = nowMs(ctx);
  const eta = now + Math.max(5000, Math.round(Math.hypot(u.x - inc.x, u.y - inc.y) * 250));
  ctx.db.incident.id.update({ ...inc, status: "en_route", unitId: u.id, assignedBy: ctx.sender });
  ctx.db.unit.id.update({
    ...u, status: "en_route", targetId: inc.id, fromX: u.x, fromY: u.y,
    departAt: BigInt(now), etaAt: BigInt(eta),
  });
  ctx.db.player.identity.update({ ...p, score: p.score + 5 });
  log(ctx, p.name, "assign", `${u.callsign} dispatched to #${inc.id} by ${p.name}`);
});

export const claim_unit = spacetimedb.reducer({ unitId: t.u64() }, (ctx, { unitId }) => {
  const p = me(ctx);
  if (p.role !== "responder") throw new SenderError("Only responders can crew a unit");
  for (const u of ctx.db.unit.iter()) {
    if (u.owner && u.owner.isEqual(ctx.sender)) ctx.db.unit.id.update({ ...u, owner: undefined });
  }
  const u = ctx.db.unit.id.find(unitId);
  if (!u) throw new SenderError("Not found");
  if (u.owner && !u.owner.isEqual(ctx.sender)) throw new SenderError("Unit already crewed");
  ctx.db.unit.id.update({ ...u, owner: ctx.sender });
});

export const resolve_incident = spacetimedb.reducer({ incidentId: t.u64() }, (ctx, { incidentId }) => {
  const p = me(ctx);
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc || inc.status !== "on_scene") throw new SenderError("Unit must be on scene first");
  const u = inc.unitId != null ? ctx.db.unit.id.find(inc.unitId) : undefined;
  if (p.role === "responder" && !(u && u.owner && u.owner.isEqual(ctx.sender))) {
    throw new SenderError("Not your unit");
  }
  if (p.role !== "responder" && p.role !== "dispatcher") throw new SenderError("Not allowed");
  const mins = (nowMs(ctx) - Number(inc.createdAt.microsSinceUnixEpoch / 1000n)) / 60000;
  const pts = Math.max(5, Math.round(inc.severity * 20 - mins * 5));
  ctx.db.incident.id.update({ ...inc, status: "resolved" });
  if (u) ctx.db.unit.id.update({ ...u, status: "available", targetId: undefined });
  ctx.db.player.identity.update({ ...p, score: p.score + pts });
  // The dispatcher who sent the unit gets half credit.
  if (inc.assignedBy && !inc.assignedBy.isEqual(ctx.sender)) {
    const d = ctx.db.player.identity.find(inc.assignedBy);
    if (d) ctx.db.player.identity.update({ ...d, score: d.score + Math.round(pts / 2) });
  }
  log(ctx, p.name, "resolve", `#${inc.id} resolved in ${mins.toFixed(1)} min (+${pts})`);
});

export const cancel_incident = spacetimedb.reducer({ incidentId: t.u64() }, (ctx, { incidentId }) => {
  const p = me(ctx);
  if (p.role !== "dispatcher") throw new SenderError("Only dispatchers can cancel incidents");
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) throw new SenderError("Not found");
  if (inc.status === "resolved") throw new SenderError("Already closed");
  ctx.db.incident.id.update({ ...inc, status: "resolved" });
  if (inc.unitId != null) {
    const u = ctx.db.unit.id.find(inc.unitId);
    if (u) ctx.db.unit.id.update({ ...u, status: "available", targetId: undefined });
  }
  log(ctx, p.name, "cancel", `#${inc.id} cancelled by ${p.name} (false alarm)`);
});

export const trigger_disaster = spacetimedb.reducer({ n: t.u8() }, (ctx, { n }) => {
  const p = me(ctx);
  const kinds = ["fire", "medical", "flood", "power"];
  const cx = 20 + ctx.random() * 60;
  const count = Math.min(n, 12);
  for (let k = 0; k < count; k++) {
    ctx.db.incident.insert({
      id: 0n,
      kind: kinds[k % 4],
      severity: 2 + Math.floor(ctx.random() * 4),
      x: Math.min(95, Math.max(5, cx + (ctx.random() - 0.5) * 40)),
      y: 5 + ctx.random() * 90,
      note: "Storm cell damage",
      status: "open",
      createdAt: ctx.timestamp,
      lastEscalated: ctx.timestamp,
      unitId: undefined,
      assignedBy: undefined,
      reporter: "STORM",
    });
  }
  log(ctx, p.name, "disaster", `Storm cell triggered by ${p.name}: ${count} new incidents`);
});

// The heartbeat: escalation + unit travel. Queues the next tick before returning.
export const tick = spacetimedb.reducer(
  { onSchedule: Tick },
  { arg: Tick.rowType },
  (ctx) => {
    queueTick(ctx);
    const now = nowMs(ctx);
    for (const i of ctx.db.incident.iter()) {
      const last = Number(i.lastEscalated.microsSinceUnixEpoch / 1000n);
      if (i.status === "open" && i.severity < 5 && now - last >= ESCALATE_AFTER_MS) {
        ctx.db.incident.id.update({ ...i, severity: i.severity + 1, lastEscalated: ctx.timestamp });
        log(ctx, "SYSTEM", "escalate", `#${i.id} escalated to sev ${i.severity + 1}: no response`);
      }
    }
    for (const u of ctx.db.unit.iter()) {
      if (u.status !== "en_route" || u.targetId == null) continue;
      const inc = ctx.db.incident.id.find(u.targetId);
      if (!inc) continue;
      const span = Number(u.etaAt - u.departAt) || 1;
      const tt = Math.min(1, (now - Number(u.departAt)) / span);
      const x = u.fromX + (inc.x - u.fromX) * tt;
      const y = u.fromY + (inc.y - u.fromY) * tt;
      if (tt >= 1) {
        ctx.db.unit.id.update({ ...u, x, y, status: "on_scene" });
        ctx.db.incident.id.update({ ...inc, status: "on_scene" });
        log(ctx, "SYSTEM", "arrive", `${u.callsign} on scene at #${inc.id}`);
      } else {
        ctx.db.unit.id.update({ ...u, x, y });
      }
    }
  },
);

export default spacetimedb;
