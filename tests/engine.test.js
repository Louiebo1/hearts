// Run with: jsc -m tests/engine.test.js   (from the project folder)
import * as G from '../js/game.js';
import { FULL_DECK, TWO_OF_CLUBS, QUEEN_OF_SPADES, card, HEARTS, CLUBS, SPADES, points } from '../js/cards.js';
import { basicBot } from '../js/bots.js';

let failures = 0, checks = 0;
function expect(ok, what) { checks++; if (!ok) { failures++; print('FAIL: ' + what); } }

// Whole games between four bots: every rule holds, scores add up, the game ends.
for (let n = 0; n < 200; n++) {
  const game = G.newGame();
  let steps = 0;
  while (game.phase !== 'gameOver') {
    if (++steps > 5000) { expect(false, 'game stuck'); break; }
    if (game.phase === 'passing') {
      for (let s = 0; s < 4; s++) if (!G.hasPassed(game, s)) G.submitPass(game, s, basicBot.choosePass(G.view(game, s)));
      expect(game.hands.every((h) => h.length === 13), 'thirteen cards after passing');
      continue;
    }
    if (game.phase === 'playing') {
      const s = G.turn(game);
      const v = G.view(game, s);
      if (game.completedTricks.length === 0 && game.trick.plays.length === 0) expect(v.legalPlays.length === 1 && v.legalPlays[0] === TWO_OF_CLUBS, '2♣ leads');
      const c = basicBot.choosePlay(v);
      expect(v.legalPlays.includes(c), 'bot plays a legal card');
      G.play(game, s, c);
      continue;
    }
    if (game.phase === 'trickComplete') { G.collectTrick(game); continue; }
    if (game.phase === 'handComplete') {
      const last = game.handHistory[game.handHistory.length - 1];
      const total = last.reduce((a, b) => a + b, 0);
      expect(total === 26 || total === 78 || total === -26, 'a hand scores 26 (or a moon)');
      G.startNextHand(game);
      continue;
    }
  }
  expect(game.scores.some((v) => v >= 100), 'someone reached 100');
}

// Specific rules.
{
  const game = G.newGame(FULL_DECK.slice());     // Unshuffled: seat 0 has all the clubs.
  expect(G.passDirection(game) === 'left', 'first hand passes left');
  expect(G.passTarget(game, 0) === 1 && G.passTarget(game, 3) === 0, 'left is clockwise');
}
{
  const r = G.scoreHand([26, 0, 0, 0]);
  expect(r.shooter === 0 && r.changes.join() === '0,26,26,26', 'shooting the moon up');
  expect(G.scoreHand([26, 0, 0, 0], true).changes.join() === '-26,0,0,0', 'shooting the moon down');
  expect(G.shooterGoesDown(0, [50, 80, 20, 40]) === true, 'a bot goes down when up would lose');
  expect(G.shooterGoesDown(0, [90, 80, 80, 80]) === false, 'a bot stays up when up still wins');
  expect(G.shooterGoesDown(0, [10, 20, 20, 20]) === false, 'a bot goes up early on');
}
{
  // No points on the first trick when avoidable; hearts can't lead until broken.
  const game = G.newGame();
  game.phase = 'playing';
  game.hands = [[card(CLUBS, 3), card(HEARTS, 5), QUEEN_OF_SPADES], [card(CLUBS, 4)], [], []];
  game.trick = { leader: 1, plays: [{ seat: 1, card: card(CLUBS, 2) }] };
  game.trick.leader = 3; game.trick.plays = [{ seat: 3, card: card(CLUBS, 2) }];
  game.hands[0] = [card(HEARTS, 5), QUEEN_OF_SPADES, card(SPADES, 3)];
  const legal = G.legalPlays(game, 0);
  expect(legal.length === 1 && legal[0] === card(SPADES, 3), 'no points on the first trick');
}
print(`${checks} checks, ${failures} failures`);
