// The web app: the start screen, the table, and the overlays. It draws whatever table
// state it's given and turns taps into moves.

import * as G from './game.js';
import { SYMBOL, suitOf, rankLabel, isRed, label, sortHand, QUEEN_OF_SPADES, FULL_DECK, card, HEARTS, SPADES } from './cards.js';
import { newTableState, LocalHost, BOT_NAMES, peopleSeats, PACE } from './table.js';
import { OnlineTable, onlineAvailable } from './online.js';
import { basicBot } from './bots.js';

const app = document.getElementById('app');
// The page's options as it was opened (the address changes to ?t=CODE once at a table).
const startParams = new URLSearchParams(location.search);

// MARK: Settings (remembered on this device)

const settings = Object.assign({ name: '', back: 'red', highFirst: true, largePrint: false },
  JSON.parse(localStorage.getItem('hearts.settings') || '{}'));
function saveSettings() {
  localStorage.setItem('hearts.settings', JSON.stringify(settings));
  document.body.classList.toggle('large-print', settings.largePrint);
}
saveSettings();

// MARK: Helpers

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

function cardEl(c) {
  const e = el('div', 'card' + (isRed(c) ? ' red' : ''));
  e.innerHTML = `<div class="corner"><span class="r">${rankLabel(c)}</span><span class="s">${SYMBOL[suitOf(c)]}</span></div><div class="pip">${SYMBOL[suitOf(c)]}</div>`;
  e.setAttribute('aria-label', label(c));
  return e;
}

function backEl(width) {
  const e = el('div', 'back');
  if (width) e.style.setProperty('--w', width);
  const inner = el('div');
  inner.style.backgroundImage = `url(img/back_${settings.back}.jpg)`;
  e.appendChild(inner);
  return e;
}

// MARK: Start screen

let host = null;
let state = null;
const ui = { mySeat: 0, picked: new Set(), pendingPlay: null, showSheet: false, overlay: null, sentPass: null };

// The online table this browser last sat at, so the start screen can offer to go back.
const lastTable = {
  get: () => localStorage.getItem('hearts.table'),
  set: (code) => localStorage.setItem('hearts.table', code),
  clear: () => localStorage.removeItem('hearts.table'),
};

function leaveTable() { lastTable.clear(); showLobby(); }

function showLobby() {
  host?.stop(); host = null; state = null;
  if (location.search.includes('t=')) history.replaceState(null, '', location.pathname);
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Hearts'));
  lobby.appendChild(el('div', 'tag', 'Shoot the moon · dodge the queen'));
  const fan = el('div', 'fan');
  [card(HEARTS, 14), card(SPADES, 12), card(HEARTS, 13), card(HEARTS, 10), card(HEARTS, 2)].forEach((c, i) => {
    const e = cardEl(c); e.style.setProperty('--card-w', '58px');
    e.style.transform = `translateX(-50%) rotate(${(i - 2) * 10}deg)`; fan.appendChild(e);
  });
  lobby.appendChild(fan);

  const name = el('div', 'name', `Playing as <button>${settings.name || 'You'}</button>`);
  name.querySelector('button').onclick = () => askName(showLobby);
  lobby.appendChild(name);

  const code = onlineAvailable() && lastTable.get();
  if (code) {
    const back = el('button', 'big-button primary', `Back to Table ${code}`);
    back.onclick = () => withTable(OnlineTable.join(code, settings.name || 'Player', onTableUpdate));
    lobby.appendChild(back);
  }

  const play = el('button', 'big-button', 'Play the Computer');
  play.onclick = startComputerGame;
  lobby.appendChild(play);

  const friends = el('button', 'big-button', 'Play with Friends');
  friends.disabled = !onlineAvailable();
  friends.onclick = showFriends;
  lobby.appendChild(friends);
  if (!onlineAvailable()) lobby.appendChild(el('div', 'note', 'Playing with friends turns on once the free Firebase account is set up.'));

  const links = el('div', 'links');
  const set = el('button', '', 'Settings'); set.onclick = () => showSettings(showLobby);
  links.appendChild(set);
  lobby.appendChild(links);
  app.appendChild(lobby);
  if (!settings.name) askName(showLobby);
}

function askName(then) {
  const name = prompt('Your name?', settings.name || '');
  if (name !== null && name.trim()) { settings.name = name.trim().slice(0, 16); saveSettings(); }
  then?.();
}

