// FirstWave SpacetimeDB module (TypeScript). All dispatch rules run here.
// Mirrors src/lib/engine.ts. Check the API against the version `spacetime init` installs.
import { schema, table, t, SenderError } from "spacetimedb/server";

const Player = table({ name: "player", public: true }, {
  identity: t.identity().primaryKey(),
  name: t.string(), role: t.string(), score: t.u32(), online: t.bool(),
});
const Incident = table({ name: "incident", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  kind: t.string(), severity: t.u8(), x: t.f32(), y: t.f32(), note: t.string(),
  status: t.string(), createdAt: t.timestamp(), lastEscalated: t.timestamp(),
  unitId: t.option(t.u64()), reporter: t.string(),
});
const Unit = table({ name: "unit", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  callsign: t.string(), kind: t.string(), x: t.f32(), y: t.f32(), status: t.string(),
  owner: t.option(t.identity()), targetId: t.option(t.u64()),
  fromX: t.f32(), fromY: t.f32(), departAt: t.u64(), etaAt: t.u64(),
});
const EventLog = table({ name: "event_log", public: true }, {
  id: t.u64().primaryKey().autoInc(), ts: t.timestamp(), actor: t.string(), kind: t.string(), text: t.string(),
});
const Tick = table({ name: "tick_schedule", scheduled: "tick" }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(),
});

const spacetimedb = schema(Player, Incident, Unit, EventLog, Tick);

const nowMs = (ctx: any) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
const log = (ctx: any, actor: string, kind: string, text: string) =>
  ctx.db.eventLog.insert({ id: 0n, ts: ctx.timestamp, actor, kind, text });
const me = (ctx: any) => ctx.db.player.identity.find(ctx.sender) ?? (() => { throw new SenderError("Join first"); })();

spacetimedb.init((ctx) => {
  const seed = [["ENGINE 7", "fire", 20, 25], ["LADDER 3", "fire", 75, 70], ["MEDIC 12", "medical", 50, 50],
    ["MEDIC 4", "medical", 85, 20], ["SWIFT 1", "flood", 15, 80], ["GRID 9", "power", 60, 15]] as const;
  for (const [callsign, kind, x, y] of seed)
    ctx.db.unit.insert({ id: 0n, callsign, kind, x, y, status: "available", owner: undefined, targetId: undefined, fromX: x, fromY: y, departAt: 0n, etaAt: 0n });
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: { tag: "Interval", value: { micros: 500_000n } } as any });
});

spacetimedb.clientConnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: true });
});
spacetimedb.clientDisconnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: false });
});

spacetimedb.reducer("join", { name: t.string(), role: t.string() }, (ctx, { name, role }) => {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError("Name required");
  if (!["caller", "dispatcher", "responder", "spectator"].includes(role)) throw new SenderError("Bad role");
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, name: clean, role });
  else ctx.db.player.insert({ identity: ctx.sender, name: clean, role, score: 0, online: true });
  log(ctx, clean, "join", `${clean} joined as ${role}`);
});

spacetimedb.reducer("report_incident",
  { kind: t.string(), severity: t.u8(), x: t.f32(), y: t.f32(), note: t.string() },
  (ctx, a) => {
    const p = me(ctx);
    if (a.severity < 1 || a.severity > 5) throw new SenderError("Severity must be 1-5");
    const row = ctx.db.incident.insert({ id: 0n, ...a, note: a.note.slice(0, 140), status: "open",
      createdAt: ctx.timestamp, lastEscalated: ctx.timestamp, unitId: undefined, reporter: p.name });
    log(ctx, p.name, "report", `#${row.id} ${a.kind.toUpperCase()} sev ${a.severity} reported by ${p.name}`);
  });

spacetimedb.reducer("assign_unit", { incidentId: t.u64(), unitId: t.u64() }, (ctx, { incidentId, unitId }) => {
  const p = me(ctx);
  if (p.role !== "dispatcher") throw new SenderError("Only dispatchers can assign units");
  const inc = ctx.db.incident.id.find(incidentId); const u = ctx.db.unit.id.find(unitId);
  if (!inc || !u) throw new SenderError("Not found");
  if (inc.status !== "open") throw new SenderError("Incident already handled");
  if (u.status !== "available") throw new SenderError("Unit is busy");
  const now = nowMs(ctx);
  const eta = now + Math.max(5000, Math.round(Math.hypot(u.x - inc.x, u.y - inc.y) * 250));
  ctx.db.incident.id.update({ ...inc, status: "en_route", unitId: u.id });
  ctx.db.unit.id.update({ ...u, status: "en_route", targetId: inc.id, fromX: u.x, fromY: u.y, departAt: BigInt(now), etaAt: BigInt(eta) });
  ctx.db.player.identity.update({ ...p, score: p.score + 5 });
  log(ctx, p.name, "assign", `${u.callsign} dispatched to #${inc.id} by ${p.name}`);
});

