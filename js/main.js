// The web app: the start screen, the table, and the overlays. It draws whatever table
// state it's given and turns taps into moves.

import * as G from './game.js';
import { SYMBOL, suitOf, rankLabel, isRed, label, sortHand, card, HEARTS, SPADES } from './cards.js';
import { newTableState, LocalHost, BOT_NAMES, PACE } from './table.js';
import { OnlineTable, onlineAvailable } from './online.js';
import { syncGame, pushName, accountPanel, accountLobby } from './account.js';
import { basicBot } from './bots.js';

const app = document.getElementById('app');
// The page's options as it was opened (the address changes to ?t=CODE once at a table).
// For checking the page: ?name=X, ?play, ?autoplay, ?fast, ?debug, ?newtable=CODE&startafter=N.
const params = new URLSearchParams(location.search);

// MARK: Remembered on this device

function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const settings = Object.assign({ name: '', back: 'red', highFirst: true, largePrint: false }, stored('hearts.settings', {}));
function saveSettings() {
  store('hearts.settings', settings);
  pushName(settings.name);
  document.body.classList.toggle('large-print', settings.largePrint);
}
saveSettings();

// The online table this browser last sat at, so the start screen can offer to go back.
const lastTable = {
  get: () => stored('hearts.table', null),
  set: (code) => store('hearts.table', code),
  clear: () => store('hearts.table', null),
};

// A game against the computer, saved after every move so a reload doesn't lose it.
const savedGame = {
  get: () => { const s = stored('hearts.local', null); return s && s.game && s.game.phase !== 'gameOver' ? s : null; },
  set: (s) => store('hearts.local', s),
};

const myName = () => settings.name || 'Player';

// MARK: Helpers

/** Names come from other people's browsers: never let them be read as HTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

function button(text, cls, onclick) {
  const b = el('button', cls);
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function cardEl(c) {
  const e = el('div', 'card' + (isRed(c) ? ' red' : ''));
  e.innerHTML = `<div class="corner"><span class="r">${rankLabel(c)}</span><span class="s">${SYMBOL[suitOf(c)]}</span></div><div class="pip">${SYMBOL[suitOf(c)]}</div>`;
  e.setAttribute('aria-label', label(c));
  return e;
}

function backEl() {
  const e = el('div', 'back');
  const inner = el('div');
  inner.style.backgroundImage = `url(img/back_${settings.back}.jpg)`;
  e.appendChild(inner);
  return e;
}

/** A dialog over the page. `title` and a string `body` are HTML; Escape or a tap
 *  outside calls `dismiss`, when there is one. */
function dialog(title, body, buttons, dismiss) {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  if (title) p.appendChild(el('h2', '', title));
  if (typeof body === 'string') p.appendChild(el('p', '', body));
  else if (body) p.appendChild(body);
  if (buttons && buttons.length) { const row = el('div', 'buttons'); row.append(...buttons); p.appendChild(row); }
  o.appendChild(p);
  if (dismiss) {
    o.dataset.dismiss = '';
    o.dismiss = dismiss;
    o.onclick = (e) => { if (e.target === o) dismiss(); };
  }
  return o;
}

/** A dialog of its own (the menu, settings, a question) that stays on top while the
 *  table redraws under it. `buttons` are [text, class, action]; each one closes it. */
function popup(title, body, buttons, onDismiss) {
  const o = dialog(title, body, buttons.map(([text, cls, then]) => button(text, cls, () => { o.remove(); then?.(); })),
    () => { o.remove(); onDismiss?.(); });
  o.classList.add('popup');
  app.appendChild(o);
  return o;
}

const message = (html, then) => popup('', html, [['OK', 'primary', then]], then);
const confirmThen = (title, html, yes, onYes) => popup(title, html, [['Cancel', ''], [yes, 'primary', onYes]]);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') [...document.querySelectorAll('.overlay[data-dismiss]')].pop()?.dismiss();
});

// MARK: Start screen

let host = null;      // LocalHost or OnlineTable
let state = null;     // The table state being shown.
const ui = {
  mySeat: 0,
  picked: new Set(),     // Cards chosen to pass.
  pendingPlay: null,     // A card tapped once (tap again to play).
  sentPass: null,        // { hand, cards } from tapping Pass until the host has it.
  showSheet: false,
  shown: { key: '', count: 0 },   // Trick cards already drawn (new ones slide in).
  overlayKey: null,      // The overlay drawn last time (it doesn't fade in again).
};