function startComputerGame() {
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  const seats = [{ kind: 'person', name: settings.name || 'You' }, ...[0, 1, 2].map((i) => ({ kind: 'bot', name: names[i] }))];
  if (startParams.has('autoplay')) seats[0].kind = 'bot';     // Testing: bots in every seat.
  ui.mySeat = 0;
  ui.picked.clear(); ui.pendingPlay = null; ui.showSheet = false;
  host = new LocalHost(newTableState(seats), (s) => { state = s; render(); });
}

// MARK: Playing with friends

function showFriends() {
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Hearts'));
  lobby.appendChild(el('div', 'tag', 'Play with friends'));
  const start = el('button', 'big-button', 'Start a Table');
  start.onclick = () => withTable(OnlineTable.create(settings.name || 'Player', onTableUpdate));
  lobby.appendChild(start);
  lobby.appendChild(el('div', 'note', 'or join with a code'));
  const row = el('div', 'row');
  const input = el('input'); input.maxLength = 4; input.placeholder = 'CODE'; input.autocapitalize = 'characters';
  const join = el('button', 'primary', 'Join');
  join.onclick = () => input.value.trim().length === 4 && withTable(OnlineTable.join(input.value.trim(), settings.name || 'Player', onTableUpdate));
  input.onkeydown = (e) => { if (e.key === 'Enter') join.onclick(); };
  row.append(input, join);
  lobby.appendChild(row);
  lobby.appendChild(el('div', 'note', 'Bots fill any empty seats when the game starts. If someone drops, the game pauses until they\'re back — they reopen the link, or tap Back to Table on the start screen.'));
  const back = el('button', '', 'Back'); back.onclick = showLobby;
  lobby.appendChild(back);
  app.appendChild(lobby);
}

async function withTable(promise) {
  app.innerHTML = '<div class="lobby"><div class="tag">Connecting…</div></div>';
  try {
    host = await promise;
    lastTable.set(host.code);
    history.replaceState(null, '', `${location.pathname}?t=${host.code}`);
    onTableUpdate();
  } catch (e) {
    alert(e.message || String(e));
    if (/no table|already started|full/i.test(e.message || '')) lastTable.clear();
    showFriends();
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
  if (!startParams.has('autoplay') || !state) return;
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
  const want = Number(startParams.get('startafter') || 0);
  if (want && t.isHost && t.seats.filter((x) => x.kind === 'person').length >= want) { t.start(); return; }
  state = null;
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('div', 'tag', 'Table code'));
  lobby.appendChild(el('h1', '', t.code));
  const link = `${location.origin}${location.pathname}?t=${t.code}`;
  const share = el('button', 'primary', 'Send the link');
  share.onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Hearts', text: `Join my Hearts table: ${t.code}`, url: link }); } catch {} }
    else { await navigator.clipboard?.writeText(link); share.textContent = 'Link copied'; }
  };
  lobby.appendChild(share);
  const list = el('div', 'panel');
  list.style.width = '100%';
  t.seats.forEach((seat, i) => {
    const here = seat.kind === 'person' ? `<span class="dot ${t.presence[seat.uid] ? 'on' : ''}"></span>` : '';
    list.appendChild(el('div', '', seat.kind === 'open' ? `Seat ${i + 1}: <i>open — a bot sits here if nobody joins</i>` : `Seat ${i + 1}: <b>${seat.name}</b> ${here}`));
  });
  lobby.appendChild(list);
  if (t.isHost) {
    const open = t.seats.filter((s) => s.kind === 'open').length;
    const go = el('button', 'big-button', open ? `Start — bots take ${open} seat${open === 1 ? '' : 's'}` : 'Start the Game');
    go.onclick = () => t.start();
    lobby.appendChild(go);
  } else {
    const hostSeat = t.seats.find((s) => s.uid === t.meta?.hostUid);
    lobby.appendChild(el('div', 'note', `Waiting for ${hostSeat ? hostSeat.name : 'the host'} to start…`));
  }
  const leave = el('button', '', 'Leave'); leave.onclick = leaveTable;
  lobby.appendChild(leave);
  app.appendChild(lobby);
}

function pausedPanel() {
  const p0 = state.paused;
  const o = el('div', 'overlay'), p = el('div', 'panel');
  p.appendChild(el('h2', '', 'Paused'));
  p.appendChild(el('p', '', `Waiting for <b>${p0.name}</b> to reconnect… They reopen the link, or tap Back to Table on the start screen.`));
  if (host instanceof OnlineTable && host.isHost) {
    const buttons = el('div', 'buttons');
    const bot = el('button', '', `Let a bot play for ${p0.name}`);
    bot.onclick = () => host.send({ type: 'standIn', away: p0.seat });
    buttons.appendChild(bot); p.appendChild(buttons);
    p.appendChild(el('div', 'note', 'They get their seat back as soon as they return.'));
  }
  o.appendChild(p);
  return o;
}

