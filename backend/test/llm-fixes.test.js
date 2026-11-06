import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeAnalysis, analyseTurn } from "../src/llm.js";
import { UNITS, emptyLedger, formatDate } from "../src/ledger.js";
import { detectAmbiguities } from "../src/deal.js";

const today = "2026-11-06";

afterEach(() => vi.unstubAllGlobals());

describe("delivery date validation", () => {
  const dateOf = (date) => sanitizeAnalysis({ translation: "x", terms: { delivery: { raw: "soon", date } }, ambiguities: [] }, today).terms.delivery;
  it("keeps a real future date", () => expect(dateOf("2026-11-15")).toEqual({ raw: "soon", date: "2026-11-15" }));
  it.each(["2026-02-30", "2020-01-01", "15 November", "2026-13-01", "2026-11-05"])("drops %s", (d) => {
    expect(dateOf(d)).toEqual({ raw: "soon" });
  });
  it("formatDate returns the raw string for an invalid date", () => {
    expect(formatDate("soon", "en-IN")).toBe("soon");
    expect(formatDate("2026-13-40", "en-IN")).toBe("2026-13-40");
  });
  it("drops an option with an invalid date", () => {
    const out = sanitizeAnalysis({ translation: "x", terms: {}, ambiguities: [{ type: "A9", slot: "delivery", options: [
      { label: "a", field: "date", value: "2026-11-20" }, { label: "b", field: "date", value: "2026-02-30" },
    ] }] }, today);
    expect(out.ambiguities[0].options).toHaveLength(1);
  });
});

describe("units", () => {
  it("lot is a ledger unit and accepted from the model", () => {
    expect(UNITS).toContain("lot");
    const out = sanitizeAnalysis({ translation: "x", terms: { quantity: { value: 2, unit: "lot" } }, ambiguities: [] }, today);
    expect(out.terms.quantity.unit).toBe("lot");
  });
});

describe("LLM option patches", () => {
  const llm = (ambiguities, terms = {}) => ({ analyseTurn: async () => ({ translation: "x", terms, ambiguities }) });
  const run = (transcript, ambiguities, terms) =>
    detectAmbiguities({ transcript, speakerLang: "gu-IN", listenerLang: "hi-IN", ledger: emptyLedger(), today, llm: llm(ambiguities, terms) });
  const a9 = (...amounts) => ({ type: "A9", slot: "price", quote: null, options: amounts.map((n) => ({ label: String(n), patch: { amount: n } })) });

  it("drops an option whose number was not said, and the ambiguity when fewer than 2 remain", async () => {
    expect((await run("118 ya 120", [a9(118, 999)])).ambiguities).toEqual([]);
    const kept = await run("118 ya 120 ya 130", [a9(118, 120, 999)]);
    expect(kept.ambiguities[0].options).toHaveLength(2);
  });

  it("keeps an LLM ambiguity that a rule also flags for later", async () => {
    const res = await run("500 ya 600", [{ type: "A9", slot: "quantity", quote: null, options: [
      { label: "500", patch: { value: 500 } }, { label: "600", patch: { value: 600 } }] }], { quantity: { value: 500 } });
    expect(res.ambiguities.map((a) => a.type)).toEqual(["A1"]);
    expect(res.deferred.map((a) => a.type)).toEqual(["A9"]);
  });

  it("reports a guarded value", async () => {
    const res = await run("pachchees meter", [], { quantity: { value: 25, unit: "meter" } });
    expect(res.dropped).toEqual([{ slot: "quantity", field: "value" }]);
  });
});

describe("gemini errors", () => {
  const call = () => analyseTurn({ transcript: "x", speakerLang: "gu-IN", listenerLang: "hi-IN", ledger: emptyLedger(), today });
  const status = (s) => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: s })));

  it("400 does not blame the key", async () => {
    status(400);
    await expect(call()).rejects.toThrow(/^(?!.*GEMINI_API_KEY)/);
  });
  it.each([401, 403])("%i points at the key", async (s) => {
    status(s);
    await expect(call()).rejects.toThrow(/GEMINI_API_KEY/);
  });
  it("404 names the model setting", async () => {
    status(404);
    await expect(call()).rejects.toThrow(/model in GEMINI_MODEL was not found/);
  });
  it("sends a timeout signal and reports a timeout clearly", async () => {
    const fetchMock = vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(call()).rejects.toThrow(/took too long/);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
