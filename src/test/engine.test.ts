import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignUnit, cancelIncident, claimUnit, ESCALATE_AFTER_MS, join, reportIncident,
  resolveIncident, resetRoom, tick, travelMs, useRoom,
} from "@/lib/engine";
import { renderHook } from "@testing-library/react";

function state() {
  const { result } = renderHook(() => useRoom());
  return result.current!;
}

beforeEach(() => {
  localStorage.clear();
  resetRoom();
  join("Riley", "dispatcher");
});

describe("dispatch rules", () => {
  it("rejects reports with severity outside 1-5", () => {
    expect(() => reportIncident("fire", 6, 50, 50, "")).toThrow("Severity must be 1–5");
    expect(() => reportIncident("fire", 0, 50, 50, "")).toThrow("Severity must be 1–5");
  });

  it("rejects reports off the map", () => {
    expect(() => reportIncident("fire", 3, 120, 50, "")).toThrow("off the map");
  });

  it("lets only dispatchers assign units", () => {
    reportIncident("fire", 3, 50, 50, "kitchen fire");
    join("Sam", "responder");
    expect(() => assignUnit(state().incidents[0]!.id, 1)).toThrow("Only dispatchers");
  });

  it("blocks double-assigning a busy unit", () => {
    reportIncident("fire", 3, 50, 50, "");
    reportIncident("medical", 2, 60, 60, "");
    const [a, b] = state().incidents;
    assignUnit(a!.id, 1);
    expect(() => assignUnit(b!.id, 1)).toThrow("Unit is busy");
    expect(() => assignUnit(a!.id, 2)).toThrow("already handled");
  });

  it("moves a unit en route and arrives on scene at the ETA", () => {
    vi.useFakeTimers();
    try {
      reportIncident("fire", 3, 50, 50, "");
      const inc = state().incidents[0]!;
      assignUnit(inc.id, 1);
      const unit = state().units.find((u) => u.id === 1)!;
      expect(unit.status).toBe("en_route");
      const eta = unit.etaAt! - unit.departAt!;
      expect(eta).toBe(travelMs(Math.hypot(unit.fromX! - inc.x, unit.fromY! - inc.y)));
      vi.advanceTimersByTime(eta + 600);
      tick();
      expect(state().units.find((u) => u.id === 1)!.status).toBe("on_scene");
      expect(state().incidents[0]!.status).toBe("on_scene");
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates an open incident after 60s without response", () => {
    vi.useFakeTimers();
    try {
      reportIncident("fire", 2, 50, 50, "");
      vi.advanceTimersByTime(ESCALATE_AFTER_MS + 600);
      tick();
      expect(state().incidents[0]!.severity).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never escalates past severity 5", () => {
    vi.useFakeTimers();
    try {
      reportIncident("fire", 5, 50, 50, "");
      vi.advanceTimersByTime(ESCALATE_AFTER_MS * 2);
      tick();
      expect(state().incidents[0]!.severity).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the assigning dispatcher half credit on resolve", () => {
    vi.useFakeTimers();
    try {
      reportIncident("fire", 4, 50, 50, "");
      const inc = state().incidents[0]!;
      assignUnit(inc.id, 1);
      const unit = state().units.find((u) => u.id === 1)!;
      vi.advanceTimersByTime(unit.etaAt! - unit.departAt! + 600);
      tick();
      localStorage.removeItem("firstwave-me"); // second browser = second identity
      join("Sam", "responder");
      claimUnit(1);
      resolveIncident(inc.id);
      const s = state();
      const dispatcher = s.players.find((p) => p.name === "Riley")!;
      const responder = s.players.find((p) => p.name === "Sam")!;
      // Severity 4, ~10s to resolve: 79 pts to the responder, 40 half-credit + 5 assign bonus to the dispatcher.
      expect(responder.score).toBe(79);
      expect(dispatcher.score).toBe(45);
      expect(s.units.find((u) => u.id === 1)!.status).toBe("available");
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees the unit and scores nothing when a dispatcher cancels", () => {
    reportIncident("fire", 3, 50, 50, "");
    const inc = state().incidents[0]!;
    assignUnit(inc.id, 1);
    cancelIncident(inc.id);
    const s = state();
    expect(s.incidents[0]!.status).toBe("resolved");
    expect(s.units.find((u) => u.id === 1)!.status).toBe("available");
    expect(s.players.find((p) => p.name === "Riley")!.score).toBe(5); // only the +5 assign bonus
  });

  it("stops responders from cancelling", () => {
    reportIncident("fire", 3, 50, 50, "");
    join("Sam", "responder");
    expect(() => cancelIncident(state().incidents[0]!.id)).toThrow("Only dispatchers");
  });
});
