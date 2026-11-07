// Smoke test: runs the real module code against SpacetimeDB's in-process test runtime.
// Run:  bun smoke.ts   (from spacetime/firstwave)
import 'spacetimedb/server/test-utils/wasm';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import spacetimedb, {
  init, join, report_incident, assign_unit, claim_unit, resolve_incident,
  cancel_incident, trigger_disaster, tick,
} from './src/index';

const test = createModuleTestHarness(spacetimedb, {
  init, join, report_incident, assign_unit, claim_unit, resolve_incident,
  cancel_incident, trigger_disaster, tick,
});
const auth = TestAuth.internal();
const tx = (fn: (ctx: any) => void) => test.withReducerTx(auth, fn);

tx((ctx) => { init(ctx); });
const seeded = [...ctx0()];
function ctx0() { return test.db.unit.iter(); }
console.log('seeded units:', seeded.length, seeded.map((u: any) => u.callsign).join(', '));
console.log('tick rows after init:', [...test.db.tickSchedule.iter()].length);

tx((ctx) => { join(ctx, { name: 'Sam', role: 'dispatcher' }); });
tx((ctx) => { join(ctx, { name: 'Riley', role: 'responder' }); });
console.log('players:', [...test.db.player.iter()].map((p: any) => `${p.name}/${p.role}`).join(', '));

tx((ctx) => { report_incident(ctx, { kind: 'fire', severity: 2, x: 30, y: 30, note: 'Apartment fire' }); });
const inc: any = [...test.db.incident.iter()][0];
console.log('incident #', inc.id, inc.kind, 'sev', inc.severity, inc.status, 'by', inc.reporter);

const unit: any = [...test.db.unit.iter()].find((u: any) => u.callsign === 'ENGINE 7');
tx((ctx) => { assign_unit(ctx, { incidentId: inc.id, unitId: unit.id }); });
const after: any = [...test.db.incident.iter()][0];
const uafter: any = [...test.db.unit.iter()].find((u: any) => u.id === unit.id);
console.log('after assign: incident', after.status, 'unit', uafter.status, 'eta in', Number(uafter.etaAt) - Number(uafter.departAt), 'ms');

// double-assign must throw
let threw = 'NO';
try { tx((ctx) => { assign_unit(ctx, { incidentId: inc.id, unitId: unit.id }); }); } catch { threw = 'YES'; }
console.log('double-assign rejected:', threw);

// advance the clock past the ETA and tick until the unit is on scene
test.clock.advance({ micros: 20_000_000n } as any);
for (let k = 0; k < 5; k++) tx((ctx) => { tick(ctx, { arg: { scheduledId: 0n, scheduledAt: null as any } }); });
const onscene: any = [...test.db.incident.iter()][0];
console.log('after travel: incident', onscene.status, '| tick rows requeued:', [...test.db.tickSchedule.iter()].length);

tx((ctx) => { resolve_incident(ctx, { incidentId: onscene.id }); });
const done: any = [...test.db.incident.iter()][0];
const scores = [...test.db.player.iter()].map((p: any) => `${p.name}=${p.score}`).join(' ');
console.log('after resolve: incident', done.status, '| scores', scores);

tx((ctx) => { trigger_disaster(ctx, { n: 3 }); });
console.log('incidents after disaster:', [...test.db.incident.iter()].length);

// escalation: report, wait 60s, tick
tx((ctx) => { report_incident(ctx, { kind: 'medical', severity: 1, x: 50, y: 50, note: 'CAD' }); });
const med: any = [...test.db.incident.iter()].filter((i: any) => i.status === 'open')[0];
test.clock.advance({ micros: 61_000_000n } as any);
tx((ctx) => { tick(ctx, { arg: { scheduledId: 0n, scheduledAt: null as any } }); });
const med2: any = [...test.db.incident.iter()].find((i: any) => i.id === med.id);
console.log('escalation: sev', med.severity, '->', med2.severity);
console.log('feed entries:', [...test.db.eventLog.iter()].length);
console.log('SMOKE OK');
