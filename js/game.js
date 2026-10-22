// The complete rules of Hearts, ported from the iPhone app's HeartsGame. The game is a
// plain object (JSON-safe, so it can be stored in Firebase) changed by these functions.
// Seats run clockwise: 0 = South, 1 = West, 2 = North, 3 = East; play moves left.

import { FULL_DECK, TWO_OF_CLUBS, QUEEN_OF_SPADES, HEARTS, suitOf, rankOf, points, shuffled, sortHand } from './cards.js';

export const PLAYERS = 4, TRICKS = 13, TARGET = 100, MOON = 26;
export const PASS = ['left', 'right', 'across', 'none'];

export class HeartsError extends Error {}

export const passDirection = (game) => PASS[game.handNumber % 4];

/** Where `seat` passes to this hand (null: no pass). */
export function passTarget(game, seat) {
  switch (passDirection(game)) {
    case 'left': return (seat + 1) % 4;
    case 'right': return (seat + 3) % 4;
    case 'across': return (seat + 2) % 4;
    default: return null;
  }
}

export function newGame(deck = shuffled()) {
  const game = { phase: 'passing', handNumber: 0, scores: [0, 0, 0, 0], handHistory: [] };
  deal(game, deck);
  return game;
}

function deal(game, deck) {
  if (deck.length !== 52 || new Set(deck).size !== 52) throw new HeartsError('Deck must be all 52 cards');
  game.hands = [0, 1, 2, 3].map((s) => sortHand(deck.slice(s * TRICKS, s * TRICKS + TRICKS)));
  game.handPoints = [0, 0, 0, 0];
  game.completedTricks = [];
  game.heartsBroken = false;
  game.moonShooter = null;
  game.moonWentDown = false;
  game.passedCards = [[], [], [], []];
  game.receivedCards = [[], [], [], []];
  game.pendingPasses = [null, null, null, null];
  game.trick = { leader: 0, plays: [] };
  if (passDirection(game) === 'none') beginTrickPlay(game);
  else game.phase = 'passing';
}

export function startNextHand(game, deck = shuffled()) {
  if (game.phase !== 'handComplete') throw new HeartsError('wrong phase');
  game.handNumber += 1;
  deal(game, deck);
}

export function submitPass(game, seat, cards) {
  if (game.phase !== 'passing') throw new HeartsError('wrong phase');
  if (game.pendingPasses[seat] || cards.length !== 3 || new Set(cards).size !== 3
      || !cards.every((c) => game.hands[seat].includes(c))) throw new HeartsError('invalid pass');
  game.pendingPasses[seat] = cards.slice();
  if (game.pendingPasses.every(Boolean)) exchangePasses(game);
}

export const hasPassed = (game, seat) => Boolean(game.pendingPasses && game.pendingPasses[seat]);

function exchangePasses(game) {
  for (let s = 0; s < 4; s++) {
    const cards = game.pendingPasses[s];
    game.hands[s] = game.hands[s].filter((c) => !cards.includes(c));
    game.passedCards[s] = cards;
  }
  for (let s = 0; s < 4; s++) {
    const t = passTarget(game, s);
    game.hands[t] = sortHand(game.hands[t].concat(game.passedCards[s]));
    game.receivedCards[t] = sortHand(game.passedCards[s]);
  }
  game.pendingPasses = [null, null, null, null];
  beginTrickPlay(game);
}

function beginTrickPlay(game) {
  const leader = game.hands.findIndex((h) => h.includes(TWO_OF_CLUBS));
  game.trick = { leader, plays: [] };
  game.phase = 'playing';
}

// MARK: Tricks

export const ledSuit = (trick) => (trick.plays.length ? suitOf(trick.plays[0].card) : null);
export const nextSeat = (trick) => (trick.leader + trick.plays.length) % 4;
export const trickPoints = (trick) => trick.plays.reduce((n, p) => n + points(p.card), 0);

/** The play currently taking the trick: the highest card of the led suit. */
export function winningPlay(trick) {
  const led = ledSuit(trick);
  if (led === null) return null;
  return trick.plays.filter((p) => suitOf(p.card) === led).reduce((a, b) => (rankOf(b.card) > rankOf(a.card) ? b : a));
}

export const turn = (game) => (game.phase === 'playing' ? nextSeat(game.trick) : null);
export const isFirstTrick = (game) => game.completedTricks.length === 0;

