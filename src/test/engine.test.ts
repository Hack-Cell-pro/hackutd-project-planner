// Rule tests for the Emoji Charades engine stand-in (mirrors the Spacetime module).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLUE_MS, GUESS_MS, ReducerError, getMyId, isEmojiOnly, join, matches, resetGame, resetRoom,
  startGame, submitClue, submitGuess, tick, useRoom as _unused, type State,
} from "@/lib/engine";

void _unused;

function read(): State {
  return JSON.parse(localStorage.getItem("emoji-charades-v1")!) as State;
}

// Simulate a second browser: a fresh identity joins under a new name.
function joinAs(name: string) {
  localStorage.removeItem("emoji-me");
  join(name);
  return getMyId();
}

beforeEach(() => {
  localStorage.clear();
  resetRoom();
});

describe("join", () => {
  it("makes the first player the host and later players not", () => {
    join("Ada");
    joinAs("Bo");
    const s = read();
    expect(s.players).toHaveLength(2);
    expect(s.players.find((p) => p.name === "Ada")!.isHost).toBe(true);
    expect(s.players.find((p) => p.name === "Bo")!.isHost).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(() => join("   ")).toThrow(ReducerError);
  });
});

describe("startGame", () => {
  it("rejects non-hosts and games with fewer than 2 players", () => {
    join("Ada");
    expect(() => startGame()).toThrow(/at least 2 players/);
    joinAs("Bo");
    expect(() => startGame()).toThrow(/Only the host/);
  });

  it("starts round 1 in the clue phase with one round per player", () => {
    join("Ada");
    joinAs("Bo");
    joinAs("Cy");
    // Back to the host's identity.
    localStorage.removeItem("emoji-me");
    join("Ada2"); // third distinct identity; host is still Ada
    const s0 = read();
    const host = s0.players.find((p) => p.isHost)!;
    localStorage.setItem("emoji-me", host.id);
    startGame();
    const s = read();
    expect(s.game.phase).toBe("clue");
    expect(s.game.round).toBe(0);
    expect(s.game.totalRounds).toBe(3);
    expect(s.game.phrase.length).toBeGreaterThan(0);
  });
});

describe("submitClue", () => {
  function setup() {
    join("Ada");
    joinAs("Bo");
    const host = read().players.find((p) => p.isHost)!;
    localStorage.setItem("emoji-me", host.id);
    startGame();
    return read();
  }

  it("rejects clues with letters or numbers", () => {
    const s = setup();
    localStorage.setItem("emoji-me", s.game.cluerId!);
    expect(() => submitClue("pizza time")).toThrow(/Emojis only/);
    expect(() => submitClue("🍕2")).toThrow(/Emojis only/);
    expect(isEmojiOnly("🍕🕒😴")).toBe(true);
  });

  it("rejects clues from anyone but the cluer", () => {
    const s = setup();
    const other = s.players.find((p) => p.id !== s.game.cluerId)!;
    localStorage.setItem("emoji-me", other.id);
    expect(() => submitClue("🍕")).toThrow(/not the cluer/);
  });

  it("moves to the guess phase when the cluer sends emojis", () => {
    const s = setup();
    localStorage.setItem("emoji-me", s.game.cluerId!);
    submitClue("🍕🕒");
    const after = read();
    expect(after.game.phase).toBe("guess");
    expect(after.game.clue).toBe("🍕🕒");
  });
});

describe("submitGuess", () => {
  function setupGuessPhase() {
    join("Ada");
    joinAs("Bo");
    const host = read().players.find((p) => p.isHost)!;
    localStorage.setItem("emoji-me", host.id);
    startGame();
    const s = read();
    localStorage.setItem("emoji-me", s.game.cluerId!);
    submitClue("🍕🕒");
    return read();
  }

  it("scores the correct guesser with a speed bonus and pays the cluer 50", () => {
    const s = setupGuessPhase();
    const guesser = s.players.find((p) => p.id !== s.game.cluerId)!;
    localStorage.setItem("emoji-me", guesser.id);
    submitGuess(s.game.phrase);
    const after = read();
    expect(after.game.phase).toBe("reveal");
    expect(after.game.winnerName).toBe(guesser.name);
    const g = after.players.find((p) => p.id === guesser.id)!;
    expect(g.score).toBeGreaterThanOrEqual(100);
    expect(g.score).toBeLessThanOrEqual(220);
    const cluer = after.players.find((p) => p.id === s.game.cluerId)!;
    expect(cluer.score).toBe(50);
  });

  it("keeps the round going after a wrong guess and scores nothing", () => {
    const s = setupGuessPhase();
    const guesser = s.players.find((p) => p.id !== s.game.cluerId)!;
    localStorage.setItem("emoji-me", guesser.id);
    submitGuess("definitely wrong");
    const after = read();
    expect(after.game.phase).toBe("guess");
    expect(after.players.find((p) => p.id === guesser.id)!.score).toBe(0);
  });

  it("stops the cluer from guessing", () => {
    const s = setupGuessPhase();
    localStorage.setItem("emoji-me", s.game.cluerId!);
    expect(() => submitGuess("anything")).toThrow(/cluer can't guess/);
  });
});

describe("matches", () => {
  it("ignores case, punctuation and trailing plurals", () => {
    expect(matches("harry potter!", "Harry Potter")).toBe(true);
    expect(matches("Zombie Apocalypse", "zombie apocalypse")).toBe(true);
    expect(matches("cats", "cat")).toBe(true); // trailing plurals forgiven
    expect(matches("headphones", "untangling headphones")).toBe(false);
    expect(matches("pizza", "pizza delivery")).toBe(false);
  });
});

describe("tick deadlines", () => {
  it("reveals with no winner when the guess timer runs out, then advances", () => {
    vi.useFakeTimers();
    try {
      join("Ada");
      joinAs("Bo");
      const host = read().players.find((p) => p.isHost)!;
      localStorage.setItem("emoji-me", host.id);
      startGame();
      const s = read();
      localStorage.setItem("emoji-me", s.game.cluerId!);
      submitClue("🚀🌕");

      vi.setSystemTime(Date.now() + GUESS_MS + 1000);
      tick();
      let cur = read();
      expect(cur.game.phase).toBe("reveal");
      expect(cur.game.winnerName).toBe("");

      vi.setSystemTime(Date.now() + 10_000);
      tick();
      cur = read();
      expect(cur.game.phase).toBe("clue"); // round 2
      expect(cur.game.round).toBe(1);

      // Skip round 2's clue timer -> game over (2 players = 2 rounds).
      vi.setSystemTime(Date.now() + CLUE_MS + 1000);
      tick();
      cur = read();
      expect(cur.game.phase).toBe("final");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resetGame", () => {
  it("is host-only and clears scores back to the lobby", () => {
    join("Ada");
    joinAs("Bo");
    const s = read();
    const host = s.players.find((p) => p.isHost)!;
    const other = s.players.find((p) => !p.isHost)!;
    localStorage.setItem("emoji-me", other.id);
    expect(() => resetGame()).toThrow(/Only the host/);
    localStorage.setItem("emoji-me", host.id);
    startGame();
    resetGame();
    const after = read();
    expect(after.game.phase).toBe("lobby");
    expect(after.players.every((p) => p.score === 0)).toBe(true);
  });
});
