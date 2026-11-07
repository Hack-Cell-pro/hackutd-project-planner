// Rule tests for the Emoji Charades Spacetime module, run in SpacetimeDB's own test runtime.
import { describe, expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/test-utils";

const harness = createModuleTestHarness({ modulePath: import.meta.url });

describe("Emoji Charades module", () => {
  it("seeds the phrase deck and a lobby game row on init", async () => {
    await harness.run(async (ctx) => {
      let phrases = 0;
      for (const _ of ctx.db.phrase.iter()) phrases++;
      expect(phrases).toBe(32);
      const g = ctx.db.game.id.find(1n);
      expect(g).toBeDefined();
      expect(g!.phase).toBe("lobby");
    });
  });

  it("makes the first player the host", async () => {
    const auth = TestAuth.internal();
    await harness.run(async (ctx) => {
      ctx.withSender(auth, () => ctx.reducers.join({ name: "Ada" }));
      const p = ctx.db.player.identity.find(auth.identity);
      expect(p).toBeDefined();
      expect(p!.isHost).toBe(true);
      expect(p!.score).toBe(0);
    });
  });

  it("refuses to start with fewer than 2 players", async () => {
    const auth = TestAuth.internal();
    await harness.run(async (ctx) => {
      ctx.withSender(auth, () => ctx.reducers.join({ name: "Ada" }));
      expect(() => ctx.withSender(auth, () => ctx.reducers.startGame({}))).toThrow(/at least 2 players/);
    });
  });

  it("rejects clues and guesses in the lobby", async () => {
    const auth = TestAuth.internal();
    await harness.run(async (ctx) => {
      ctx.withSender(auth, () => ctx.reducers.join({ name: "Ada" }));
      expect(() => ctx.withSender(auth, () => ctx.reducers.submitClue({ clue: "🍕" }))).toThrow(/Not the clue phase/);
      expect(() => ctx.withSender(auth, () => ctx.reducers.submitGuess({ text: "pizza" }))).toThrow(/No clue to guess/);
    });
  });

  it("lets the host reset the room to the lobby", async () => {
    const auth = TestAuth.internal();
    await harness.run(async (ctx) => {
      ctx.withSender(auth, () => ctx.reducers.join({ name: "Ada" }));
      ctx.withSender(auth, () => ctx.reducers.resetGame({}));
      expect(ctx.db.game.id.find(1n)!.phase).toBe("lobby");
    });
  });
});
