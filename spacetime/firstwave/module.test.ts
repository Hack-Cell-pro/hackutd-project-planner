// Runs the real module code against SpacetimeDB's in-process test runtime.
// From spacetime/firstwave:  bunx vitest run --config vitest.config.ts
import { describe, expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import spacetimedb, {
  init, join, report_incident, assign_unit, claim_unit, resolve_incident,
  cancel_incident, trigger_disaster, tick,
} from "./src/index";

const auth = TestAuth.internal();
const micros = (n: bigint) => ({ micros: n }) as any;

function harness() {
  const test = createModuleTestHarness(spacetimedb, {
    init, join, report_incident, assign_unit, claim_unit, resolve_incident,
    cancel_incident, trigger_disaster, tick,
  });
  const tx = (fn: (ctx: any) => void) => test.withReducerTx(auth, fn);
  const units = () => [...test.db.unit.iter()] as any[];
  const incidents = () => [...test.db.incident.iter()] as any[];
  const players = () => [...test.db.player.iter()] as any[];
  const ticks = () => [...test.db.tickSchedule.iter()] as any[];
  const runTick = () => {
    const arg = ticks()[0];
    if (arg) tx((ctx) => { tick(ctx, { arg }); });
  };
  return { test, tx, units, incidents, players, ticks, runTick };
}

describe("firstwave module", () => {
  it("seeds units and a running clock on init", () => {
    const { tx, units, ticks } = harness();
    tx((ctx) => { init(ctx); });
    expect(units().length).toBe(6);
    expect(ticks().length).toBe(1);
  });

  it("runs a call from report to resolve, scoring both roles", () => {
    const { test, tx, units, incidents, players, runTick } = harness();
    tx((ctx) => { init(ctx); });
    tx((ctx) => { join(ctx, { name: "Sam", role: "dispatcher" }); });
    tx((ctx) => { join(ctx, { name: "Riley", role: "responder" }); });
    expect(players().length).toBe(2);

    tx((ctx) => { report_incident(ctx, { kind: "fire", severity: 2, x: 30, y: 30, note: "Apartment fire" }); });
    const inc = incidents()[0];
    expect(inc.status).toBe("open");
    expect(inc.severity).toBe(2);

    const unit = units().find((u) => u.callsign === "ENGINE 7");
    tx((ctx) => { assign_unit(ctx, { incidentId: inc.id, unitId: unit.id }); });
    expect(incidents()[0].status).toBe("en_route");
    expect(units().find((u) => u.id === unit.id).status).toBe("en_route");

    // the same unit can't be sent twice
    expect(() => tx((ctx) => { assign_unit(ctx, { incidentId: inc.id, unitId: unit.id }); })).toThrow();

    // travel: advance past the ETA, then tick until the unit arrives
    test.clock.advance(micros(30_000_000n));
    for (let k = 0; k < 6; k++) runTick();
    expect(incidents()[0].status).toBe("on_scene");

    tx((ctx) => { claim_unit(ctx, { unitId: unit.id }); });
    tx((ctx) => { resolve_incident(ctx, { incidentId: inc.id }); });
    expect(incidents()[0].status).toBe("resolved");
    const sam = players().find((p) => p.name === "Sam");
    const riley = players().find((p) => p.name === "Riley");
    expect(sam.score).toBeGreaterThan(0);
    expect(riley.score).toBeGreaterThan(0);
    expect(units().find((u) => u.id === unit.id).status).toBe("available");
  });

  it("escalates an unattended incident after 60s", () => {
    const { test, tx, incidents, runTick } = harness();
    tx((ctx) => { init(ctx); });
    tx((ctx) => { join(ctx, { name: "Sam", role: "dispatcher" }); });
    tx((ctx) => { report_incident(ctx, { kind: "medical", severity: 1, x: 50, y: 50, note: "CAD" }); });
    const before = incidents()[0].severity;
    test.clock.advance(micros(61_000_000n));
    runTick();
    expect(incidents()[0].severity).toBe(before + 1);
  });

  it("rejects bad reports and non-dispatcher sends; cancelling frees the unit", () => {
    const { tx, units, incidents } = harness();
    tx((ctx) => { init(ctx); });
    tx((ctx) => { join(ctx, { name: "Sam", role: "dispatcher" }); });
    expect(() => tx((ctx) => { report_incident(ctx, { kind: "fire", severity: 9, x: 10, y: 10, note: "" }); })).toThrow();
    expect(() => tx((ctx) => { report_incident(ctx, { kind: "fire", severity: 2, x: 999, y: 10, note: "" }); })).toThrow();
    tx((ctx) => { report_incident(ctx, { kind: "fire", severity: 2, x: 10, y: 10, note: "smoke" }); });
    const inc = incidents().find((i) => i.status === "open");
    const unit = units().find((u) => u.status === "available");
    expect(() => tx((ctx) => { assign_unit(ctx, { incidentId: inc.id, unitId: 999n }); })).toThrow();
    tx((ctx) => { assign_unit(ctx, { incidentId: inc.id, unitId: unit.id }); });
    tx((ctx) => { cancel_incident(ctx, { incidentId: inc.id }); });
    expect(incidents().find((i) => i.id === inc.id).status).toBe("resolved");
    expect(units().find((u) => u.id === unit.id).status).toBe("available");
  });

  it("storm cells add incidents", () => {
    const { tx, incidents } = harness();
    tx((ctx) => { init(ctx); });
    tx((ctx) => { join(ctx, { name: "Sam", role: "dispatcher" }); });
    tx((ctx) => { trigger_disaster(ctx, { n: 4 }); });
    expect(incidents().length).toBe(4);
  });
});