function resetUI() {
  ui.picked.clear(); ui.pendingPlay = null; ui.sentPass = null; ui.showSheet = false; ui.shown = { key: '', count: 0 }; ui.overlayKey = null;
}

function leaveTable() {
  // Mid-game, keep the code: the others wait, and Back to Table brings me back.
  const midGame = host instanceof OnlineTable && host.started && state && state.game.phase !== 'gameOver';
  if (host instanceof OnlineTable && !midGame) lastTable.clear();
  showLobby();
}

function showLobby() {
  host?.stop(); host = null; state = null;
  if (location.search) history.replaceState(null, '', location.pathname);
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Hearts'));
  lobby.appendChild(el('div', 'tag', 'Shoot the moon · dodge the queen'));
  const fan = el('div', 'fan');
  [card(HEARTS, 14), card(SPADES, 12), card(HEARTS, 13), card(HEARTS, 10), card(HEARTS, 2)].forEach((c, i) => {
    const e = cardEl(c);
    e.style.transform = `translateX(-50%) rotate(${(i - 2) * 9}deg)`;
    fan.appendChild(e);
  });
  lobby.appendChild(fan);

  const name = el('div', 'name', 'Playing as ');
  name.appendChild(button(settings.name || 'You', 'link', () => askName(showLobby)));
  lobby.appendChild(name);
  lobby.appendChild(accountLobby());          // Sign in with Google (or who's signed in).

  const code = onlineAvailable() && lastTable.get();
  if (code) lobby.appendChild(button(`Back to Table ${code}`, 'big-button primary', () => joinTable(code)));

  const saved = savedGame.get();
  if (saved) lobby.appendChild(button(`Continue Game · Hand ${saved.game.handNumber + 1}`, 'big-button primary', () => playComputer(saved)));
  lobby.appendChild(button(saved ? 'New Game vs the Computer' : 'Play the Computer', 'big-button', () => playComputer()));

  const friends = button('Play with Friends', 'big-button', showFriends);
  friends.disabled = !onlineAvailable();
  lobby.appendChild(friends);

  const links = el('div', 'links');
  links.appendChild(button('Settings', 'link', () => showSettings(showLobby)));
  lobby.appendChild(links);
  app.appendChild(lobby);
  if (!settings.name) askName(showLobby);
}

