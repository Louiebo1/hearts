// The computer players from the iPhone app: Louie's rules (RuleStrategy.swift, with the
// rules from docs/STRATEGY.md), the endgame look-ahead (rule 21, EndgameSolver.swift) and
// the pass look-ahead (rule 23, PassSolver.swift). Rule numbers match the app. This is
// the app's shipped set of rules (`Extras.shipped`); rules the app ships switched off
// (15, 16, 18, 19, 22) aren't ported. Bots see only `view` (game.js), never other hands.

import { CLUBS, DIAMONDS, SPADES, HEARTS, QUEEN_OF_SPADES, FULL_DECK, card, suitOf, rankOf, points } from './cards.js';
import * as G from './game.js';

const ACE_OF_HEARTS = card(HEARTS, 14), ACE_OF_SPADES = card(SPADES, 14), KING_OF_SPADES = card(SPADES, 13);
const TARGET = G.TARGET;

// Swift's max(by:)/min(by:): the first of equals wins.
function maxBy(list, less) {
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (less(best, list[i])) best = list[i];
  return best;
}
function minBy(list, less) {
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (less(list[i], best)) best = list[i];
  return best;
}
const byRank = (a, b) => rankOf(a) < rankOf(b);
const maxRank = (list) => maxBy(list, byRank);
const minRank = (list) => minBy(list, byRank);
const ascRank = (list) => list.slice().sort((a, b) => rankOf(a) - rankOf(b));
const descRank = (list) => list.slice().sort((a, b) => rankOf(b) - rankOf(a));
const ofSuit = (list, suit) => list.filter((c) => suitOf(c) === suit);
const isHeart = (c) => suitOf(c) === HEARTS;
const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

const trickLed = (t) => (t.plays.length ? suitOf(t.plays[0].card) : null);
const trickWinning = (t) => G.winningPlay(t);
const trickPoints = (t) => t.plays.reduce((n, p) => n + points(p.card), 0);
const cardBy = (t, seat) => { const p = t.plays.find((x) => x.seat === seat); return p ? p.card : null; };
const hasCard = (t, c) => t.plays.some((p) => p.card === c);
/** Seats still to play after me in this trick. */
const laterSeats = (t) => { const out = []; for (let k = t.plays.length + 1; k < 4; k++) out.push((t.leader + k) % 4); return out; };

function passTarget(direction, seat) {
  switch (direction) {
    case 'left': return (seat + 1) % 4;
    case 'right': return (seat + 3) % 4;
    case 'across': return (seat + 2) % 4;
    default: return null;
  }
}

// MARK: Random numbers (seeded by the position, so the same position plays the same way)

