// Computer players. Stage 1 is the app's Basic strategy: pass the most dangerous cards,
// duck under the winning card when possible, dump the queen of spades when void.
// (Stage 2 brings over the app's full rule-based strategy.) Bots see only `view`.

import { SPADES, HEARTS, QUEEN_OF_SPADES, suitOf, rankOf } from './cards.js';
import { winningPlay, ledSuit } from './game.js';

function danger(c) {
  if (suitOf(c) === SPADES && rankOf(c) >= 12) return 100 + rankOf(c);
  if (suitOf(c) === HEARTS) return rankOf(c) + 2;
  return rankOf(c);
}

export const basicBot = {
  name: 'Basic',
  choosePass(view) {
    return view.hand.slice().sort((a, b) => danger(b) - danger(a)).slice(0, 3);
  },
  choosePlay(view) {
    const legal = view.legalPlays;
    const byRank = (a, b) => rankOf(a) - rankOf(b);
    const led = ledSuit(view.trick);
    if (led === null) return legal.slice().sort(byRank)[0];
    const winning = winningPlay(view.trick).card;
    if (legal.some((c) => suitOf(c) === led)) {
      // Duck with the highest card that still loses.
      const ducks = legal.filter((c) => rankOf(c) < rankOf(winning)).sort(byRank);
      if (ducks.length) return ducks[ducks.length - 1];
      // Forced to win: take it high, but never with the queen if there's a choice.
      const nonQueen = legal.filter((c) => c !== QUEEN_OF_SPADES);
      const pool = (nonQueen.length ? nonQueen : legal).sort(byRank);
      return pool[pool.length - 1];
    }
    // Void in the led suit: unload the worst card.
    if (legal.includes(QUEEN_OF_SPADES)) return QUEEN_OF_SPADES;
    return legal.slice().sort((a, b) => danger(b) - danger(a))[0];
  },
};
