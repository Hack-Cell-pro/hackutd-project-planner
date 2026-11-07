// Rule tests for the Emoji Charades Spacetime module, run in SpacetimeDB's own test runtime.
import { describe, expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as mod from "./src/index";
import schema from "./src/index";

const host = TestAuth.internal();
const guest = TestAuth.internal();

function makeHarness() {
  const h = createModuleTestHarness(schema, mod);
  h.withReducerTx(host, (ctx) => mod.init(ctx));
  return h;
}

function joinTwo(h: ReturnType<typeof makeHarness>) {
  h.withReducerTx(host, (ctx) => mod.join(ctx, { name: "Ada" }));
  h.withReducerTx(guest, (ctx) => mod.join(ctx, { name: "Bo" }));
}

describe("Emoji Charades module", () => {
  it("seeds the phrase deck and a lobby game row on init", () => {
    const h = makeHarness();
    h.withReducerTx(host, (ctx) => {
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
    joinTwo(h);
    h.withReducerTx(host, (ctx) => {
      const players = [...ctx.db.player.iter()];
      expect(players).toHaveLength(2);
      expect(players.filter((p) => p.isHost)).toHaveLength(1);
      expect(() => mod.join(ctx, { name: "   " })).toThrow(/Name required/);
    });
  });

  it("refuses to start with fewer than 2 players or as a non-host", () => {
    const h = makeHarness();
    h.withReducerTx(host, (ctx) => {
      mod.join(ctx, { name: "Ada" });
      expect(() => mod.startGame(ctx, {})).toThrow(/at least 2 players/);
    });
    h.withReducerTx(guest, (ctx) => mod.join(ctx, { name: "Bo" }));
    h.withReducerTx(guest, (ctx) => {
      expect(() => mod.startGame(ctx, {})).toThrow(/Only the host/);
    });
  });

  it("plays a full round: clue, wrong guess, correct guess, scoring", () => {
    const h = makeHarness();
    joinTwo(h);
    h.withReducerTx(host, (ctx) => mod.startGame(ctx, {}));

    // Find which auth is the cluer.
    const g0 = h.withReducerTx(host, (ctx) => ctx.db.game.id.find(1n)!);
    expect(g0.phase).toBe("clue");
    expect(g0.totalRounds).toBe(2);
    const cluerAuth = g0.cluer!.isEqual(host.identity) ? host : guest;
    const guesserAuth = g0.cluer!.isEqual(host.identity) ? guest : host;

    // Letters are rejected; emojis move the game to the guess phase.
    h.withReducerTx(cluerAuth, (ctx) => {
      expect(() => mod.submitClue(ctx, { clue: "pizza time" })).toThrow(/Emojis only/);
      mod.submitClue(ctx, { clue: "🍕🕒" });
      expect(ctx.db.game.id.find(1n)!.phase).toBe("guess");
    });

    // The cluer can't guess; a wrong guess scores nothing and keeps the round going.
    h.withReducerTx(cluerAuth, (ctx) => {
      expect(() => mod.submitGuess(ctx, { text: "anything" })).toThrow(/cluer can't guess/);
    });
    h.withReducerTx(guesserAuth, (ctx) => {
      mod.submitGuess(ctx, { text: "definitely wrong" });
      expect(ctx.db.game.id.find(1n)!.phase).toBe("guess");
    });

    // A correct guess (case/punctuation-insensitive) scores both players and reveals.
    h.withReducerTx(guesserAuth, (ctx) => {
      const phrase = ctx.db.game.id.find(1n)!.phrase;
      mod.submitGuess(ctx, { text: phrase.toUpperCase() + "!" });
      const g = ctx.db.game.id.find(1n)!;
      expect(g.phase).toBe("reveal");
      const guesser = ctx.db.player.identity.find(guesserAuth.identity)!;
      expect(guesser.score).toBeGreaterThanOrEqual(100);
      const cluer = ctx.db.player.identity.find(cluerAuth.identity)!;
      expect(cluer.score).toBe(50);
    });
  });

  it("ticks through deadlines: reveal after timeout, then the next round", () => {
    const h = makeHarness();
    joinTwo(h);
    h.withReducerTx(host, (ctx) => mod.startGame(ctx, {}));
    const g0 = h.withReducerTx(host, (ctx) => ctx.db.game.id.find(1n)!);
    const cluerAuth = g0.cluer!.isEqual(host.identity) ? host : guest;
    h.withReducerTx(cluerAuth, (ctx) => mod.submitClue(ctx, { clue: "🚀🌕" }));

    // Nobody guesses before the deadline -> reveal with no winner.
    h.clock.advance({ __time_duration_micros__: 61_000_000n } as never);
    h.withReducerTx(host, (ctx) => mod.tick(ctx, {} as never));
    h.withReducerTx(host, (ctx) => {
      const g = ctx.db.game.id.find(1n)!;
      expect(g.phase).toBe("reveal");
      expect(g.winnerName).toBe("");
    });

    // After the reveal window, round 2 starts.
    h.clock.advance({ __time_duration_micros__: 9_000_000n } as never);
    h.withReducerTx(host, (ctx) => mod.tick(ctx, {} as never));
    h.withReducerTx(host, (ctx) => {
      const g = ctx.db.game.id.find(1n)!;
      expect(g.phase).toBe("clue");
      expect(g.round).toBe(1);
    });
  });

  it("lets the host reset the room to the lobby", () => {
    const h = makeHarness();
    joinTwo(h);
    h.withReducerTx(host, (ctx) => {
      mod.startGame(ctx, {});
      mod.resetGame(ctx, {});
      const g = ctx.db.game.id.find(1n)!;
      expect(g.phase).toBe("lobby");
      expect([...ctx.db.guess.iter()]).toHaveLength(0);
      for (const p of ctx.db.player.iter()) expect(p.score).toBe(0);
    });
    h.withReducerTx(guest, (ctx) => {
      expect(() => mod.resetGame(ctx, {})).toThrow(/Only the host/);
    });
  });
});
