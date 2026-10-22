# Hearts for the web

Plain JavaScript (ES modules, no build step, no Node needed) so it runs from any static
host. Started 2026-10-22 for Louie: family and friends play together in a browser; bots
fill empty seats.

## Layout
- `js/cards.js` — cards as ints (suit*100+rank; ♣ ♦ ♠ ♥ display order), deck, sorting
  (highest on the left by default).
- `js/game.js` — the full rules, ported from the iPhone app's `HeartsGame` (pass
  left/right/across/none, 2♣ leads, no points on trick 1, hearts broken, Q♠ 13, moon
  up/down — people choose, bots go down only if up loses, game to 100). Plain JSON state.
- `js/bots.js` — Stage 1 bot = the app's BasicStrategy. Stage 2: port `RuleStrategy`
  (Louie's rules, ~2000 lines incl. look-ahead) and benchmark against the app.
- `js/table.js` — table state (game + seats + continued + paused), `applyMove`,
  `nextHostStep` (bots and pacing), `LocalHost` (play the computer on this device).
- `js/online.js` — Firebase Realtime Database + anonymous auth (free Spark plan). Table at
  `/tables/CODE`: meta{hostUid,started}, seats, state (JSON string, host writes), moves
  (people push, host applies), presence (onDisconnect). Host's browser runs the bots;
  if the host drops, the first present person takes over (meta.hostUid transaction). A
  dropped person pauses the game with no time limit (Louie); host may "Let a bot play for
  them"; returning (same browser = same anonymous uid) gives the seat back.
- `js/firebase-config.js` — Louie's project `hearts-659fc` (Spark plan; anonymous auth on;
  Realtime Database us-central1, rules from `database.rules.json` published 2026-10-22).
- `js/main.js` — screens: lobby, friends (start/join), waiting room (code + share link),
  table, score sheet, moon choice, paused, settings (card back, highest-on-left, large print).
- `img/` — felt and card backs from the iPhone apps.

## Test
- Engine: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/engine.test.js`
- Page: `python3 -m http.server 8765 --bind 127.0.0.1`, then headless Chrome with its own
  profile (`--user-data-dir=<scratch>`; never Louie's) — note headless windows are at least
  500 px wide, so check phone sizes in the iPhone simulator's Safari
  (`xcrun simctl openurl "iPhone 17 Pro" http://127.0.0.1:8765/`).
  URL options: `?name=X`, `?play`, `?autoplay` (bots play every seat, incl. yours online),
  `?fast`, `?debug`, `?newtable=CODE&startafter=N` (host a table with a set code; start
  once N people sit). Headless Chrome's snapshot timing breaks Firebase tests — test online
  with two simulators' Safari (iPhone hosts, iPad joins; `simctl terminate … mobilesafari`
  to drop a player). Verified 2026-10-22: join, full game, guest drop → pause → rejoin,
  host drop → takeover + pause → rejoin. Delete TZ* test tables afterwards.

## Not done yet
- Deploy (Firebase Hosting needs the firebase CLI → Node, not installed; or any static
  host such as GitHub Pages).
- Stage 2 bots; Stage 3 polish.