function rng32(seed) {
  let s = seed >>> 0;
  return () => {                         // SplitMix32.
    s = (s + 0x9E3779B9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
    z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
}
function seedFor(v) {
  let h = Math.imul(v.seat + 1, 0x9E3779B9) >>> 0;
  for (const c of v.hand.concat([...v.played].sort((a, b) => a - b))) h = Math.imul(h ^ c, 0x01000193) >>> 0;
  return h;
}
function shuffleWith(list, random) {
  const d = list.slice();
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

// MARK: What a player knows (the app's PlayerView)

/** The bot's view with the derived facts the rules use. Hands are sorted low to high,
 *  clubs first, as in the app (ties between equal cards then break the same way). */
export function knowledge(view) {
  const sort = (l) => l.slice().sort((a, b) => a - b);
  const trick = view.trick;
  const tricks = view.completedTricks.concat([trick]);
  const played = new Set();
  for (const t of tricks) for (const p of t.plays) played.add(p.card);
  const hand = sort(view.hand);
  const inHand = new Set(hand);
  const unseen = FULL_DECK.filter((c) => !played.has(c) && !inHand.has(c));
  const voids = [new Set(), new Set(), new Set(), new Set()];
  for (const t of tricks) {
    const led = trickLed(t);
    if (led === null) continue;
    for (const p of t.plays) if (suitOf(p.card) !== led) voids[p.seat].add(led);
  }
  return {
    ...view, hand, legal: sort(view.legalPlays), trick, tricks, played, unseen, voids,
    isLeading: trick.plays.length === 0,
    isFirstTrick: view.completedTricks.length === 0,
  };
}

// MARK: Reading the table (the app's TableRead)

class TableRead {
  constructor(v) {
    this.v = v;
    this.me = v.seat;
    this.unseen = v.unseen;
    this.queenLive = !v.played.has(QUEEN_OF_SPADES);
    this.iHoldQueen = v.hand.includes(QUEEN_OF_SPADES);
    this.voids = v.voids;

    // Seats that were out of a suit and threw something else when they could have dumped
    // the queen — they probably don't hold it.
    const noQueen = new Set();
    let queenSeen = false;
    v.tricks.forEach((t, index) => {
      for (const p of t.plays) {
        if (p.card === QUEEN_OF_SPADES) queenSeen = true;
        else if (!queenSeen && index > 0 && suitOf(p.card) !== trickLed(t)) noQueen.add(p.seat);
      }
    });
    this.probablyNoQueen = noQueen;

    // The 13 cards held after the pass.
    this.startingHand = v.hand.concat(v.tricks.flatMap((t) => t.plays).filter((p) => p.seat === v.seat).map((p) => p.card));

    // Rule 10: only once the queen has been taken, not by me, and its taker has every point.
    const holders = [0, 1, 2, 3].filter((s) => v.handPoints[s] > 0);
    const queenTrick = v.completedTricks.find((t) => hasCard(t, QUEEN_OF_SPADES));
    if (queenTrick) {
      const taker = queenTrick.winner;
      this.moonShooter = taker !== v.seat && holders.length === 1 && holders[0] === taker ? taker : null;
    } else {
      this.moonShooter = null;
    }
    /** Two different players have points: nobody can shoot the moon this hand. */
    this.moonBroken = holders.length >= 2;
    /** Rule 30: before the queen falls, the only player with points (2+), not me. */
    this.earlyRunner = !queenTrick && holders.length === 1 && holders[0] !== v.seat && v.handPoints[holders[0]] >= 2 ? holders[0] : null;
    this.cache = new Map();
  }

  isVoid(seat, suit) { return this.voids[seat].has(suit); }
  unseenOf(suit) { return this.unseen.filter((c) => suitOf(c) === suit); }

  get startingSpadeCount() { return ofSuit(this.startingHand, SPADES).length; }

  /** The queen-taker with every point looks like they're really running: they've led a
   *  heart this hand (this trick included) or taken at least `minHearts` hearts. */
  moonAttemptIsReal(minHearts) {
    const shooter = this.moonShooter;
    if (shooter === null) return false;
    return this.ledHeart(shooter) || this.v.handPoints[shooter] - 13 >= minHearts;
  }

  /** Rule 32: "the person that passes is responsible for stopping the person they passed
   *  to from running." My person has every point so far and has led a heart or taken the queen. */
  get watchedRunner() {
    const v = this.v;
    const target = passTarget(v.passDirection, this.me);
    if (target === null || !(v.handPoints[target] > 0 || this.ledHeart(target))) return null;
    if (![0, 1, 2, 3].every((s) => s === target || v.handPoints[s] === 0)) return null;
    const tookQueen = v.completedTricks.some((t) => hasCard(t, QUEEN_OF_SPADES) && t.winner === target);
    return this.ledHeart(target) || tookQueen ? target : null;
  }

  ledHeart(seat) { return this.v.tricks.some((t) => t.leader === seat && trickLed(t) === HEARTS); }

  /** My hearts that would win this heart trick right now. */
  get heartsBeatingTrick() {
    const t = this.v.trick;
    if (trickLed(t) !== HEARTS) return [];
    const winning = trickWinning(t).card;
    return ascRank(this.v.legal.filter((c) => isHeart(c) && rankOf(c) > rankOf(winning)));
  }

  get isRunning() {
    const v = this.v;
    return isRunHand(this.startingHand) && [0, 1, 2, 3].every((s) => s === this.me || v.handPoints[s] === 0);
  }

  /** The card's rank judged against what's still out, scaled to 2...14 by how many unseen
   *  cards of the suit are below it. */
  effectiveRank(c) {
    let r = this.cache.get(c);
    if (r !== undefined) return r;
    const others = this.unseenOf(suitOf(c));
    if (!others.length) r = 14;
    else {
      const below = others.filter((x) => rankOf(x) < rankOf(c)).length;
      r = 2 + Math.round((12 * below) / others.length);
    }
    this.cache.set(c, r);
    return r;
  }
  isLow(c) { return this.effectiveRank(c) <= 4; }
  isHigh(c) { return this.effectiveRank(c) >= 11; }

  /** Completed tricks led in this suit (the 2♣ trick counts for clubs). */
  roundsLed(suit) { return this.v.completedTricks.filter((t) => trickLed(t) === suit).length; }

  ledHighBefore(suit) {
    return this.v.completedTricks.some((t) => t.leader === this.me && trickLed(t) === suit && rankOf(t.plays[0].card) >= 11);
  }

  /** Someone else is out of this suit and might still be holding the queen. */
  queenDanger(suit) {
    if (!this.queenLive || this.iHoldQueen) return false;
    return [0, 1, 2, 3].some((s) => s !== this.me && this.isVoid(s, suit) && !this.probablyNoQueen.has(s));
  }

  /** The A♠ or K♠ while someone else still has the queen. */
  catchesQueen(c) { return suitOf(c) === SPADES && rankOf(c) > 12 && this.queenLive && !this.iHoldQueen; }

  /** Each player's score as it stands now: the game score plus this hand's points. */
  get standings() { return [0, 1, 2, 3].map((s) => this.projected(s)); }

  /** A seat's score at the end of this hand if it takes `pts` more (ignoring moons). */
  projected(seat, pts = 0) { return this.v.scores[seat] + this.v.handPoints[seat] + pts; }

  /** Giving `pts` to `seat` would push them to 100 and end the game with me not winning. */
  endsGameBadly(pts, seat) {
    if (seat === this.me || this.projected(seat, pts) < TARGET) return false;
    const mine = this.projected(this.me);
    return ![0, 1, 2, 3].filter((s) => s !== this.me).every((o) => mine < this.projected(o, o === seat ? pts : 0));
  }

  /** Nobody still to play can take the trick from its current winner. */
  get trickWinnerIsCertain() {
    const t = this.v.trick;
    const led = trickLed(t);
    if (led === null) return false;
    const winning = trickWinning(t).card;
    const higherOut = this.unseen.some((c) => suitOf(c) === led && rankOf(c) > rankOf(winning));
    return !higherOut || laterSeats(t).every((s) => this.isVoid(s, led));
  }

  /** Rule 24: playing the Q♠ now would leave it winning the trick with players still to
   *  come, and I'm not fairly sure one of them must go over it. */
  get queenIsAGamble() {
    const v = this.v;
    if (!v.legal.includes(QUEEN_OF_SPADES)) return false;
    const t = v.trick;
    const led = trickLed(t);
    if (led !== null) {
      if (led !== SPADES || rankOf(trickWinning(t).card) >= 12) return false;
      if (t.plays.length === 3) return true;     // Last: eating it while holding a lower spade.
    }
    const later = laterSeats(t).filter((s) => !this.isVoid(s, SPADES));
    const spadesOut = this.unseenOf(SPADES);
    const bigOut = spadesOut.filter((c) => rankOf(c) > 12);
    if (!bigOut.length || !later.length) return true;
    if (bigOut.length === spadesOut.length) return false;
    const target = passTarget(v.passDirection, this.me);
    if (target !== null && later.includes(target) && v.passedCards.some((c) => bigOut.includes(c))
        && spadesOut.length - bigOut.length <= 1) return false;
    return true;
  }

  /** Rule 28: until hearts are split, keep my highest heart; and while one other player has
   *  every point so far, also keep a small heart for each higher heart still out. */
  get protectedHearts() {
    if (this._protected) return this._protected;
    const keep = new Set();
    this._protected = keep;
    if (this.moonBroken) return keep;
    const v = this.v;
    const hearts = ascRank(ofSuit(v.hand, HEARTS));
    if (!hearts.length) return keep;
    const stopper = hearts[hearts.length - 1];
    keep.add(stopper);
    const holders = [0, 1, 2, 3].filter((s) => v.handPoints[s] > 0);
    if (holders.length === 1 && holders[0] !== this.me) {
      const higherOut = this.unseen.filter((c) => isHeart(c) && rankOf(c) > rankOf(stopper)).length;
      hearts.slice(0, -1).slice(0, higherOut).forEach((c) => keep.add(c));
    }
    return keep;
  }

  /** Rule 28: I can't be made to win this suit — nobody else has it, or I hold a card below
   *  everything still out for each time the suit can be led. */
  suitIsSafe(suit) {
    const out = this.unseenOf(suit);
    if (!out.length) return true;
    const lowestOut = Math.min(...out.map(rankOf));
    const ducks = this.v.hand.filter((c) => suitOf(c) === suit && rankOf(c) < lowestOut).length;
    const followers = Math.max(1, [0, 1, 2, 3].filter((s) => s !== this.me && !this.isVoid(s, suit)).length);
    const rounds = Math.min(out.length, Math.floor((out.length + followers - 1) / followers) + 1);
    return ducks >= rounds;
  }

  /** Rule 29: when I'm out of the led suit late in the game, what I throw depends on who
   *  would get it. Null when it doesn't apply. */
  get lateThrow() {
    const v = this.v;
    const scores = this.standings;
    const t = v.trick;
    const low = Math.min(...scores);
    const isHighP = (s) => scores[s] !== low && (scores[s] > 75 || scores[s] - low >= 50);
    const led = trickLed(t);
    if (![0, 1, 2, 3].some(isHighP) || led === null || v.legal.some((c) => suitOf(c) === led)) return null;
    const winner = trickWinning(t).seat;
    const legal = v.legal;
    const hasQueen = legal.includes(QUEEN_OF_SPADES);
    const hearts = descRank(legal.filter((c) => isHeart(c) && !this.protectedHearts.has(c)));
    const plain = legal.filter((c) => points(c) === 0);
    const iAmLow = scores[this.me] === low;
    const certain = this.trickWinnerIsCertain;
    const tp = trickPoints(t);

    // Points that end the game.
    if (this.projected(winner, tp + 1) >= TARGET) {
      if (certain && !this.endsGameBadly(tp + (hasQueen ? 13 : 1), winner)) {
        if (hasQueen) return { card: QUEEN_OF_SPADES };
        if (hearts.length) return { card: hearts[0] };
      } else if (!iAmLow) {
        const c = maxBy(plain, (a, b) => this.effectiveRank(a) < this.effectiveRank(b));
        if (c !== null) return { card: c, noPoints: true };
      }
    }
    // The lowest scorer takes it for sure.
    if (certain && scores[winner] === low && winner !== this.me) {
      if (hasQueen) return { card: QUEEN_OF_SPADES };
      if (!this.queenLive && hearts.length) return { card: hearts[0] };
      return null;
    }
    // Not decided yet, and a high player could end up with my queen.
    if (!certain && hasQueen && !iAmLow) {
      const couldGetIt = [winner].concat(laterSeats(t)).some((s) => s !== this.me && isHighP(s));
      if (couldGetIt) {
        const bare = !v.hand.some((c) => suitOf(c) === SPADES && c !== QUEEN_OF_SPADES);
        return bare ? { card: QUEEN_OF_SPADES } : { card: null, holdQueen: true };
      }
    }
    return null;
  }

  /** Rule 27: A♠/K♠ leads that rule 9 forbids. */
  get bigSpadeLeadsIntoQueen() {
    const legal = this.v.legal;
    const big = (c) => suitOf(c) === SPADES && rankOf(c) > 12;
    if (!this.queenLive || this.iHoldQueen || !legal.some((c) => !big(c))) return [];
    return legal.filter(big);
  }

  /** Rule 24: A♠/K♠ that would cover a spade lead with the queen still out, someone after
   *  me still to play, and another spade below the queen I could play instead. */
  get bigSpadeFollowsIntoQueen() {
    const t = this.v.trick, legal = this.v.legal;
    if (trickLed(t) !== SPADES || t.plays.length >= 3 || !this.queenLive || this.iHoldQueen
        || !legal.some((c) => suitOf(c) === SPADES && rankOf(c) < 12)) return [];
    return legal.filter((c) => this.catchesQueen(c));
  }

  /** Rule 13 (Louie, 2026-10-22): dump the queen whenever possible — but never hand
   *  someone points that end the game with me losing, unless eating it puts me out. */
  shouldDumpQueen(winner) {
    if (winner === this.me) return false;
    if (this.endsGameBadly(13 + trickPoints(this.v.trick), winner)) return this.projected(this.me, 13) >= TARGET;
    return true;
  }

  /** Rule 20: how leading `c` looks given who can still follow the suit. */
  countingAdjustment(c) {
    const out = this.unseenOf(suitOf(c));
    if (!out.length) return -3;                       // I win it and eat whatever is thrown.
    const top = Math.max(...out.map(rankOf)), bottom = Math.min(...out.map(rankOf));
    const someoneVoid = [0, 1, 2, 3].some((s) => s !== this.me && this.isVoid(s, suitOf(c)));
    if (rankOf(c) > top && someoneVoid) return -2;
    if (rankOf(c) < bottom) return 1;                 // Someone else has to take it.
    return 0;
  }

  /** Whether, after playing `c`, I'd still have a safe card to lead. */
  hasOKLead(without) {
    return this.v.hand.some((c) => c !== without && !isHeart(c) && this.effectiveRank(c) <= 6
      && !this.queenDanger(suitOf(c)) && !(suitOf(c) === SPADES && rankOf(c) >= 12 && this.queenLive));
  }
}

// MARK: Passing helpers (static in the app)

/** Rules 6 and 7. */
function isRunHand(hand) {
  const hearts = ofSuit(hand, HEARTS);
  const heartRanks = new Set(hearts.map(rankOf));
  if (heartRanks.has(12) && heartRanks.has(13) && heartRanks.has(14) && hearts.length >= 6) return true;
  const heartsHoldUp = hearts.every((c) => rankOf(c) >= 11);
  for (const suit of [CLUBS, DIAMONDS, SPADES]) {
    const ranks = new Set(ofSuit(hand, suit).map(rankOf));
    if (heartsHoldUp && ranks.size >= 6 && ranks.has(12) && ranks.has(13) && ranks.has(14)) return true;
  }
  return false;
}

const suitCounts = (cards) => { const n = [0, 0, 0, 0]; for (const c of cards) n[suitOf(c)]++; return n; };

/** Rule 8: going for the moon, keep the high cards and pass low ones from short suits. */
function runPass(hand) {
  const counts = suitCounts(hand);
  return hand.slice().sort((a, b) => (rankOf(a) !== rankOf(b) ? rankOf(a) - rankOf(b) : counts[suitOf(a)] - counts[suitOf(b)])).slice(0, 3);
}

function fillPriority(c, counts) {
  switch (suitOf(c)) {
    case SPADES: return rankOf(c);
    case HEARTS: return 1000 + rankOf(c);
    default: return 2000 + rankOf(c) * 10 - counts[suitOf(c)];
  }
}

/** Rules 3, 4, 5 — the spade count includes the card itself; 4+ spades keeps everything. */
function spadePass(hand, direction) {
  const spades = ofSuit(hand, SPADES);
  const big = [ACE_OF_SPADES, KING_OF_SPADES].filter((c) => spades.includes(c));
  if (spades.length > 3) return [];
  if (!spades.includes(QUEEN_OF_SPADES)) return big;
  const pass = [QUEEN_OF_SPADES];
  if (big.length === 2) pass.push(...big);
  else if (big.length && (direction !== 'right' || spades.length < 3)) pass.push(big[0]);
  return pass;
}

/** Rule 31: the A♥ and one heart of 9 or lower are my only hearts. */
function aceHeartPair(hand) {
  const hearts = descRank(ofSuit(hand, HEARTS));
  return hearts.length === 2 && rankOf(hearts[0]) === 14 && rankOf(hearts[1]) <= 9 ? hearts : null;
}

/** Rule 1: the highest heart you can cover (your second-highest). A lone heart goes
 *  unless it's the Q, K or A. */
function heartToPass(hand) {
  const hearts = descRank(ofSuit(hand, HEARTS));
  if (hearts.length >= 2) return hearts[1];
  if (hearts.length && rankOf(hearts[0]) < 12) return hearts[0];
  return null;
}

/** Rule 32: the hearts I keep can cover every heart I pass (the A♥ pair is exempt). */
function keepsCover(pass, hand) {
  const passedHearts = pass.filter(isHeart);
  if (!passedHearts.length) return true;
  const topPassed = Math.max(...passedHearts.map(rankOf));
  const pair = aceHeartPair(hand);
  if (pair && pair.every((c) => pass.includes(c))) return true;
  const kept = hand.filter((c) => isHeart(c) && !pass.includes(c)).map(rankOf);
  return (kept.length ? Math.max(...kept) : 0) > topPassed;
}

/** Rule 26: the pass look-ahead may not break Louie's spade and heart rules. */
function passKeepsProtection(pass, hand, rulePass) {
  if (!keepsCover(pass, hand)) return false;
  const heartRanks = ofSuit(hand, HEARTS).map(rankOf);
  const topHeart = heartRanks.length ? Math.max(...heartRanks) : 0;
  const pair = aceHeartPair(hand);
  return pass.every((c) => {
    switch (suitOf(c)) {
      case SPADES: return rulePass.includes(c);
      case HEARTS:
        if (rankOf(c) === 14) return pair ? pair.every((x) => pass.includes(x)) : false;
        return rankOf(c) < topHeart || rulePass.includes(c);
      default: return true;
    }
  });
}

// MARK: The strategy

export class RuleBot {
  constructor(options = {}) {
    this.name = "Louie's Rules";
    this.endgame = true;              // Rule 21.
    this.passLookAhead = true;        // Rule 23.
    this.endgameSamples = 40;         // Possible deals tried per card by the endgame look-ahead.
    this.endgameCards = 10;           // Cards left in hand at which it starts.
    this.passSamples = 20;            // Imagined deals per candidate pass.
    this.passMargin = 0.25;           // Points per hand a pass must save to override the rules.
    this.heartMargin = 2.4;           // ...to leave out the heart the rules pass (rule 1).
    this.heartPassRate = 1;           // How often this player passes a heart (Louie: 60–90%).
    this.playMargin = 0.5;            // Points a card must save to override the rule card.
    this.moonSplitHearts = 3;         // Hearts the queen-taker must have before rule 27's split.
    Object.assign(this, options);
  }

  /** The same player without look-aheads: plays the imagined hands. */
  policy() { return new RuleBot({ ...this, endgame: false, passLookAhead: false }); }

  // MARK: Passing

  /** Whether this hand is one where I pass a heart (drawn at my heart-pass rate, the same
   *  every time for the same hand). */
  passesHeart(v) {
    if (this.heartPassRate >= 1) return true;
    return rng32(seedFor(v) ^ 0x48454152)() < this.heartPassRate;
  }

  choosePass(view) {
    const v = knowledge(view);
    const pass = this.rulePass(v);
    if (!this.passLookAhead || v.passDirection === 'none') return pass;
    // Rule 23. The imagined hands are played by the rules without any look-ahead.
    const heartsAllowed = this.passesHeart(v);
    const limits = (p) => passKeepsProtection(p, v.hand, pass);
    const allowed = heartsAllowed ? limits : (p) => p.every((c) => !isHeart(c)) && limits(p);
    return choosePassByLookAhead(v, pass, this.policy(), this.passSamples, allowed, this.passMargin, this.heartMargin, rng32(seedFor(v)));
  }

  /** Rules 1–8 with rule 25's review and rule 32's cover. */
  rulePass(v) {
    if (isRunHand(v.hand)) return runPass(v.hand);
    return this.coverPassedHearts(this.reviewPass(v), v.hand);
  }

  /** Rule 32: swap out passed hearts my kept hearts can't cover, highest first, for the
   *  best club or diamond left (else a spade below the queen). */
  coverPassedHearts(pass, hand) {
    pass = pass.slice();
    const counts = suitCounts(hand);
    while (!keepsCover(pass, hand)) {
      const heart = maxRank(pass.filter(isHeart));
      const swap = maxBy(hand.filter((c) => !pass.includes(c) && !isHeart(c) && !(suitOf(c) === SPADES && rankOf(c) >= 12)),
        (a, b) => fillPriority(a, counts) < fillPriority(b, counts));
      if (heart === null || swap === null) break;
      pass[pass.indexOf(heart)] = swap;
    }
    return pass;
  }

  /** Rule 25: the pass review with Louie (2026-10-14). */
  reviewPass(v) {
    const hand = v.hand;
    const pass = spadePass(hand, v.passDirection);
    const spadeCount = ofSuit(hand, SPADES).length;
    const keep = new Set([ACE_OF_HEARTS]);
    const pair = aceHeartPair(hand);
    if (pair && pass.length <= 1) pass.push(...pair);                // Rule 31.
    if (spadeCount >= 5) keep.add(ACE_OF_SPADES);
    if (pass.includes(QUEEN_OF_SPADES)) {
      const entry = maxBy(hand.filter((c) => (suitOf(c) === CLUBS || suitOf(c) === DIAMONDS) && rankOf(c) === 14),
        (a, b) => ofSuit(hand, suitOf(a)).length < ofSuit(hand, suitOf(b)).length);
      if (entry !== null) keep.add(entry);
    }

    // Rule 1, waiting its turn: with only low hearts there's no run to stop.
    const hearts = ofSuit(hand, HEARTS);
    const topHeart = hearts.length ? Math.max(...hearts.map(rankOf)) : 0;
    if (pass.length < 3 && this.passesHeart(v) && (hearts.length === 1 || topHeart >= 8)) {
      const heart = heartToPass(hand);
      if (heart !== null && !pass.includes(heart)) pass.push(heart);
    }

    const side = (suit) => descRank(hand.filter((c) => suitOf(c) === suit && !pass.includes(c) && !keep.has(c)));

    // Dangerous suits: high cards (10+) not outnumbered by low ones (8 and below).
    while (pass.length < 3) {
      const scored = [];
      for (const suit of [CLUBS, DIAMONDS]) {
        const cards = hand.filter((c) => suitOf(c) === suit && !pass.includes(c));
        const highs = cards.filter((c) => rankOf(c) >= 10).length;
        const lows = cards.filter((c) => rankOf(c) <= 8).length;
        if (highs > 0 && highs >= lows && side(suit).length) scored.push({ suit, key: [highs - lows, highs] });
      }
      const worst = maxBy(scored, (a, b) => lexLess(a.key, b.key));
      if (!worst) break;
      pass.push(side(worst.suit)[0]);
    }

    // Other high clubs and diamonds.
    for (const c of descRank(side(CLUBS).concat(side(DIAMONDS)).filter((x) => rankOf(x) >= 10))) if (pass.length < 3) pass.push(c);

    // Get down to one club or none (clubs are led first), else one diamond.
    while (pass.length < 3) {
      const slots = 3 - pass.length;
      const suit = [CLUBS, DIAMONDS].find((s) => side(s).length && side(s).length - 1 <= slots);
      if (suit === undefined) break;
      pass.push(side(suit)[0]);
    }

    // The rest: clubs and diamonds high to low, then hearts, then spades.
    const key = (c) => [keep.has(c) ? 0 : 1, suitOf(c) === SPADES ? 1 : isHeart(c) ? 2 : 3, rankOf(c)];
    const rest = hand.filter((c) => !pass.includes(c)).sort((a, b) => (lexLess(key(b), key(a)) ? -1 : lexLess(key(a), key(b)) ? 1 : 0));
    for (const c of rest) if (pass.length < 3) pass.push(c);
    return pass;
  }

  // MARK: Playing

  choosePlay(view) { return this.play(knowledge(view)); }

  play(v) {
    const c = this.chooseCard(v);
    // Louie (2026-10-22): once the hearts are split, a heart thrown away is my highest.
    if (!isHeart(c) || v.isLeading) return c;
    const led = trickLed(v.trick);
    if (led === HEARTS || v.legal.some((x) => suitOf(x) === led)) return c;
    if (v.handPoints.filter((p) => p > 0).length < 2) return c;
    return maxRank(v.legal.filter(isHeart)) ?? c;
  }

  chooseCard(v) {
    const legal = v.legal;
    if (legal.length === 1) return legal[0];
    const read = new TableRead(v);

    let ruleCard;
    if (read.isRunning) ruleCard = this.runPlay(read);
    else if (v.isLeading) ruleCard = this.lead(read);
    else if (legal.some((c) => suitOf(c) === trickLed(v.trick))) ruleCard = this.follow(read);
    else ruleCard = this.discard(read);

    // Rule 27: when the rules throw the queen, it goes; no look-ahead second guess.
    if (ruleCard === QUEEN_OF_SPADES && !v.isLeading) return ruleCard;

    // Rule 32: covering the runner's heart stands; once the look-ahead runs it picks
    // among the hearts that win.
    let coverChoices = null;
    const runner = read.isRunning ? null : this.runner(read);
    if (runner !== null && ruleCard === this.coverHeart(read, runner)) {
      const winners = read.heartsBeatingTrick;
      if (winners.length < 2 || !this.endgame || v.hand.length > this.endgameCards) return ruleCard;
      coverChoices = new Set(winners);
    }
    // Rule 27: rule 10's heart stands against a real moon attempt.
    if (!coverChoices && read.moonShooter !== null && !read.isRunning && isHeart(ruleCard)
        && read.moonAttemptIsReal(this.moonSplitHearts)) return ruleCard;
    // Rule 30: the cheap early moon stop stands too.
    const stop = this.earlyMoonStop(read);
    if (stop !== null && stop === ruleCard) return ruleCard;

    // Rule 21: late in the hand, check the rule choice against a look-ahead.
    if (this.endgame && v.hand.length <= this.endgameCards) {
      const me = v.seat;
      const costs = evaluateEndgame(v, this.policy(), this.endgameSamples, (g) => g.handHistory[g.handHistory.length - 1]?.[me] ?? 0, rng32(seedFor(v)));
      if (costs) {
        // Rule 24: no playing the queen into the trick on a guess.
        if (read.queenIsAGamble) costs.delete(QUEEN_OF_SPADES);
        // Rule 27: never lead the A♠/K♠ into a live queen while holding something else.
        if (v.isLeading) for (const c of read.bigSpadeLeadsIntoQueen) if (c !== ruleCard) costs.delete(c);
        // Rule 24: nor cover a spade lead with them while the queen could still land.
        for (const c of read.bigSpadeFollowsIntoQueen) if (c !== ruleCard) costs.delete(c);
        // Rule 29: late in the game Louie's throws by who gets them stand.
        const late = read.lateThrow;
        if (late) {
          if (late.card) return late.card;
          if (late.holdQueen) costs.delete(QUEEN_OF_SPADES);
          if (late.noPoints) for (const c of [...costs.keys()]) if (points(c) > 0 && c !== ruleCard) costs.delete(c);
        }
        // Rule 28: the stopper and its guards stay until hearts are split.
        if (!v.isLeading && !legal.some((c) => suitOf(c) === trickLed(v.trick))) {
          for (const c of read.protectedHearts) if (c !== ruleCard) costs.delete(c);
        }
        if (coverChoices) for (const c of [...costs.keys()]) if (!coverChoices.has(c)) costs.delete(c);
        let best = null;
        for (const [c, cost] of costs) if (best === null || cost < best[1]) best = [c, cost];
        const ruleCost = costs.has(ruleCard) ? costs.get(ruleCard) : Infinity;
        if (best && best[1] < ruleCost - this.playMargin) return best[0];
      }
    }
    return ruleCard;
  }

  /** Who I'm stopping: the queen-taker with every point (rule 10), or under rule 32 the
   *  player I passed to once they look like running. */
  runner(read) { return read.moonShooter ?? read.watchedRunner; }

  /** Rule 32: they're winning a heart trick — beat it. The highest with nobody after me
   *  who could go over; with players still to come, the lowest that wins. Can't win: the lowest. */
  coverHeart(read, runner) {
    const v = read.v, t = v.trick;
    if (trickLed(t) !== HEARTS || trickWinning(t).seat !== runner) return null;
    const hearts = ascRank(v.legal.filter(isHeart));
    if (!hearts.length) return null;
    const winners = read.heartsBeatingTrick;
    if (!winners.length) return hearts[0];
    const lowestWin = winners[0];
    const higherOut = read.unseen.some((c) => isHeart(c) && rankOf(c) > rankOf(lowestWin));
    const laterMayHaveHearts = laterSeats(t).some((s) => !read.isVoid(s, HEARTS));
    return higherOut && laterMayHaveHearts ? lowestWin : winners[winners.length - 1];
  }

  // MARK: Leading

  lead(read) {
    const v = read.v, legal = v.legal;
    // Rule 10: someone may be running — lead my highest heart to split the points.
    if (read.moonShooter !== null) {
      const heart = maxRank(legal.filter(isHeart));
      if (heart !== null) return heart;
    }
    // Rule 9: hunt the queen.
    const hunt = this.huntLead(read);
    if (hunt !== null) return hunt;

    // Rule 12 for clubs and diamonds; defaults for the rest. Highest priority wins, then
    // the shorter suit (to get void), then the lower card.
    const options = [];
    const counts = suitCounts(v.hand);
    for (const suit of [CLUBS, DIAMONDS, SPADES, HEARTS]) {
      const cards = ascRank(ofSuit(legal, suit));
      if (!cards.length) continue;
      const option = suit === CLUBS || suit === DIAMONDS ? this.sideSuitLead(cards, suit, read) : this.otherLead(cards, suit, read);
      option.priority += read.countingAdjustment(option.card);          // Rule 20.
      options.push(option);
    }
    const best = maxBy(options, (a, b) => {
      if (a.priority !== b.priority) return a.priority < b.priority;
      const ca = counts[suitOf(a.card)], cb = counts[suitOf(b.card)];
      if (ca !== cb) return ca > cb;
      return read.effectiveRank(a.card) > read.effectiveRank(b.card);
    });
    return best ? best.card : legal[0];
  }

  /** Rule 9. Lead the highest spade from the J down; never the A or K. */
  huntLead(read) {
    if (!read.queenLive) return null;
    const v = read.v;
    const top = maxRank(v.legal.filter((c) => suitOf(c) === SPADES && rankOf(c) <= 11));
    if (top === null) return null;
    const spadeCount = ofSuit(v.hand, SPADES).length;
    if (read.iHoldQueen) return spadeCount >= 5 ? top : null;      // Leading spades to confuse.
    const holdsBig = v.hand.some((c) => suitOf(c) === SPADES && rankOf(c) >= 13);
    return !holdsBig || read.startingSpadeCount >= 4 ? top : null;
  }

  /** Rule 12 for clubs and diamonds. */
  sideSuitLead(cards, suit, read) {
    const rounds = read.roundsLed(suit);
    const firstTime = suit === CLUBS ? rounds <= 1 : rounds === 0;   // The 2♣ trick is clubs' first round.
    const danger = read.queenDanger(suit);
    const high = cards[cards.length - 1], low = cards[0];
    if (!danger) {
      if (cards.length === 2 && (firstTime || (read.isHigh(high) && read.isLow(low)))) return { card: high, priority: 3 };
      if (cards.length === 3 && firstTime && read.isHigh(high) && !read.isHigh(cards[1])) return { card: high, priority: 3 };
      // "...followed by mid": after leading the high one, lead a medium one next.
      if (read.ledHighBefore(suit)) {
        const mids = cards.filter((c) => !read.isHigh(c) && !read.isLow(c));
        if (mids.length) return { card: mids[mids.length - 1], priority: 2 };
      }
    }
    if (cards.length >= 4) return { card: cards[1], priority: danger ? 0 : 1 };   // Not your lowest.
    return { card: low, priority: danger ? 0 : read.isHigh(low) ? 0 : 1 };
  }

  /** Defaults for hearts and for spades outside a hunt. */
  otherLead(cards, suit, read) {
    const low = cards[0];
    if (suit === SPADES && read.queenLive) {
      // Not the Q, K or A while the queen is out — a lone K♠/A♠ only when nothing else can be led.
      const safe = cards.filter((c) => rankOf(c) < 12);
      return safe.length ? { card: safe[0], priority: 0 } : { card: low, priority: read.iHoldQueen ? -2 : -100 };
    }
    return { card: low, priority: read.isLow(low) ? 1 : 0 };
  }

  // MARK: Following suit

  follow(read) {
    const v = read.v, t = v.trick;
    const led = trickLed(t);
    const mine = ascRank(v.legal);
    const { card: winning, seat: winner } = trickWinning(t);
    const isLast = t.plays.length === 3;
    const tp = trickPoints(t);

    // Rule 13: drop the queen under a higher spade.
    if (led === SPADES && mine.includes(QUEEN_OF_SPADES) && rankOf(winning) > 12 && read.shouldDumpQueen(winner)) return QUEEN_OF_SPADES;
    // Rule 14: nothing can be thrown on the 2♣ trick, so unload the top club.
    if (v.isFirstTrick && led === CLUBS) return maxRank(mine);
    // Rule 32: cover the runner's heart, choosing which heart by who's still to play.
    if (!read.isRunning) {
      const runner = this.runner(read);
      if (runner !== null) { const cover = this.coverHeart(read, runner); if (cover !== null) return cover; }
    }
    // Rule 10: try to take a heart myself to split the points; else my lowest heart.
    if (read.moonShooter !== null && led === HEARTS) {
      const top = maxRank(mine);
      return rankOf(top) > rankOf(winning) ? top : minRank(mine);
    }
    // Rule 30: someone has every point before the queen falls; go over them if safe.
    const stop = this.earlyMoonStop(read);
    if (stop !== null) return stop;

    const duck = maxRank(mine.filter((c) => rankOf(c) < rankOf(winning) && c !== QUEEN_OF_SPADES));
    // Cards that win without needless risk: never the Q♠, and not the A/K of spades while
    // someone after me could still drop the queen on it.
    const safeOver = mine.filter((c) => rankOf(c) > rankOf(winning) && c !== QUEEN_OF_SPADES && !(read.catchesQueen(c) && !isLast));
    const forced = maxRank(mine.filter((c) => c !== QUEEN_OF_SPADES && !(read.catchesQueen(c) && !isLast)))
      ?? maxRank(mine.filter((c) => c !== QUEEN_OF_SPADES)) ?? mine[mine.length - 1];

    if (isLast) {
      const top = maxRank(safeOver);
      if (tp === 0 && top !== null && read.hasOKLead(top)) return top;   // Rule 11: take it high, lead next.
      return duck ?? forced;
    }
    if (tp > 0) return duck ?? forced;

    const lows = mine.filter((c) => read.isLow(c));
    const top = maxRank(safeOver);
    if (read.roundsLed(led) === 0) {
      if (!lows.length && top !== null) return top;                       // Only medium or high cards.
    } else if (lows.length === 1 && mine.length >= 2 && mine.filter((c) => !read.isLow(c)).every((c) => read.isHigh(c)) && top !== null) {
      return top;                                                          // One low card and the rest high.
    }
    return duck ?? forced;
  }

  // MARK: Void in the led suit

  discard(read) {
    const v = read.v, legal = v.legal, t = v.trick;
    const winner = trickWinning(t).seat;

    // Rule 10: give someone other than the shooter a point.
    const shooter = this.runner(read);
    if (shooter !== null && cardBy(t, shooter) !== null && winner !== shooter) {
      const heart = minRank(legal.filter(isHeart));
      if (heart !== null) return heart;
    }
    // Rule 32: my person is winning the trick — don't feed them points.
    const starve = read.moonShooter === null && read.watchedRunner === winner;
    // Rule 29: late in the game, what to throw depends on who gets it.
    let holdQueen = starve;
    const late = read.lateThrow;
    if (late) {
      if (late.card) return late.card;
      holdQueen = holdQueen || Boolean(late.holdQueen);
    }
    // Rule 13.
    if (!holdQueen && legal.includes(QUEEN_OF_SPADES) && read.shouldDumpQueen(winner)) return QUEEN_OF_SPADES;
    // Rule 30: someone has every point before the queen falls; hand someone else a heart.
    const stop = this.earlyMoonStop(read);
    if (stop !== null) return stop;

    // Default: throw the most dangerous card, preferring to empty short suits.
    const counts = suitCounts(v.hand);
    const topHeart = maxRank(ofSuit(v.hand, HEARTS));
    const score = (c) => this.discardScore(c, read, counts, topHeart);
    const pointless = legal.filter((c) => points(c) === 0);
    const pool = starve && pointless.length ? pointless : legal;
    return maxBy(pool, (a, b) => score(a) < score(b));
  }

  discardScore(c, read, counts, topHeart) {
    if (c === QUEEN_OF_SPADES) return -1000;
    // Keep the top heart as a moon stopper while someone might be running.
    if (c === topHeart && this.runner(read) !== null) return -500;
    const rank = read.effectiveRank(c);
    const shortness = 13 - counts[suitOf(c)];
    // Rule 28: never the heart stopper or its guards before hearts are split.
    if (read.protectedHearts.has(c)) return -500 + rank;
    // Keep low cards to get out of the lead — unless I hold the queen and this empties a suit.
    if (!isHeart(c) && read.isLow(c)) {
      const lastOfSuit = counts[suitOf(c)] === 1;
      if (!(read.iHoldQueen && lastOfSuit)) return -100 + rank;
    }
    // "If you are the only one with the suit, no need to throw it."
    if (!isHeart(c) && !read.catchesQueen(c) && read.suitIsSafe(suitOf(c))) return -50 + rank;
    // Rule 17: A♠/K♠ while the queen is out, high hearts, high cards with no low card to
    // escape with, other hearts, then the rest.
    if (read.catchesQueen(c)) return 5000 + rankOf(c);
    if (isHeart(c)) return (read.isHigh(c) ? 4000 : 2000) + rank;
    const hasEscape = read.v.hand.some((x) => suitOf(x) === suitOf(c) && read.isLow(x));
    if (read.isHigh(c) && !hasEscape) return 4500 + rank;               // Rule 28: a lone A♦ before the K♥.
    return rank * 10 + shortness;
  }

  // MARK: Running and stopping runs

  /** Rule 30: "if it is cheap to stop the one person getting all the hearts then do it". */
  earlyMoonStop(read) {
    const v = read.v;
    const runner = read.earlyRunner;
    if (runner === null || read.isRunning || v.isLeading) return null;
    const t = v.trick, legal = v.legal;
    const hearts = ascRank(legal.filter(isHeart));
    const led = trickLed(t);
    if (led === null || !hearts.length) return null;
    const { card: winning, seat: winner } = trickWinning(t);
    if (!legal.some((c) => suitOf(c) === led)) {
      return cardBy(t, runner) !== null && winner !== runner ? hearts[0] : null;
    }
    const top = hearts[hearts.length - 1];
    if (led !== HEARTS || hasCard(t, QUEEN_OF_SPADES) || rankOf(top) <= rankOf(winning)) return null;
    if (!(winner === runner || cardBy(t, runner) === null)) return null;
    const queenCanLand = read.queenLive && !read.iHoldQueen && laterSeats(t).some((s) => read.isVoid(s, HEARTS));
    return queenCanLand ? null : top;
  }

  /** Once a run is on: win everything, throw away low cards. */
  runPlay(read) {
    const v = read.v, legal = v.legal;
    const weaker = (a, b) => (read.effectiveRank(a) !== read.effectiveRank(b) ? read.effectiveRank(a) < read.effectiveRank(b) : rankOf(a) < rankOf(b));
    if (v.isLeading) return maxBy(legal, weaker);
    const t = v.trick;
    if (legal.some((c) => suitOf(c) === trickLed(t))) {
      const top = maxRank(legal);
      return rankOf(top) > rankOf(trickWinning(t).card) ? top : minRank(legal);
    }
    const nonHearts = legal.filter((c) => !isHeart(c));
    return minBy(nonHearts.length ? nonHearts : legal, weaker);
  }
}

// MARK: Rule 21 — the endgame look-ahead (EndgameSolver)

/** Average cost of each legal card over possible deals of the unseen cards, with
 *  `policy` playing out every seat; null if no consistent deal could be found. */
function evaluateEndgame(v, policy, samples, cost, random) {
  const totals = new Map(v.legal.map((c) => [c, 0]));
  let dealt = 0;
  for (let i = 0; i < samples; i++) {
    const hands = sampleDeal(v, random);
    if (!hands) continue;
    dealt++;
    for (const c of v.legal) totals.set(c, totals.get(c) + cost(playout(v, hands, c, policy)));
  }
  if (!dealt) return null;
  for (const [c, total] of totals) totals.set(c, total / dealt);
  return totals;
}

/** One random assignment of the unseen cards to the other players that fits what I know:
 *  hand sizes, known voids, and where my passed cards went. */
function sampleDeal(v, random) {
  const me = v.seat;
  const target = passTarget(v.passDirection, me);
  for (let attempt = 0; attempt < 20; attempt++) {
    const hands = [[], [], [], []];
    hands[me] = v.hand.slice();
    const need = [0, 1, 2, 3].map((s) => 13 - v.tricks.reduce((n, t) => n + t.plays.filter((p) => p.seat === s).length, 0));
    need[me] = 0;
    let pool = v.unseen.slice();
    if (target !== null) {
      for (const c of v.passedCards) {
        if (pool.includes(c)) { hands[target].push(c); need[target]--; pool = pool.filter((x) => x !== c); }
      }
    }
    const eligible = (c) => [0, 1, 2, 3].filter((s) => s !== me && need[s] > 0 && !v.voids[s].has(suitOf(c)));
    // Place the most constrained cards first so the deal rarely dead-ends.
    const ordered = shuffleWith(pool, random).map((c) => [c, eligible(c).length]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
    let failed = false;
    for (const c of ordered) {
      const seats = eligible(c);
      if (!seats.length) { failed = true; break; }
      // Weight by open slots so every consistent deal is about equally likely.
      let pick = Math.floor(random() * seats.reduce((n, s) => n + need[s], 0));
      let chosen = seats[0];
      for (const s of seats) { if (pick < need[s]) { chosen = s; break; } pick -= need[s]; }
      hands[chosen].push(c);
      need[chosen]--;
    }
    if (!failed) return hands;
  }
  return null;
}

/** A game in the middle of a hand, for playing out imagined deals. */
function gameAt(v, hands) {
  const handPoints = [0, 0, 0, 0];
  for (const t of v.completedTricks) handPoints[t.winner] += trickPoints(t);
  return {
    phase: v.trick.plays.length === 4 ? 'trickComplete' : 'playing',
    handNumber: v.handNumber, scores: v.scores.slice(), handHistory: [],
    hands: hands.map((h) => h.slice()), handPoints,
    completedTricks: v.completedTricks.slice(), heartsBroken: v.heartsBroken,
    moonShooter: null, moonWentDown: false,
    passedCards: [[], [], [], []], receivedCards: [[], [], [], []], pendingPasses: [null, null, null, null],
    trick: { leader: v.trick.leader, plays: v.trick.plays.slice() }, choosesMoon: [],
  };
}

function playOut(game, policy) {
  while (game.phase === 'playing' || game.phase === 'trickComplete') {
    if (game.phase === 'trickComplete') { G.collectTrick(game); continue; }
    const seat = G.turn(game);
    const legal = G.legalPlays(game, seat);
    const choice = policy.choosePlay(G.view(game, seat));
    G.play(game, seat, legal.includes(choice) ? choice : legal[0]);
  }
  return game;
}

function playout(v, hands, first, policy) {
  const game = gameAt(v, hands);
  G.play(game, v.seat, first);
  return playOut(game, policy);
}

// MARK: Rule 23 — the pass look-ahead (PassSolver)

function choosePassByLookAhead(v, rulePass, policy, samples, allowed, margin, heartMargin, random) {
  const candidates = candidatePasses(v.hand, rulePass, allowed);
  if (candidates.length < 2 || samples <= 0) return rulePass;
  const others = FULL_DECK.filter((c) => !v.hand.includes(c));
  const totals = candidates.map(() => 0);
  for (let i = 0; i < samples; i++) {
    // The same imagined deal for every candidate, so they're compared fairly.
    const deck = shuffleWith(others, random);
    const hands = [];
    let next = 0;
    for (let s = 0; s < 4; s++) {
      if (s === v.seat) hands.push(v.hand.slice());
      else { hands.push(deck.slice(next, next + 13)); next += 13; }
    }
    candidates.forEach((pass, k) => { totals[k] += playHand(hands, v, pass, policy); });
  }
  // The average must be `margin` points better than the rule pass — or, when the rules
  // pass a heart (rule 1), `heartMargin` points better to leave it out.
  const rulePassesHeart = rulePass.some(isHeart);
  const scores = candidates.map((pass, k) => (rulePassesHeart && !pass.some(isHeart) ? totals[k] + (heartMargin - margin) * samples : totals[k]));
  let best = 0;
  for (let k = 1; k < scores.length; k++) if (scores[k] < scores[best]) best = k;
  return scores[best] < totals[0] - margin * samples ? candidates[best] : rulePass;
}

/** The rule pass first, then every 3 cards from the most passable 7: the rule pass cards
 *  plus the highest cards in the hand. */
function candidatePasses(hand, rulePass, allowed) {
  const pool = rulePass.slice();
  for (const c of descRank(hand)) if (!pool.includes(c) && pool.length < 7 && allowed([c])) pool.push(c);
  const same = (p) => p.length === rulePass.length && p.every((c) => rulePass.includes(c));
  const passes = [rulePass];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const pass = [pool[i], pool[j], pool[k]];
        if (!same(pass) && allowed(pass)) passes.push(pass);
      }
    }
  }
  return passes;
}

/** Plays one whole hand: I pass `pass`, everyone else and all play follow `policy`.
 *  Returns my points for the hand. */
function playHand(hands, v, pass, policy) {
  const game = G.gameFromHands(hands, v.handNumber, v.scores);
  if (game.phase === 'passing') {
    for (let s = 0; s < 4; s++) G.submitPass(game, s, s === v.seat ? pass : policy.choosePass(G.view(game, s)));
  }
  playOut(game, policy);
  return game.handHistory[game.handHistory.length - 1][v.seat];
}