// MARK: The table

const seatAt = (offset) => (ui.mySeat + offset) % 4;     // 0 me (bottom), 1 left, 2 top, 3 right.

function render() {
  if (!state) return;
  const g = state.game;
  const me = ui.mySeat;
  if (ui.sentPass && (g.phase !== 'passing' || G.hasPassed(g, me) || ui.sentPass.hand !== g.handNumber)) ui.sentPass = null;
  app.innerHTML = '';
  const table = el('div', 'table');
  if (host instanceof OnlineTable && !host.connected) table.appendChild(el('div', 'banner', 'Connection lost — reconnecting…'));

  // Top bar.
  const top = el('div', 'topbar');
  const dir = G.passDirection(g);
  top.appendChild(el('div', '', `<div class="hand">Hand ${g.handNumber + 1}</div><div class="sub">${dir === 'none' ? 'No pass' : 'Pass ' + dir}</div>`));
  const menu = el('button', '', '•••'); menu.setAttribute('aria-label', 'Menu');
  menu.onclick = showMenu;
  top.appendChild(menu);
  table.appendChild(top);

  // The other three players and the trick.
  const middle = el('div', 'middle');
  const positions = [null, 'west', 'north', 'east'];
  for (const offset of [2, 1, 3]) {
    const s = seatAt(offset);
    const seat = el('div', 'seat ' + positions[offset] + (G.turn(g) === s ? ' turn' : ''));
    const stack = el('div', 'stack');
    const count = Math.min(g.hands[s].length, 3);
    for (let i = 0; i < count; i++) {
      const b = backEl(); b.style.left = `${i * 6}px`; b.style.top = `${-i * 3 + 6}px`; stack.appendChild(b);
    }
    seat.appendChild(stack);
    seat.appendChild(el('div', 'name', state.seats[s].name));
    seat.appendChild(el('div', 'score', g.scores[s]));
    seat.appendChild(el('div', 'hp', '+' + g.handPoints[s]));
    if (g.phase === 'passing' && G.passDirection(g) !== 'none') seat.appendChild(el('div', 'status pill' + (G.hasPassed(g, s) ? '' : ' waiting'), G.hasPassed(g, s) ? 'Passed' : 'Choosing…'));
    middle.appendChild(seat);
  }
  const trick = el('div', 'trick');
  const plays = g.phase === 'playing' || g.phase === 'trickComplete' ? g.trick.plays : [];
  for (const p of plays) {
    const offset = (p.seat - me + 4) % 4;
    const c = cardEl(p.card); c.classList.add('p' + offset); trick.appendChild(c);
  }
  middle.appendChild(trick);
  table.appendChild(middle);

  // Status and buttons.
  const controls = el('div', 'controls');
  controls.appendChild(el('div', 'status-line', statusText()));
  if (g.phase === 'passing' && !G.hasPassed(g, me) && !ui.sentPass) {
    const b = el('button', 'primary', 'Pass ' + dir);
    b.disabled = ui.picked.size !== 3;
    b.onclick = () => {
      ui.sentPass = { hand: g.handNumber, cards: [...ui.picked] };
      ui.picked.clear();
      render();
      host.send({ type: 'pass', seat: me, cards: ui.sentPass.cards });
    };
    controls.appendChild(b);
  }
  if (g.phase === 'playing' && G.turn(g) === me && ui.pendingPlay !== null) {
    const b = el('button', 'primary', 'Play ' + label(ui.pendingPlay));
    b.onclick = () => playPicked();
    controls.appendChild(b);
  }
  table.appendChild(controls);
  table.appendChild(el('div', 'me-line', `<span class="pill">${state.seats[me].name} &nbsp; <b>${g.scores[me]}</b> &nbsp; +${g.handPoints[me]}</span>`));

  // My hand.
  table.appendChild(handRow());
  app.appendChild(table);
  if (new URLSearchParams(location.search).has('debug')) {
    document.body.dataset.rects = JSON.stringify([...document.querySelectorAll('.table, .topbar, .controls, .me-line, .handrow, .handrow .card, .middle')]
      .map((e) => [e.className, Math.round(e.getBoundingClientRect().x), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]));
  }

  // Overlays.
  if (state.paused && state.paused.seat !== me) app.appendChild(pausedPanel());
  else if (g.phase === 'moonChoice' && g.moonShooter === me) app.appendChild(moonPanel());
  else if (g.phase === 'handComplete' || g.phase === 'gameOver') app.appendChild(handPanel());
  else if (ui.showSheet) app.appendChild(sheetPanel());
}

