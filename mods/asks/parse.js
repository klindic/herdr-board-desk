// Turns a blocked agent's terminal screen into an "ask": the question, its numbered
// options, and what kind of ask it is. Pure logic (no Herdr imports) so it can be tested.

const BOX = /[─-╿▀-▟]/g;
const OPTION = /^\s*([❯›▶>→])?\s*(\d{1,2})[.)]\s+(\S.*?)\s*$/;
const TAIL_LINES = 45;
const MAX_DETAIL = 3;
const MAX_OPTIONS = 9;

/** Screen text to clean lines: box drawing characters removed, trailing blanks dropped. */
export function cleanLines(screen) {
  const lines = String(screen ?? "")
    .split("\n")
    .map((line) => line.replace(BOX, " ").replace(/\s+$/, ""));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.slice(-TAIL_LINES);
}

/** The last run of options numbered 1, 2, 3... in the lines, with their line indexes. */
function lastRun(lines) {
  let run = [];
  let best = [];
  lines.forEach((line, index) => {
    const m = OPTION.exec(line);
    if (!m) return;
    const n = Number(m[2]);
    if (n === 1) run = [];
    if (n === run.length + 1) {
      run.push({ n, label: m[3].replace(/\s{2,}.*$/, "").trim(), selected: Boolean(m[1]), line: index });
      best = run;
    }
  });
  return best;
}

const isChrome = (line) => {
  const s = line.trim();
  return (
    s === "" ||
    /^[-=_\u2014\u2013\s]+$/.test(s) ||
    /^(esc|enter|tab|ctrl|shift)\b.*\b(to|for)\b/i.test(s) ||
    /^use (arrow|the arrow)/i.test(s)
  );
};

function kindOf(question, options) {
  const labels = options.map((o) => o.label);
  const yesNo = labels.some((l) => /^yes\b/i.test(l)) && labels.some((l) => /^no\b/i.test(l));
  if (yesNo || /\b(do you want|would you like|allow|approve|proceed|permission)\b/i.test(question)) return "approval";
  return "question";
}

/** The ask a blocked terminal shows, or null when the screen has nothing to answer. */
export function parseAsk(screen) {
  const lines = cleanLines(screen);
  if (!lines.length) return null;
  const options = lastRun(lines);
  if (options.length >= 2) {
    const first = options[0].line;
    let q = first - 1;
    while (q >= 0 && isChrome(lines[q])) q--;
    if (q < 0) return null;
    const near = q;
    // A command or diff can sit between the question and its options: prefer the nearest line asking something.
    for (let i = q, seen = 0; i >= 0 && seen < 6; i--) {
      if (isChrome(lines[i])) continue;
      seen++;
      if (/\?\s*$/.test(lines[i])) {
        q = i;
        break;
      }
    }
    const question = lines[q].trim().replace(/^[❯›▶>•●]\s*/, "");
    const detail = [];
    const collect = (from, stop) => {
      for (let i = from; i >= 0 && i > stop && detail.length < MAX_DETAIL; i--) {
        if (isChrome(lines[i])) {
          if (detail.length) break;
          continue;
        }
        detail.unshift(lines[i].trim());
      }
    };
    collect(near, q);
    if (detail.length === 0) collect(q - 1, -1);
    const shown = options.slice(0, MAX_OPTIONS);
    const cursor = options.find((o) => o.selected);
    const recommended = options.find((o) => /\(recommended\)/i.test(o.label));
    return {
      kind: kindOf(question, options),
      question,
      detail: detail.join("\n"),
      options: shown.map(({ n, label }) => ({ n, label })),
      initial: (cursor ?? recommended ?? options[0]).n,
      more: options.length > shown.length,
    };
  }
  const tail = lines.filter((l) => !isChrome(l)).slice(-4).map((l) => l.trim());
  if (!tail.length) return null;
  const question = [...tail].reverse().find((l) => /[?:]$/.test(l)) ?? tail[tail.length - 1];
  return { kind: "input", question, detail: tail.filter((l) => l !== question).join("\n"), options: [], initial: null, more: false };
}

/** A key for one ask, so the same question is notified once and a dismissal sticks. */
export function askKey(address, ask) {
  return `${address}|${ask.question}|${ask.options.map((o) => o.label).join("/")}`;
}

/** macOS notification script text; strings become AppleScript literals. */
export function notificationScript(title, body) {
  const lit = (s) => JSON.stringify(String(s).replace(/[\r\n]+/g, " ").slice(0, 180));
  return `display notification ${lit(body)} with title ${lit(title)} sound name "Glass"`;
}

/** Formats how long an ask has been waiting. */
export function waiting(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