function askName(then) {
  const input = el('input', 'text');
  input.maxLength = 16; input.value = settings.name; input.placeholder = 'Your name'; input.autocomplete = 'nickname';
  const save = () => {
    const name = input.value.trim().slice(0, 16);
    if (!name) { input.focus(); return; }
    settings.name = name; saveSettings(); o.remove(); then?.();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  const o = dialog('Your name?', input, [button('OK', 'primary', save)], settings.name ? () => o.remove() : null);
  o.classList.add('popup');
  app.appendChild(o);
  input.focus();
}

function playComputer(saved = null) {
  let s = saved;
  if (!s) {
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const seats = [{ kind: 'person', name: settings.name || 'You' }, ...[0, 1, 2].map((i) => ({ kind: 'bot', name: names[i] }))];
    if (params.has('autoplay')) seats[0].kind = 'bot';     // Testing: bots in every seat.
    s = newTableState(seats);
  }
  ui.mySeat = 0;
  resetUI();
  const keep = !params.has('autoplay');
  host = new LocalHost(s, (next) => {
    state = next;
    if (keep) savedGame.set(next.game.phase === 'gameOver' ? null : next);
    render();
  });
}

// MARK: Playing with friends

function showFriends() {
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Hearts'));
  lobby.appendChild(el('div', 'tag', 'Play with friends'));
  lobby.appendChild(button('Start a Table', 'big-button primary', () => withTable(OnlineTable.create(myName(), onTableUpdate))));
  lobby.appendChild(el('div', 'note', 'or join with a code'));
  const row = el('div', 'row');
  const input = el('input', 'code');
  input.maxLength = 4; input.placeholder = 'CODE'; input.autocapitalize = 'characters'; input.autocomplete = 'off'; input.spellcheck = false;
  const join = button('Join', 'primary', () => { if (input.value.trim().length === 4) joinTable(input.value.trim()); else input.focus(); });
  input.onkeydown = (e) => { if (e.key === 'Enter') join.onclick(); };
  row.append(input, join);
  lobby.appendChild(row);
  lobby.appendChild(el('div', 'note', 'Bots fill any empty seats when the game starts. If someone drops, the game waits until they’re back — they reopen the link, or tap Back to Table on the start screen.'));
  lobby.appendChild(button('Back', '', showLobby));
  app.appendChild(lobby);
}

const joinTable = (code) => withTable(OnlineTable.join(code, myName(), onTableUpdate));

async function withTable(promise) {
  app.innerHTML = '<div class="lobby"><div class="tag">Connecting…</div></div>';
  resetUI();
  try {
    host = await promise;
    lastTable.set(host.code);
    history.replaceState(null, '', `${location.pathname}?t=${host.code}`);
    onTableUpdate();
  } catch (e) {
    const text = (e && e.message) || String(e);
    if (/no table|already started|full/i.test(text)) lastTable.clear();
    showFriends();
    message(esc(text));
  }
}

function onTableUpdate() {
  if (!(host instanceof OnlineTable)) return;
  ui.mySeat = Math.max(0, host.mySeat);
  if (host.started && host.state) { state = host.state; render(); testAutoplay(); } else waitingRoom();
}

// Testing online: ?autoplay makes this browser play its own seat with the basic bot, and
// ?startafter=N (host) starts the table once N people are seated.
let autoTimer = null;
function testAutoplay() {
  if (!params.has('autoplay') || !state) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    const g = state.game, me = ui.mySeat;
    if (state.paused) return;
    if (g.phase === 'passing' && !G.hasPassed(g, me)) host.send({ type: 'pass', seat: me, cards: basicBot.choosePass(G.view(g, me)) });
    else if (g.phase === 'playing' && G.turn(g) === me) host.send({ type: 'play', seat: me, card: basicBot.choosePlay(G.view(g, me)) });
    else if (g.phase === 'moonChoice' && g.moonShooter === me) host.send({ type: 'moon', seat: me, down: false });
    else if (g.phase === 'handComplete' && !state.continued.includes(me)) host.send({ type: 'continue', seat: me });
    document.title = `Hearts ${g.phase} hand ${g.handNumber + 1} scores ${g.scores.join(',')}`;
  }, 150);
}

function waitingRoom() {
  const t = host;
  const want = Number(params.get('startafter') || 0);
  if (want && t.isHost && t.seats.filter((x) => x.kind === 'person').length >= want) { t.start(); return; }
  state = null;
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('div', 'tag', 'Table code'));
  lobby.appendChild(el('h1', 'table-code', t.code));
  const link = `${location.origin}${location.pathname}?t=${t.code}`;
  const share = button('Send the Link', 'primary', async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Hearts', text: `Join my Hearts table: ${t.code}`, url: link }); } catch {} return; }
    try { await navigator.clipboard.writeText(link); share.textContent = 'Link Copied'; } catch { share.textContent = link; }
  });
  lobby.appendChild(share);
  const list = el('div', 'seats-list');
  t.seats.forEach((seat, i) => {
    const row = el('div', 'seat-row');
    if (seat.kind === 'open') row.innerHTML = `<span class="n">${i + 1}</span><i>Open — a bot sits here if nobody joins</i>`;
    else row.innerHTML = `<span class="n">${i + 1}</span><b>${esc(seat.name)}</b>${seat.uid === t.uid ? '<span class="you">you</span>' : ''}<span class="dot ${t.presence[seat.uid] ? 'on' : ''}"></span>`;
    list.appendChild(row);
  });
  lobby.appendChild(list);
  if (t.isHost) {
    const open = t.seats.filter((s) => s.kind === 'open').length;
    lobby.appendChild(button(open ? `Start — bots take ${open} seat${open === 1 ? '' : 's'}` : 'Start the Game', 'big-button primary', () => t.start()));
  } else {
    const hostSeat = t.seats.find((s) => s.uid === t.meta?.hostUid);
    lobby.appendChild(el('div', 'note', `Waiting for ${hostSeat ? esc(hostSeat.name) : 'the host'} to start…`));
  }
  lobby.appendChild(button('Leave', '', leaveTable));
  app.appendChild(lobby);
}

// MARK: The table

const seatAt = (offset) => (ui.mySeat + offset) % 4;     // 0 me (bottom), 1 left, 2 top, 3 right.
const offsetOf = (seat) => (seat - ui.mySeat + 4) % 4;
const nameOf = (seat) => esc(state.seats[seat].name);
const handPointsText = (seat) => (state.game.handPoints[seat] ? `+${state.game.handPoints[seat]}` : '');

