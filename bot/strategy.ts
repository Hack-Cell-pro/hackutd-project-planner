// ScrabbleBot strategy, meant to drop into the official bot-starter's strategy file.
// Wire it up like this (names follow the starter docs):
//   conn.db.auction.onInsert((_c, a) => { if (a.status.tag === "Open")
//     conn.reducers.submitBid({ auctionId: a.id, amount: BigInt(decideBid(ctx(a))) }); });
//   conn.db.myRack.onUpdate(() => { const w = pickWord(rackLetters());
//     if (w) conn.reducers.submitWord({ matchId, word: w }); });
// The starter's function names may differ: rename these two to match it.
//
// Words: put a word list (e.g. ENABLE, one word per line) at bot/words.txt and call loadWords().
import { readFileSync } from "node:fs";

export const LETTER_SCORE: Record<string, number> = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};

let WORDS: string[] = [];
// Letters sorted -> best word using exactly those letters.
const BY_KEY = new Map<string, string>();

export function loadWords(path = new URL("./words.txt", import.meta.url)) {
  WORDS = readFileSync(path, "utf8").split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{2,15}$/.test(w));
  for (const w of WORDS) {
    const k = [...w].sort().join("");
    const cur = BY_KEY.get(k);
    if (!cur || wordScore(w) > wordScore(cur)) BY_KEY.set(k, w);
  }
}

// Replace if the game uses a different scoring rule (check the rules page).
export function wordScore(w: string) {
  return [...w].reduce((s, c) => s + (LETTER_SCORE[c] ?? 0), 0) * (w.length >= 7 ? 2 : 1);
}

function counts(letters: string) {
  const m: Record<string, number> = {};
  for (const c of letters.toLowerCase()) m[c] = (m[c] ?? 0) + 1;
  return m;
}
function canMake(word: string, rack: Record<string, number>) {
  const need = counts(word);
  return Object.entries(need).every(([c, n]) => (rack[c] ?? 0) + (rack["?"] ?? 0) >= n);
}

/** Highest-scoring word buildable from the rack, or null. */
export function pickWord(rack: string): string | null {
  const r = counts(rack);
  let best: string | null = null, bestS = 0;
  for (const w of WORDS) {
    if (w.length > rack.length) continue;
    if (!canMake(w, r)) continue;
    const s = wordScore(w);
    if (s > bestS) { best = w; bestS = s; }
  }
  return best;
}

function bestScore(rack: string) { const w = pickWord(rack); return w ? wordScore(w) : 0; }

export interface BidContext {
  tile: string;          // letter being auctioned
  rack: string;          // my current letters
  budget: number;        // my remaining coins
  opponentBudgets: number[];
  auctionsLeft: number;  // estimate of auctions remaining in the match
}

/** How much the tile is worth to me: the gain in my best playable word, plus some option value. */
export function tileValue(ctx: BidContext): number {
  const before = bestScore(ctx.rack);
  const after = bestScore(ctx.rack + ctx.tile);
  const immediate = Math.max(0, after - before);
  const vowels = (ctx.rack.match(/[aeiou]/gi) ?? []).length;
  const isVowel = /[aeiou]/i.test(ctx.tile);
  // Balance the rack: vowels matter more when we have few, consonants when we have many vowels.
  const balance = isVowel ? (vowels < 2 ? 3 : 0) : (vowels > ctx.rack.length / 2 ? 2 : 0);
  const option = (LETTER_SCORE[ctx.tile.toLowerCase()] ?? 1) * 0.5;
  return immediate + balance + option;
}

/** Bid at most the tile's value, scaled to the budget, minus a margin. Never spend everything early. */
export function decideBid(ctx: BidContext, margin = 0.8): number {
  const v = tileValue(ctx);
  const perAuction = ctx.budget / Math.max(1, ctx.auctionsLeft);
  const cap = Math.min(ctx.budget, perAuction * 3); // allow overpaying 3x for great tiles only
  const richestOpp = Math.max(0, ...ctx.opponentBudgets);
  // If opponents are broke, bid 1 more than they could pay.
  if (richestOpp < v && richestOpp + 1 <= ctx.budget) return Math.max(0, Math.floor(richestOpp + 1));
  return Math.max(0, Math.floor(Math.min(cap, v * margin * (perAuction / 5 + 0.5))));
}