spacetimedb.reducer("claim_unit", { unitId: t.u64() }, (ctx, { unitId }) => {
  const p = me(ctx);
  if (p.role !== "responder") throw new SenderError("Only responders can crew a unit");
  for (const u of ctx.db.unit.iter()) if (u.owner?.isEqual(ctx.sender)) ctx.db.unit.id.update({ ...u, owner: undefined });
  const u = ctx.db.unit.id.find(unitId);
  if (!u) throw new SenderError("Not found");
  if (u.owner && !u.owner.isEqual(ctx.sender)) throw new SenderError("Unit already crewed");
  ctx.db.unit.id.update({ ...u, owner: ctx.sender });
});

spacetimedb.reducer("resolve_incident", { incidentId: t.u64() }, (ctx, { incidentId }) => {
  const p = me(ctx);
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc || inc.status !== "on_scene") throw new SenderError("Unit must be on scene first");
  const u = inc.unitId != null ? ctx.db.unit.id.find(inc.unitId) : undefined;
  if (p.role === "responder" && !u?.owner?.isEqual(ctx.sender)) throw new SenderError("Not your unit");
  if (p.role !== "responder" && p.role !== "dispatcher") throw new SenderError("Not allowed");
  const mins = (nowMs(ctx) - Number(inc.createdAt.microsSinceUnixEpoch / 1000n)) / 60000;
  const pts = Math.max(5, Math.round(inc.severity * 20 - mins * 5));
  ctx.db.incident.id.update({ ...inc, status: "resolved" });
  if (u) ctx.db.unit.id.update({ ...u, status: "available", targetId: undefined });
  ctx.db.player.identity.update({ ...p, score: p.score + pts });
  log(ctx, p.name, "resolve", `#${inc.id} resolved in ${mins.toFixed(1)} min (+${pts})`);
});

spacetimedb.reducer("trigger_disaster", { n: t.u8() }, (ctx, { n }) => {
  const p = me(ctx);
  const kinds = ["fire", "medical", "flood", "power"];
  const cx = 20 + ctx.random() * 60;
  for (let k = 0; k < Math.min(n, 12); k++)
    ctx.db.incident.insert({ id: 0n, kind: kinds[k % 4], severity: 2 + Math.floor(ctx.random() * 4),
      x: Math.min(95, Math.max(5, cx + (ctx.random() - 0.5) * 40)), y: 5 + ctx.random() * 90,
      note: "Storm cell damage", status: "open", createdAt: ctx.timestamp, lastEscalated: ctx.timestamp,
      unitId: undefined, reporter: "STORM" });
  log(ctx, p.name, "disaster", `Storm cell triggered by ${p.name}: ${n} new incidents`);
});

// Scheduled every 500ms: escalation + unit travel.
spacetimedb.reducer("tick", { arg: Tick.rowType }, (ctx) => {
  const now = nowMs(ctx);
  for (const i of ctx.db.incident.iter()) {
    const last = Number(i.lastEscalated.microsSinceUnixEpoch / 1000n);
    if (i.status === "open" && i.severity < 5 && now - last >= 60_000) {
      ctx.db.incident.id.update({ ...i, severity: i.severity + 1, lastEscalated: ctx.timestamp });
      log(ctx, "SYSTEM", "escalate", `#${i.id} escalated to sev ${i.severity + 1}: no response`);
    }
  }
  for (const u of ctx.db.unit.iter()) {
    if (u.status !== "en_route" || u.targetId == null) continue;
    const inc = ctx.db.incident.id.find(u.targetId);
    if (!inc) continue;
    const tt = Math.min(1, (now - Number(u.departAt)) / Number(u.etaAt - u.departAt));
    const x = u.fromX + (inc.x - u.fromX) * tt, y = u.fromY + (inc.y - u.fromY) * tt;
    if (tt >= 1) {
      ctx.db.unit.id.update({ ...u, x, y, status: "on_scene" });
      ctx.db.incident.id.update({ ...inc, status: "on_scene" });
      log(ctx, "SYSTEM", "arrive", `${u.callsign} on scene at #${inc.id}`);
    } else ctx.db.unit.id.update({ ...u, x, y });
  }
});

export default spacetimedb;