function render() {
  if (!state) return;
  const g = state.game;
  const me = ui.mySeat;
  if (ui.sentPass && (g.phase !== 'passing' || G.hasPassed(g, me) || ui.sentPass.hand !== g.handNumber)) ui.sentPass = null;
  if (ui.pendingPlay !== null && !G.legalPlays(g, me).includes(ui.pendingPlay)) ui.pendingPlay = null;
  if (g.phase !== 'passing') ui.picked.clear();
  // The table and its overlays are redrawn in one piece; dialogs opened on top of them
  // (the menu, settings) are left alone, so they don't flicker as the bots play.
  const screen = el('div', 'screen');
  const table = el('div', 'table');
  if (host instanceof OnlineTable && !host.connected) table.appendChild(el('div', 'banner', 'Connection lost — reconnecting…'));

  // Top bar.
  const top = el('div', 'topbar');
  const dir = G.passDirection(g);
  top.appendChild(el('div', '', `<div class="hand">Hand ${g.handNumber + 1}</div><div class="sub">${dir === 'none' ? 'No pass' : 'Pass ' + dir}${g.heartsBroken ? ' · Hearts broken' : ''}</div>`));
  const menu = button('•••', 'menu', showMenu);
  menu.setAttribute('aria-label', 'Menu');
  top.appendChild(menu);
  table.appendChild(top);

  // The other three players and the trick.
  const middle = el('div', 'middle');
  const positions = [null, 'west', 'north', 'east'];
  const winner = g.phase === 'trickComplete' ? G.winningPlay(g.trick).seat : null;
  for (const offset of [2, 1, 3]) {
    const s = seatAt(offset);
    const seat = el('div', `seat ${positions[offset]}${G.turn(g) === s ? ' turn' : ''}`);
    const stack = el('div', 'stack');
    for (let i = 0; i < Math.min(g.hands[s].length, 3); i++) stack.appendChild(backEl());
    seat.appendChild(stack);
    seat.appendChild(el('div', 'plate', `<div class="name">${nameOf(s)}</div><div class="score">${g.scores[s]}</div><div class="hp">${handPointsText(s)}</div>`));
    if (g.phase === 'passing' && dir !== 'none') seat.appendChild(el('div', 'status pill' + (G.hasPassed(g, s) ? '' : ' waiting'), G.hasPassed(g, s) ? 'Passed' : 'Choosing…'));
    const uid = host instanceof OnlineTable && state.seats[s].kind === 'person' && host.seats[s]?.uid;
    if (uid && !host.presence[uid]) seat.appendChild(el('div', 'status pill away', 'Away'));
    middle.appendChild(seat);
  }
  middle.appendChild(trickEl(winner));
  table.appendChild(middle);

  // Status and buttons.
  const controls = el('div', 'controls');
  controls.appendChild(el('div', 'status-line', statusText()));
  if (g.phase === 'passing' && !G.hasPassed(g, me) && !ui.sentPass) {
    const b = button('Pass ' + dir, 'primary', () => {
      ui.sentPass = { hand: g.handNumber, cards: [...ui.picked] };
      ui.picked.clear();
      render();
      host.send({ type: 'pass', seat: me, cards: ui.sentPass.cards });
    });
    b.disabled = ui.picked.size !== 3;
    controls.appendChild(b);
  }
  if (g.phase === 'playing' && G.turn(g) === me && ui.pendingPlay !== null) {
    controls.appendChild(button('Play ' + label(ui.pendingPlay), 'primary', playPicked));
  }
  table.appendChild(controls);
  table.appendChild(el('div', 'me-line' + (G.turn(g) === me ? ' turn' : ''),
    `<span class="pill">${nameOf(me)} <b>${g.scores[me]}</b> <span class="hp">${handPointsText(me)}</span></span>`));

  // My hand.
  table.appendChild(handRow());
  screen.appendChild(table);
  const old = app.querySelector(':scope > .screen');
  if (old) old.replaceWith(screen);
  else { app.innerHTML = ''; app.appendChild(screen); }
  if (params.has('debug')) {
    document.body.dataset.rects = JSON.stringify([...document.querySelectorAll('.table, .topbar, .middle, .seat, .trick, .controls, .me-line, .handrow, .handrow .card')]
      .map((e) => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
  }

  // Overlays. The same one as last time doesn't fade in again.
  let overlay = null, key = null;
  if (state.paused && state.paused.seat !== me) { overlay = pausedPanel(); key = 'paused'; }
  else if (g.phase === 'moonChoice' && g.moonShooter === me) { overlay = moonPanel(); key = 'moon'; }
  else if (g.phase === 'handComplete' || g.phase === 'gameOver') { overlay = handPanel(); key = `hand:${g.handNumber}:${g.phase}`; }
  else if (ui.showSheet) { overlay = sheetPanel(); key = 'sheet'; }
  if (overlay) {
    if (key === ui.overlayKey) overlay.classList.add('still');
    screen.appendChild(overlay);
  }
  ui.overlayKey = key;
}

/** The cards in the middle. New ones slide in from whoever played them; a finished
 *  trick slides off to its winner. */
function trickEl(winner) {
  const g = state.game;
  const trick = el('div', 'trick');
  const plays = g.phase === 'playing' || g.phase === 'trickComplete' ? g.trick.plays : [];
  const key = `${g.handNumber}:${g.completedTricks.length}`;
  const seen = ui.shown.key === key ? ui.shown.count : 0;
  plays.forEach((p, i) => {
    const c = cardEl(p.card);
    c.classList.add('p' + offsetOf(p.seat));
    if (i >= seen) c.classList.add('enter');
    if (p.seat === winner) c.classList.add('winner');
    trick.appendChild(c);
  });
  ui.shown = { key, count: plays.length };
  // While choosing, point at the player the cards go to.
  const to = G.passTarget(g, ui.mySeat);
  if (g.phase === 'passing' && to !== null && !G.hasPassed(g, ui.mySeat) && !ui.sentPass) {
    const arrow = ['', '←', '↑', '→'][offsetOf(to)];
    trick.appendChild(el('div', 'pass-hint', offsetOf(to) === 3 ? `Passing to ${nameOf(to)} ${arrow}` : `${arrow} Passing to ${nameOf(to)}`));
  }
  if (winner !== null && !params.has('fast')) trick.classList.add('collect', 'to-' + offsetOf(winner));
  return trick;
}

function statusText() {
  const g = state.game, me = ui.mySeat;
  switch (g.phase) {
    case 'passing': {
      if (G.hasPassed(g, me) || ui.sentPass) {
        if (!G.hasPassed(g, me)) return 'Passing…';
        const waiting = [0, 1, 2, 3].filter((s) => s !== me && !G.hasPassed(g, s)).map(nameOf);
        return waiting.length ? `Passed — waiting for ${waiting.join(' & ')}…` : 'Passed';
      }
      const left = 3 - ui.picked.size;
      return left ? `Choose ${left} card${left === 1 ? '' : 's'} to pass ${G.passDirection(g)}` : 'Ready to pass';
    }
    case 'playing': {
      const t = G.turn(g);
      let text;
      if (t !== me) text = `${nameOf(t)}’s turn`;
      else if (ui.pendingPlay !== null) text = 'Tap it again to play it';
      else if (g.completedTricks.length === 0 && g.trick.plays.length === 0) text = 'You lead the 2♣';
      else text = g.trick.plays.length ? 'Your play' : 'Your lead';
      const got = g.completedTricks.length === 0 && g.receivedCards[me].length;
      return got ? `<span class="got">${receivedFrom()}</span> ${text}` : text;
    }
    case 'trickComplete': {
      const w = G.winningPlay(g.trick).seat;
      const pts = G.trickPoints(g.trick);
      const what = pts ? ` (${pts} point${pts === 1 ? '' : 's'})` : '';
      return w === me ? `You take the trick${what}` : `${nameOf(w)} takes the trick${what}`;
    }
    case 'moonChoice': return g.moonShooter === me ? '' : `${nameOf(g.moonShooter)} shot the moon!`;
    default: return '';
  }
}

/** "From Mac: Q♠ 9♥ 2♦" — the cards passed to me this hand. */
function receivedFrom() {
  const g = state.game, me = ui.mySeat;
  const from = [0, 1, 2, 3].find((s) => G.passTarget(g, s) === me);
  return `From ${nameOf(from)}: ${g.receivedCards[me].map(label).join(' ')}`;
}

function handRow() {
  const g = state.game, me = ui.mySeat;
  const row = el('div', 'handrow');
  const hand = sortHand(g.hands[me], settings.highFirst);
  const legal = new Set(G.legalPlays(g, me));
  const myTurn = g.phase === 'playing' && G.turn(g) === me;
  const choosing = g.phase === 'passing' && !G.hasPassed(g, me) && !ui.sentPass;
  // Overlap the cards just enough to fit the screen.
  const cardW = measuredCardWidth();
  const width = Math.min(document.documentElement.clientWidth - 24, 1000);
  const natural = cardW + 4;
  const step = hand.length > 1 ? Math.min(natural, (width - cardW) / (hand.length - 1)) : natural;
  row.style.setProperty('--overlap', `${step - cardW}px`);
  const sent = ui.sentPass ? ui.sentPass.cards : (g.phase === 'passing' && g.pendingPasses[me]) || [];
  const received = g.phase === 'playing' && g.completedTricks.length === 0 ? g.receivedCards[me] : [];
  for (const c of hand) {
    const e = cardEl(c);
    if (sent.includes(c)) e.classList.add('sent');
    if (received.includes(c)) e.classList.add('received');
    if (choosing) e.classList.add(ui.picked.has(c) ? 'picked' : 'choosable');
    if (myTurn && c === ui.pendingPlay) e.classList.add('picked');
    else if (myTurn && legal.has(c)) e.classList.add('playable');
    else if (myTurn) e.classList.add('dim');
    e.onclick = () => tapCard(c);
    row.appendChild(e);
  }
  return row;
}

/** The real width of a card on this screen (the CSS sizes it to the window). */
function measuredCardWidth() {
  const probe = cardEl(card(HEARTS, 2));
  probe.style.position = 'absolute'; probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width || 80;
  probe.remove();
  return w;
}

function tapCard(c) {
  const g = state.game, me = ui.mySeat;
  if (state.paused) return;
  if (g.phase === 'passing' && !G.hasPassed(g, me) && !ui.sentPass) {
    if (ui.picked.has(c)) ui.picked.delete(c);
    else if (ui.picked.size < 3) ui.picked.add(c);
    render();
    return;
  }
  if (g.phase === 'playing' && G.turn(g) === me) {
    if (!G.legalPlays(g, me).includes(c)) return;
    if (ui.pendingPlay === c) playPicked();
    else { ui.pendingPlay = c; render(); }
  }
}

function playPicked() {
  const c = ui.pendingPlay;
  ui.pendingPlay = null;
  host.send({ type: 'play', seat: ui.mySeat, card: c });
}

// MARK: Overlays drawn with the table

function scoreTable() {
  const g = state.game;
  const t = el('table');
  const order = [0, 1, 2, 3].map(seatAt);
  t.appendChild(el('tr', '', '<th>Hand</th>' + order.map((s) => `<th>${nameOf(s)}</th>`).join('')));
  g.handHistory.forEach((changes, i) => {
    t.appendChild(el('tr', '', `<td>${i + 1}</td>` + order.map((s) => `<td>${changes[s]}</td>`).join('')));
  });
  const best = Math.min(...g.scores);
  t.appendChild(el('tr', 'total', '<td>Total</td>' + order.map((s) => `<td class="${g.scores[s] === best ? 'best' : ''}">${g.scores[s]}</td>`).join('')));
  return t;
}

function handPanel() {
  const g = state.game, me = ui.mySeat;
  let title;
  if (g.phase === 'gameOver') {
    const winners = G.leaders(g);
    if (winners.includes(me)) title = winners.length > 1 ? 'You tie for the win!' : 'You win!';
    else title = `${winners.map(nameOf).join(' & ')} win${winners.length > 1 ? '' : 's'}`;
  } else {
    const shooter = g.moonShooter;
    title = shooter !== null ? `${shooter === me ? 'You' : nameOf(shooter)} shot the moon!` : `End of Hand ${g.handNumber + 1}`;
  }
  const buttons = [];
  if (g.phase === 'gameOver') {
    buttons.push(button('Play Again', 'primary', () => host.send({ type: 'newGame' })), button('Leave', '', leaveTable));
  } else if (state.continued.includes(me)) {
    const waiting = [0, 1, 2, 3].filter((s) => state.seats[s].kind === 'person' && !state.continued.includes(s)).map(nameOf);
    buttons.push(el('div', 'pill', `Waiting for ${waiting.join(' & ') || 'the others'}…`));
  } else {
    buttons.push(button('Next Hand', 'primary', () => host.send({ type: 'continue', seat: me })));
  }
  return dialog(title, scoreTable(), buttons);
}

function moonPanel() {
  return dialog('You shot the moon!', 'Add 26 to everyone else, or take 26 off your own score?', [
    button('Everyone Else +26', 'primary', () => host.send({ type: 'moon', seat: ui.mySeat, down: false })),
    button('Me −26', '', () => host.send({ type: 'moon', seat: ui.mySeat, down: true })),
  ]);
}

function sheetPanel() {
  const close = () => { ui.showSheet = false; render(); };
  return dialog('Score Sheet', scoreTable(), [button('Close', 'primary', close)], close);
}

function pausedPanel() {
  const away = state.paused;
  const body = el('div');
  body.appendChild(el('p', '', `Waiting for <b>${esc(away.name)}</b> to come back… They reopen the link, or tap Back to Table on the start screen.`));
  const buttons = [];
  if (host instanceof OnlineTable && host.isHost) {
    buttons.push(button(`Let a Bot Play for ${away.name}`, 'primary', () => host.send({ type: 'standIn', away: away.seat })));
    body.appendChild(el('div', 'note', 'They get their seat back as soon as they return.'));
  }
  buttons.push(button('Leave', '', leaveTable));
  return dialog('Paused', body, buttons);
}

// MARK: Dialogs on top of the table

function showMenu() {
  const online = host instanceof OnlineTable;
  popup('Menu', null, [
    ['Score Sheet', '', () => { ui.showSheet = true; render(); }],
    ['Settings', '', () => showSettings(render)],
    ['New Game', '', () => confirmThen('New Game?', online ? 'This starts the game over for everyone at the table.' : 'This game’s scores will be lost.', 'New Game', () => host.send({ type: 'newGame' }))],
    ['Leave', '', () => {
      if (online && state.game.phase !== 'gameOver') confirmThen('Leave the Table?', 'The game waits for you (or the host lets a bot play). Come back with Back to Table on the start screen.', 'Leave', leaveTable);
      else leaveTable();
    }],
    ['Close', 'primary'],
  ]);
}

function showSettings(after) {
  const form = el('div', 'settings');
  form.innerHTML = `
    <label class="name-setting">Your name <input class="text" id="name" maxlength="16" autocomplete="nickname"></label>
    <label>Card back <select id="back">${['red', 'green', 'blue', 'black'].map((c) => `<option value="${c}" ${settings.back === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></label>
    <label>Highest card on the left <input type="checkbox" id="high" ${settings.highFirst ? 'checked' : ''}></label>
    <label>Large card letters <input type="checkbox" id="large" ${settings.largePrint ? 'checked' : ''}></label>`;
  form.querySelector('#name').value = settings.name;
  // Seated at a table, the name is already taken; change it from the start screen.
  if (state) form.querySelector('.name-setting').remove();
  const done = () => {
    const name = form.querySelector('#name')?.value.trim().slice(0, 16);
    if (name) settings.name = name;
    settings.back = form.querySelector('#back').value;
    settings.highFirst = form.querySelector('#high').checked;
    settings.largePrint = form.querySelector('#large').checked;
    saveSettings();
    after?.();
  };
  if (!state) form.appendChild(accountPanel(button));     // Not at a table: it could change who holds the seat.
  popup('Settings', form, [['Done', 'primary', done]], done);     // Closing any way keeps the changes.
}

// MARK: Start

let resizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });

// Signed in with Google (any of the family games): the name and statistics follow the account.
syncGame({
  id: 'hearts',
  name: () => settings.name,
  setName: (n) => {
    settings.name = n; saveSettings();
    for (const b of document.querySelectorAll('.lobby .name button')) b.textContent = n;
  },
});
if (params.get('name')) { settings.name = params.get('name').slice(0, 16); saveSettings(); }
if (params.has('fast')) { PACE.play = 30; PACE.trickLinger = 60; PACE.pass = 30; }
const tableCode = params.get('t') || params.get('newtable');
if (tableCode && onlineAvailable()) {
  const go = () => (params.get('newtable') ? withTable(OnlineTable.create(myName(), onTableUpdate, tableCode)) : joinTable(tableCode));
  // Someone opening a shared link for the first time: their name before their seat.
  if (settings.name) go(); else askName(go);
} else if (params.has('play') || params.has('autoplay')) playComputer();
else showLobby();
