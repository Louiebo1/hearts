// Checks js/rules.js (no look-aheads) against the app's decisions. See CLAUDE.md.
import { RuleBot } from '../../js/rules.js';
const bot = new RuleBot({ endgame: false, passLookAhead: false });
const lines = read((globalThis.scriptArgs || [])[0] || '/tmp/hearts_parity/positions.jsonl').split('\n').filter(Boolean);
let ok = 0, bad = { pass: 0, play: 0 }, shown = 0;
for (const line of lines) {
  const { kind, view, choice } = JSON.parse(line);
  const got = kind === 'pass' ? bot.choosePass(view) : [bot.choosePlay(view)];
  const same = got.length === choice.length && got.every((c) => choice.includes(c));
  if (same) ok++;
  else {
    bad[kind]++;
    if (shown++ < 6) print(kind, 'app', JSON.stringify(choice), 'js', JSON.stringify(got), JSON.stringify(view));
  }
}
print(`${ok} of ${lines.length} match; differ: pass ${bad.pass}, play ${bad.play}`);
