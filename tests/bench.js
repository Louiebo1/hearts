// Plays whole games between bots: one candidate against three opponents, rotating seats.
//   jsc tests/args.js -m tests/bench.js -- GAMES [CHUNK]     (25% wins is break-even)
// Run several at once with different CHUNK numbers to use more cores.
import * as G from '../js/game.js';
import { shuffled } from '../js/cards.js';
import { basicBot } from '../js/bots.js';
import { RuleBot } from '../js/rules.js';

const args = (typeof scriptArgs !== 'undefined' ? scriptArgs : []).filter((a) => a !== '--');
const games = Number(args[0] || 20), chunk = Number(args[1] || 0);
let seed = 1234567 + chunk * 7919;
const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };

const candidate = new RuleBot();
let wins = 0, points = 0, slowest = 0, thinking = 0, decisions = 0;
const t0 = Date.now();
for (let n = 0; n < games; n++) {
  const mine = (n + chunk) % 4;
  const bots = [0, 1, 2, 3].map((s) => (s === mine ? candidate : basicBot));
  const game = G.newGame(shuffled(undefined, random));
  while (game.phase !== 'gameOver') {
    const t = Date.now();
    switch (game.phase) {
      case 'passing': for (let s = 0; s < 4; s++) G.submitPass(game, s, bots[s].choosePass(G.view(game, s))); break;
      case 'playing': { const s = G.turn(game); G.play(game, s, bots[s].choosePlay(G.view(game, s))); break; }
      case 'trickComplete': G.collectTrick(game); break;
      case 'handComplete': G.startNextHand(game, shuffled(undefined, random)); break;
    }
    const dt = Date.now() - t;
    if (dt > 0 || game.phase !== 'trickComplete') { thinking += dt; decisions++; slowest = Math.max(slowest, dt); }
  }
  const leaders = G.leaders(game);
  if (leaders.includes(mine)) wins += 1 / leaders.length;
  points += game.scores[mine];
}
print(JSON.stringify({ games, wins, points, slowestMs: slowest, seconds: (Date.now() - t0) / 1000 }));
