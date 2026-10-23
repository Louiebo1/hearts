// Cards are small integers: suit * 100 + rank (rank 2–14, ace high). Suits in display
// order alternate black/red: clubs, diamonds, spades, hearts — the same as the app.

export const CLUBS = 0, DIAMONDS = 1, SPADES = 2, HEARTS = 3;
export const SUITS = [CLUBS, DIAMONDS, SPADES, HEARTS];
export const SYMBOL = ['♣', '♦', '♠', '♥'];

export const card = (suit, rank) => suit * 100 + rank;
export const suitOf = (c) => Math.floor(c / 100);
export const rankOf = (c) => c % 100;
export const isRed = (c) => suitOf(c) === DIAMONDS || suitOf(c) === HEARTS;

export const TWO_OF_CLUBS = card(CLUBS, 2);
export const QUEEN_OF_SPADES = card(SPADES, 12);

export function points(c) {
  if (suitOf(c) === HEARTS) return 1;
  if (c === QUEEN_OF_SPADES) return 13;
  return 0;
}

export function rankLabel(c) {
  const r = rankOf(c);
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r);
}

export const label = (c) => rankLabel(c) + SYMBOL[suitOf(c)];

export const FULL_DECK = SUITS.flatMap((s) => Array.from({ length: 13 }, (_, i) => card(s, i + 2)));

/** A shuffled copy of the deck (Fisher–Yates). */
export function shuffled(deck = FULL_DECK, random = Math.random) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Display order: by suit; within a suit, highest first (or lowest first). */
export function sortHand(hand, highFirst = true) {
  return hand.slice().sort((a, b) =>
    suitOf(a) !== suitOf(b) ? suitOf(a) - suitOf(b) : highFirst ? rankOf(b) - rankOf(a) : rankOf(a) - rankOf(b));
}
