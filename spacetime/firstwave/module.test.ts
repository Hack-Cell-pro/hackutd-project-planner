// Rule tests for the Emoji Charades Spacetime module, run in SpacetimeDB's own test runtime.
// The runtime simulates a single player identity, so multi-player round flow is covered
// by src/test/engine.test.ts (the stand-in mirrors these reducers rule-for-rule).
import { describe, expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as mod from "./src/index";
import schema from "./src/index";

const auth = TestAuth.internal();

function makeHarness() {
  const h = createModuleTestHarness(schema, mod);
  h.withReducerTx(auth, (ctx) => mod.init(ctx));
  return h;
}

describe("Emoji Charades module", () => {
  it("seeds the phrase deck and a lobby game row on init", () => {
    const h = makeHarness();
    h.withReducerTx(auth, (ctx) => {
      let phrases = 0;
      for (const _ of ctx.db.phrase.iter()) phrases++;
      expect(phrases).toBe(32);
      const g = ctx.db.game.id.find(1n);
      expect(g).toBeDefined();
      expect(g!.phase).toBe("lobby");
    });
  });

  it("makes the first player the host and rejects empty names", () => {
    const h = makeHarness();
    h.withReducerTx(auth, (ctx) => {
      mod.join(ctx, { name: "Ada" });
      const p = ctx.db.player.identity.find(ctx.sender);
      expect(p).toBeDefined();
      expect(p!.isHost).toBe(true);
      expect(p!.score).toBe(0);
      expect(() => mod.join(ctx, { name: "   " })).toThrow(/Name required/);
    });
  });

  it("refuses to start with fewer than 2 players", () => {
    const h = makeHarness();
    h.withReducerTx(auth, (ctx) => {
      mod.join(ctx, { name: "Ada" });
      expect(() => mod.start_game(ctx, {})).toThrow(/at least 2 players/);
    });
  });

  it("rejects clues and guesses while in the lobby", () => {
    const h = makeHarness();
    h.withReducerTx(auth, (ctx) => {
      mod.join(ctx, { name: "Ada" });
      expect(() => mod.submit_clue(ctx, { clue: "🍕" })).toThrow(/Not the clue phase/);
      expect(() => mod.submit_guess(ctx, { text: "pizza" })).toThrow(/No clue to guess/);
    });
  });

  it("lets the host reset the room to the lobby", () => {
    const h = makeHarness();
    h.withReducerTx(auth, (ctx) => {
      mod.join(ctx, { name: "Ada" });
      mod.reset_game(ctx, {});
      expect(ctx.db.game.id.find(1n)!.phase).toBe("lobby");
      expect([...ctx.db.guess.iter()]).toHaveLength(0);
    });
  });
});