function statusText() {
  const g = state.game, me = ui.mySeat;
  switch (g.phase) {
    case 'passing':
      if (G.hasPassed(g, me) || ui.sentPass) {
        const waiting = [0, 1, 2, 3].filter((s) => s !== me && !G.hasPassed(g, s)).map((s) => state.seats[s].name);
        if (!G.hasPassed(g, me)) return 'Passing…';
        return waiting.length ? `Passed — waiting for ${waiting.join(' & ')}…` : 'Passed';
      }
      return ui.picked.size < 3 ? `Choose ${3 - ui.picked.size} more card${3 - ui.picked.size === 1 ? '' : 's'} to pass ${G.passDirection(g)}` : 'Ready to pass';
    case 'playing': {
      const t = G.turn(g);
      const got = g.completedTricks.length === 0 && g.receivedCards[me].length ? receivedFrom() : '';
      if (t !== me) return got ? `${got} · ${state.seats[t].name}'s turn` : `${state.seats[t].name}'s turn`;
      if (got && g.trick.plays.length === 0 && !g.completedTricks.length && ui.pendingPlay === null) return `${got} · You lead the 2♣`;
      if (g.completedTricks.length === 0 && g.trick.plays.length === 0) return 'You lead the 2♣';
      return ui.pendingPlay !== null ? 'Tap it again to play it' : (g.trick.plays.length ? 'Your play' : 'Your lead');
    }
    case 'trickComplete': {
      const w = G.winningPlay(g.trick).seat;
      return w === me ? 'You take the trick' : `${state.seats[w].name} takes the trick`;
    }
    case 'moonChoice': return g.moonShooter === me ? '' : `${state.seats[g.moonShooter].name} shot the moon!`;
    default: return '';
  }
}

/** "From Mac: Q♠ 9♥ 2♦" — the cards passed to me this hand. */
function receivedFrom() {
  const g = state.game, me = ui.mySeat;
  const from = [0, 1, 2, 3].find((s) => G.passTarget(g, s) === me);
  return `From ${state.seats[from].name}: ${g.receivedCards[me].map(label).join(' ')}`;
}

