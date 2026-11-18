import test from "node:test";
import assert from "node:assert/strict";
import { parseAsk, askKey, notificationScript, waiting } from "../mods/asks/parse.js";

const claudePermission = `
 Bash command

   git push origin sc-37494-remove-phones

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for git push commands
   3. No, and tell Claude what to do differently (esc)
`;

const claudeQuestion = `
────────────────────────────────────────
 Earn rate basis?

 ❯ 1. Order subtotal (Recommended)
      Points on the subtotal before tax
   2. Full order total
   3. Flat points per order
   4. Type something.

 Enter to select · ↑/↓ to navigate · Esc to cancel
`;

const codexApproval = `
  Would you like to run the following command?

  $ rm -rf build

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (p)
  3. No, and tell Codex what to do differently (esc)
`;

test("parses a Claude permission prompt as an approval", () => {
  const ask = parseAsk(claudePermission);
  assert.equal(ask.kind, "approval");
  assert.equal(ask.question, "Do you want to proceed?");
  assert.deepEqual(ask.options.map((o) => o.n), [1, 2, 3]);
  assert.equal(ask.options[0].label, "Yes");
  assert.equal(ask.initial, 1);
  assert.match(ask.detail, /git push origin/);
});

test("parses a Claude question with descriptions and a recommendation", () => {
  const ask = parseAsk(claudeQuestion);
  assert.equal(ask.kind, "question");
  assert.equal(ask.question, "Earn rate basis?");
  assert.equal(ask.options.length, 4);
  assert.equal(ask.initial, 1);
  assert.equal(ask.options[0].label, "Order subtotal (Recommended)");
});

test("parses a Codex approval with the cursor marker", () => {
  const ask = parseAsk(codexApproval);
  assert.equal(ask.kind, "approval");
  assert.equal(ask.question, "Would you like to run the following command?".trim());
  assert.equal(ask.options.length, 3);
  assert.equal(ask.initial, 1);
});

test("the cursor row wins over a recommendation", () => {
  const ask = parseAsk(" Which one?\n   1. A (Recommended)\n ❯ 2. B\n   3. C\n");
  assert.equal(ask.initial, 2);
});

test("uses only the last numbered list on screen", () => {
  const ask = parseAsk("Steps:\n1. install\n2. build\n\nPick one?\n 1. Yes\n 2. No\n");
  assert.deepEqual(ask.options.map((o) => o.label), ["Yes", "No"]);
  assert.equal(ask.question, "Pick one?");
});

test("a screen without options is a free-text ask", () => {
  const ask = parseAsk("I finished the migration.\nWhich branch should I rebase onto?\n");
  assert.equal(ask.kind, "input");
  assert.equal(ask.question, "Which branch should I rebase onto?");
  assert.deepEqual(ask.options, []);
});

test("an empty screen is not an ask", () => {
  assert.equal(parseAsk("\n\n   \n"), null);
  assert.equal(parseAsk(""), null);
});

test("caps shown options at nine and says there are more", () => {
  const rows = Array.from({ length: 11 }, (_, i) => `  ${i + 1}. Option ${i + 1}`).join("\n");
  const ask = parseAsk(`Pick?\n${rows}\n`);
  assert.equal(ask.options.length, 9);
  assert.equal(ask.more, true);
});

test("askKey changes when the question or options change", () => {
  const a = parseAsk(claudePermission);
  const b = parseAsk(claudeQuestion);
  assert.notEqual(askKey("t1", a), askKey("t1", b));
  assert.notEqual(askKey("t1", a), askKey("t2", a));
  assert.equal(askKey("t1", a), askKey("t1", parseAsk(claudePermission)));
});

test("notification script escapes quotes and flattens newlines", () => {
  const s = notificationScript('Loyalty "x"', 'Earn\nrate "basis"?');
  assert.equal(s, 'display notification "Earn rate \\"basis\\"?" with title "Loyalty \\"x\\"" sound name "Glass"');
});

test("waiting labels", () => {
  assert.equal(waiting(1000), "now");
  assert.equal(waiting(5 * 60000), "5m");
  assert.equal(waiting(130 * 60000), "2h");
});
