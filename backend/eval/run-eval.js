// Usage: node --env-file-if-exists=.env eval/run-eval.js [--only d01,d07] [--limit N]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emptyLedger, applyTerms } from "../src/ledger.js";
import { detectAmbiguities } from "../src/deal.js";
import * as llm from "../src/llm.js";
import { score, TYPES } from "./score.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const TODAY = "2026-11-06";

function parseArgs(argv) {
  const out = { only: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") out.only = new Set((argv[++i] || "").split(",").filter(Boolean));
    else if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else {
      console.error(`Unknown flag ${argv[i]}. Use --only d01,d07 or --limit N.`);
      process.exit(2);
    }
  }
  if (out.limit !== null && !(out.limit > 0)) {
    console.error("--limit needs a positive number.");
    process.exit(2);
  }
  return out;
}

const pct = (v) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
const otherLang = (lang) => (lang === "gu-IN" ? "hi-IN" : "gu-IN");

async function runDialogue(d) {
  let ledger = emptyLedger();
  const predicted = new Set();
  const translations = [];
  for (const turn of d.turns) {
    const res = await detectAmbiguities({
      transcript: turn.text,
      speakerLang: turn.lang,
      listenerLang: otherLang(turn.lang),
      ledger,
      today: TODAY,
      llm,
    });
    for (const a of res?.ambiguities ?? []) predicted.add(a.type);
    if (res?.translation) translations.push(res.translation);
    const next = applyTerms(ledger, res?.terms);
    if (next) ledger = next;
  }
  return { predicted: [...predicted].sort(), translations };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. Put it in backend/.env and run: npm run eval");
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  let dialogues = readFileSync(path.join(dir, "dialogues.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  if (args.only) dialogues = dialogues.filter((d) => args.only.has(d.id));
  if (args.limit) dialogues = dialogues.slice(0, args.limit);
  if (dialogues.length === 0) {
    console.error("No dialogues selected.");
    process.exit(2);
  }

  const results = [];
  for (const d of dialogues) {
    process.stdout.write(`${d.id} ... `);
    try {
      const { predicted, translations } = await runDialogue(d);
      const expected = [...d.expected].sort();
      const ok = expected.join() === predicted.join();
      console.log(ok ? "ok" : "FAIL");
      results.push({ id: d.id, expected, predicted, translations, ok });
    } catch (err) {
      console.log("ERROR");
      results.push({ id: d.id, expected: [...d.expected].sort(), predicted: [], translations: [], ok: false, error: String(err?.message ?? err) });
    }
  }

  const s = score(results);
  console.log("\nType   precision  recall   tp fp fn");
  for (const t of TYPES) {
    const c = s.perType[t];
    console.log(`${t.padEnd(6)} ${pct(c.precision).padStart(9)} ${pct(c.recall).padStart(7)}   ${c.tp}  ${c.fp}  ${c.fn}`);
  }
  console.log(`\nOverall (micro): precision ${pct(s.micro.precision)}, recall ${pct(s.micro.recall)}`);
  console.log(`False alarms on clean dialogues: ${s.clean.falseAlarms} of ${s.clean.total}`);

  const failures = results.filter((r) => !r.ok);
  if (failures.length) console.log(`\nFailing dialogues (${failures.length})`);
  for (const f of failures) {
    console.log(`\n${f.id}`);
    console.log(`  expected:  [${f.expected.join(", ")}]`);
    console.log(`  predicted: [${f.predicted.join(", ")}]`);
    if (f.error) console.log(`  error: ${f.error}`);
    for (const t of f.translations) console.log(`  translation: ${t}`);
  }

  const out = {
    timestamp: new Date().toISOString(),
    model: process.env.GEMINI_MODEL ?? null,
    today: TODAY,
    dialogues: results.length,
    summary: s,
    results,
  };
  writeFileSync(path.join(dir, "results.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("\nWrote eval/results.json");
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