function handRow() {
  const g = state.game, me = ui.mySeat;
  const row = el('div', 'handrow');
  const hand = sortHand(g.hands[me], settings.highFirst);
  const legal = new Set(G.legalPlays(g, me));
  const myTurn = g.phase === 'playing' && G.turn(g) === me;
  // Overlap the cards just enough to fit the screen.
  const cardW = measuredCardWidth();
  const width = Math.min(window.innerWidth - 24, 1000);
  const natural = cardW + 4;
  const step = hand.length > 1 ? Math.min(natural, (width - cardW) / (hand.length - 1)) : natural;
  row.style.setProperty('--overlap', `${step - cardW}px`);
  const sent = ui.sentPass ? ui.sentPass.cards : (g.phase === 'passing' && g.pendingPasses[me]) || [];
  const received = g.phase === 'playing' && g.completedTricks.length === 0 ? g.receivedCards[me] : [];
  for (const c of hand) {
    const e = cardEl(c);
    if (sent.includes(c)) e.classList.add('sent');
    if (received.includes(c)) e.classList.add('received');
    if (g.phase === 'passing' && ui.picked.has(c)) e.classList.add('picked');
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

// MARK: Overlays

function scoreTable() {
  const g = state.game;
  const t = el('table');
  const order = [0, 1, 2, 3].map(seatAt);
  t.appendChild(el('tr', '', '<th>Hand</th>' + order.map((s) => `<th>${state.seats[s].name}</th>`).join('')));
  g.handHistory.forEach((changes, i) => {
    t.appendChild(el('tr', '', `<td>${i + 1}</td>` + order.map((s) => `<td>${changes[s]}</td>`).join('')));
  });
  const totals = el('tr', 'total', '<td>Total</td>' + order.map((s) => `<td>${g.scores[s]}</td>`).join(''));
  t.appendChild(totals);
  return t;
}

function handPanel() {
  const g = state.game, me = ui.mySeat;
  const o = el('div', 'overlay'), p = el('div', 'panel');
  if (g.phase === 'gameOver') {
    const winners = G.leaders(g);
    p.appendChild(el('h2', '', winners.includes(me) ? 'You win!' : `${winners.map((s) => state.seats[s].name).join(' & ')} win${winners.length > 1 ? '' : 's'}`));
  } else {
    const shooter = g.moonShooter;
    p.appendChild(el('h2', '', shooter !== null ? `${shooter === me ? 'You' : state.seats[shooter].name} shot the moon!` : `Hand ${g.handNumber + 1}`));
  }
  p.appendChild(scoreTable());
  const buttons = el('div', 'buttons');
  if (g.phase === 'gameOver') {
    const again = el('button', 'primary', 'Play Again'); again.onclick = () => host.send({ type: 'newGame' }); buttons.appendChild(again);
    const leave = el('button', '', 'Leave'); leave.onclick = leaveTable; buttons.appendChild(leave);
  } else if (state.continued.includes(me)) {
    buttons.appendChild(el('div', 'pill', 'Waiting for the others…'));
  } else {
    const next = el('button', 'primary', 'Next Hand'); next.onclick = () => host.send({ type: 'continue', seat: me }); buttons.appendChild(next);
  }
  p.appendChild(buttons);
  o.appendChild(p);
  return o;
}

function moonPanel() {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  p.appendChild(el('h2', '', 'You shot the moon!'));
  p.appendChild(el('p', '', 'Add 26 to everyone else, or take 26 off your own score?'));
  const buttons = el('div', 'buttons');
  const up = el('button', 'primary', 'Everyone else +26'); up.onclick = () => host.send({ type: 'moon', seat: ui.mySeat, down: false });
  const down = el('button', '', 'Me −26'); down.onclick = () => host.send({ type: 'moon', seat: ui.mySeat, down: true });
  buttons.append(up, down);
  p.appendChild(buttons);
  o.appendChild(p);
  return o;
}

function sheetPanel() {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  p.appendChild(el('h2', '', 'Score Sheet'));
  p.appendChild(scoreTable());
  const buttons = el('div', 'buttons');
  const close = el('button', 'primary', 'Close'); close.onclick = () => { ui.showSheet = false; render(); };
  buttons.appendChild(close); p.appendChild(buttons); o.appendChild(p);
  o.onclick = (e) => { if (e.target === o) { ui.showSheet = false; render(); } };
  return o;
}

function showMenu() {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  p.appendChild(el('h2', '', 'Menu'));
  const buttons = el('div', 'buttons');
  const sheet = el('button', '', 'Score Sheet'); sheet.onclick = () => { o.remove(); ui.showSheet = true; render(); };
  const set = el('button', '', 'Settings'); set.onclick = () => { o.remove(); showSettings(render); };
  const newg = el('button', '', 'New Game'); newg.onclick = () => { o.remove(); host.send({ type: 'newGame' }); };
  const leave = el('button', '', 'Leave'); leave.onclick = () => { o.remove(); leaveTable(); };
  const close = el('button', 'primary', 'Close'); close.onclick = () => o.remove();
  buttons.append(sheet, set, newg, leave, close);
  p.appendChild(buttons); o.appendChild(p);
  o.onclick = (e) => { if (e.target === o) o.remove(); };
  app.appendChild(o);
}

function showSettings(after) {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  p.appendChild(el('h2', '', 'Settings'));
  const form = el('div', 'settings');
  form.innerHTML = `
    <label>Card back <select id="back">${['red', 'green', 'blue', 'black'].map((c) => `<option value="${c}" ${settings.back === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></label>
    <label>Highest card on left <input type="checkbox" id="high" ${settings.highFirst ? 'checked' : ''}></label>
    <label>Large card letters <input type="checkbox" id="large" ${settings.largePrint ? 'checked' : ''}></label>`;
  p.appendChild(form);
  const buttons = el('div', 'buttons');
  const done = el('button', 'primary', 'Done');
  done.onclick = () => {
    settings.back = form.querySelector('#back').value;
    settings.highFirst = form.querySelector('#high').checked;
    settings.largePrint = form.querySelector('#large').checked;
    saveSettings(); o.remove(); after?.();
  };
  buttons.appendChild(done); p.appendChild(buttons); o.appendChild(p);
  app.appendChild(o);
}

window.addEventListener('resize', () => render());
// For checking the page: ?name=Louie sets the name, ?play starts a game at once.
const params = new URLSearchParams(location.search);
if (params.get('name')) { settings.name = params.get('name'); saveSettings(); }
if (params.get('newtable') && onlineAvailable()) withTable(OnlineTable.create(settings.name || 'Player', onTableUpdate, params.get('newtable')));
else if (params.get('t') && onlineAvailable()) withTable(OnlineTable.join(params.get('t'), settings.name || 'Player', onTableUpdate));
else showLobby();
if (params.has('fast')) { PACE.play = 30; PACE.trickLinger = 60; PACE.pass = 30; }
if ((params.has('play') || params.has('autoplay')) && !params.get('t') && !params.get('newtable')) startComputerGame();