export function legalPlays(game, seat) {
  if (game.phase !== 'playing' || seat !== nextSeat(game.trick)) return [];
  const hand = game.hands[seat];
  const led = ledSuit(game.trick);
  if (led !== null) {
    const following = hand.filter((c) => suitOf(c) === led);
    if (following.length) return following;
    // Void: anything goes, except no points on the first trick when avoidable.
    if (isFirstTrick(game)) {
      const safe = hand.filter((c) => points(c) === 0);
      if (safe.length) return safe;
    }
    return hand.slice();
  }
  // Leading.
  if (isFirstTrick(game) && hand.includes(TWO_OF_CLUBS)) return [TWO_OF_CLUBS];
  if (game.heartsBroken) return hand.slice();
  const nonHearts = hand.filter((c) => suitOf(c) !== HEARTS);
  return nonHearts.length ? nonHearts : hand.slice();
}

export function play(game, seat, c) {
  if (game.phase !== 'playing') throw new HeartsError('wrong phase');
  if (seat !== nextSeat(game.trick)) throw new HeartsError('not your turn');
  if (!legalPlays(game, seat).includes(c)) throw new HeartsError('illegal card');
  game.hands[seat] = game.hands[seat].filter((x) => x !== c);
  game.trick.plays.push({ seat, card: c });
  if (suitOf(c) === HEARTS) game.heartsBroken = true;
  if (game.trick.plays.length === 4) game.phase = 'trickComplete';
}

/** Awards the finished trick to its winner, who leads the next one. */
export function collectTrick(game) {
  if (game.phase !== 'trickComplete') throw new HeartsError('wrong phase');
  const winner = winningPlay(game.trick).seat;
  game.handPoints[winner] += trickPoints(game.trick);
  game.completedTricks.push({ ...game.trick, winner });
  if (game.completedTricks.length === TRICKS) finishHand(game);
  else { game.trick = { leader: winner, plays: [] }; game.phase = 'playing'; }
}

// MARK: Scoring

/** Hand points to score changes, applying shooting the moon (up: everyone else +26;
 *  down: the shooter -26). */
export function scoreHand(handPoints, down = false) {
  const shooter = handPoints.indexOf(MOON);
  if (shooter < 0) return { changes: handPoints.slice(), shooter: null };
  return { changes: handPoints.map((_, s) => (down ? (s === shooter ? -MOON : 0) : (s === shooter ? 0 : MOON))), shooter };
}

/** The computer's choice: go up, unless that ends the game with someone else lowest. */
export function shooterGoesDown(shooter, scores) {
  const up = scores.map((v, s) => v + (s === shooter ? 0 : MOON));
  if (!up.some((v) => v >= TARGET)) return false;
  return up.some((v, s) => s !== shooter && v < up[shooter]);
}

function finishHand(game) {
  const shooter = game.handPoints.indexOf(MOON);
  if (shooter < 0) return applyHand(game, scoreHand(game.handPoints).changes);
  game.moonShooter = shooter;
  if ((game.choosesMoon || []).includes(shooter)) game.phase = 'moonChoice';
  else applyMoon(game, shooterGoesDown(shooter, game.scores));
}

export function chooseMoon(game, down) {
  if (game.phase !== 'moonChoice') throw new HeartsError('wrong phase');
  applyMoon(game, down);
}

function applyMoon(game, down) {
  game.moonWentDown = down;
  applyHand(game, scoreHand(game.handPoints, down).changes);
}

function applyHand(game, changes) {
  game.handHistory.push(changes);
  for (let s = 0; s < 4; s++) game.scores[s] += changes[s];
  game.phase = game.scores.some((v) => v >= TARGET) ? 'gameOver' : 'handComplete';
}

/** Seats with the lowest score (more than one on a tie). */
export function leaders(game) {
  const best = Math.min(...game.scores);
  return [0, 1, 2, 3].filter((s) => game.scores[s] === best);
}

/** What `seat` may see — bots get only this, never the other hands. */
export function view(game, seat) {
  return {
    seat,
    hand: game.hands[seat].slice(),
    legalPlays: legalPlays(game, seat),
    trick: game.trick,
    completedTricks: game.completedTricks,
    heartsBroken: game.heartsBroken,
    passDirection: passDirection(game),
    passedCards: game.passedCards[seat],
    receivedCards: game.receivedCards[seat],
    scores: game.scores.slice(),
    handPoints: game.handPoints.slice(),
    handNumber: game.handNumber,
  };
}
