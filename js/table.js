// A Hearts table: the game, who sits where (a person or a bot), and the pacing. The
// table's host runs the game: it applies everyone's moves, plays the bots, and (online)
// publishes the state. Other players only send moves. Everything here is plain data so
// the same table can run locally or through Firebase.

import * as G from './game.js';
import { RuleBot } from './rules.js';
import { shuffled } from './cards.js';

export const BOT_NAMES = ['Ruth', 'Walt', 'Fay', 'Mac', 'June', 'Gus', 'Dot', 'Hank', 'Pearl', 'Lou'];

export const PACE = { play: 650, trickLinger: 1300, pass: 500 };

/** A fresh table state: the game plus the seats. */
export function newTableState(seats) {
  const game = G.newGame(shuffled());
  game.choosesMoon = seats.map((s, i) => (s.kind === 'person' ? i : -1)).filter((i) => i >= 0);
  return {
    game,
    seats,                        // [{ kind: 'person' | 'bot', name, id? }]
    // Louie: each computer player passes a heart in 60–90% of hands, drawn per game.
    heartPassRates: [0, 1, 2, 3].map(() => 0.6 + Math.random() * 0.3),
    continued: [],                // People who tapped Continue after a hand.
    paused: null,                 // { seat, name } while waiting for a dropped player.
    version: 0,
  };
}

/** Apply one move (from anyone) to the table state. Returns true if it changed. */
export function applyMove(state, move) {
  const g = state.game;
  try {
    switch (move.type) {
      case 'pass': G.submitPass(g, move.seat, move.cards); break;
      case 'play': G.play(g, move.seat, move.card); break;
      case 'collect': G.collectTrick(g); break;
      case 'moon': if (g.moonShooter !== move.seat) return false; G.chooseMoon(g, move.down); break;
      case 'continue':
        if (g.phase !== 'handComplete') return false;
        if (!state.continued.includes(move.seat)) state.continued.push(move.seat);
        if (peopleSeats(state).every((s) => state.continued.includes(s))) {
          G.startNextHand(g, shuffled());
          state.continued = [];
        }
        break;
      case 'newGame': {
        const fresh = newTableState(state.seats);
        Object.assign(state, fresh, { version: state.version });
        break;
      }
      default: return false;
    }
  } catch (e) {
    return false;
  }
  state.version += 1;
  return true;
}

export const peopleSeats = (state) => state.seats.map((s, i) => (s.kind === 'person' ? i : -1)).filter((i) => i >= 0);

/** The next thing the host should do on its own (a bot's move, or collecting a finished
 *  trick), with how long to wait first — or null when it's waiting on a person. */
export function nextHostStep(state) {
  const g = state.game;
  if (state.paused) return null;
  const started = Date.now();
  const step = hostStep(state);
  // The bots' thinking counts toward the pause before their move.
  if (step) step.delay = Math.max(50, step.delay - (Date.now() - started));
  return step;
}

/** The bot playing `seat` (the app's rules, with this game's heart-pass rate). */
const botFor = (state, seat) => new RuleBot({ heartPassRate: state.heartPassRates?.[seat] ?? 0.75 });

function hostStep(state) {
  const g = state.game;
  const isBot = (s) => state.seats[s].kind === 'bot';
  switch (g.phase) {
    case 'passing':
      for (let s = 0; s < 4; s++) {
        if (isBot(s) && !G.hasPassed(g, s)) {
          return { delay: PACE.pass, move: { type: 'pass', seat: s, cards: botFor(state, s).choosePass(G.view(g, s)) } };
        }
      }
      return null;
    case 'playing': {
      const s = G.turn(g);
      if (!isBot(s)) return null;
      return { delay: PACE.play, move: { type: 'play', seat: s, card: botFor(state, s).choosePlay(G.view(g, s)) } };
    }
    case 'trickComplete':
      return { delay: PACE.trickLinger, move: { type: 'collect' } };
    case 'handComplete':
      // A table of only bots (for testing) moves straight on.
      return peopleSeats(state).length ? null : { delay: PACE.trickLinger, move: { type: 'continue', seat: -1 } };
    default:
      return null;
  }
}

/** Runs a table on this device (the host). `onState` gets every new state. */
export class LocalHost {
  constructor(state, onState) {
    this.state = state;
    this.onState = onState;
    this.timer = null;
    this.publish();
  }

  /** A move from a person at this table. */
  send(move) {
    if (applyMove(this.state, move)) this.publish();
  }

  publish() {
    this.onState(this.state);
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const step = nextHostStep(this.state);
    if (!step) return;
    this.timer = setTimeout(() => {
      if (applyMove(this.state, step.move)) this.publish();
    }, step.delay);
  }

  stop() { clearTimeout(this.timer); }
}
