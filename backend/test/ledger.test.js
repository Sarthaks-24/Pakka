import { describe, it, expect } from "vitest";
import {
  emptyLedger, applyTerms, applyOption, checkTerms, parseIndicNumbers, numberGuard, readiness, formatSlot,
} from "../src/ledger.js";

const today = "2026-11-06";
const types = (list) => list.map((a) => a.type);
const check = (terms, transcript = "", ledger = emptyLedger()) => checkTerms(terms, ledger, { transcript, today });

const fullTerms = {
  quantity: { value: 500, unit: "meter" },
  product: { name: "cotton poplin", spec: "58 inch" },
  price: { amount: 118, currency: "INR", per: "meter", gst: "extra" },
  delivery: { raw: "15 November", date: "2026-11-15" },
  payment: { advancePct: 30, balance: "on delivery" },
};

describe("rules", () => {
  it("A1: quantity without unit", () => {
    const [a] = check({ quantity: { value: 500 } }, "500");
    expect(a.type).toBe("A1");
    expect(a.slot).toBe("quantity");
    expect(a.options.map((o) => o.id)).toEqual(["meter", "roll", "kg", "piece"]);
  });

  it("A2: roll is an unstable unit", () => {
    expect(types(check({ quantity: { value: 500, unit: "roll" } }))).toEqual(["A2"]);
  });

  it("A3: relative date offers the next two Fridays", () => {
    const [a] = check({ delivery: { raw: "next Friday" } }, "next Friday");
    expect(a.type).toBe("A3");
    expect(a.options.map((o) => o.patch.date)).toEqual(["2026-11-13", "2026-11-20"]);
  });

  it("A3: valid LLM candidates are used, invalid ones are dropped", () => {
    const [a] = check({ delivery: { raw: "after Diwali", candidates: ["2026-11-12", "2020-01-01", "nonsense"] } });
    expect(a.options.map((o) => o.patch.date)).toEqual(["2026-11-12"]);
  });

  it("A4: price without GST flag", () => {
    const list = check({ price: { amount: 118, currency: "INR", per: "meter" } }, "118");
    expect(types(list)).toEqual(["A4"]);
  });

  it("A5: price without basis", () => {
    expect(types(check({ price: { amount: 118, currency: "INR", gst: "extra" } }))).toEqual(["A5"]);
  });

  it("A6: advance without balance", () => {
    expect(types(check({ payment: { advancePct: 30 } }))).toEqual(["A6"]);
  });

  it("A8: changed price without acknowledgement", () => {
    const ledger = applyTerms(emptyLedger(), { price: fullTerms.price });
    const [a] = check({ price: { amount: 120 } }, "ok 120", ledger);
    expect(a.type).toBe("A8");
    expect(a.options.map((o) => o.patch.amount)).toEqual([118, 120]);
  });

  it("A8: not raised when the speaker says the price changed", () => {
    const ledger = applyTerms(emptyLedger(), { price: fullTerms.price });
    expect(check({ price: { amount: 120 } }, "the price changed to 120", ledger)).toEqual([]);
  });

  it("A10: dollar in the transcript with no currency", () => {
    expect(types(check({ price: { amount: 5, per: "meter", gst: "included" } }, "5 dollar"))).toEqual(["A10"]);
  });

  it("fully specified deal has no ambiguities and is ready", () => {
    expect(check(fullTerms, "all of it")).toEqual([]);
    const ledger = applyTerms(emptyLedger(), fullTerms);
    expect(readiness(ledger)).toEqual({ ready: true, missing: [] });
  });

  it("readiness lists empty slots", () => {
    const ledger = applyTerms(emptyLedger(), { quantity: fullTerms.quantity });
    expect(readiness(ledger).missing).toEqual(["product", "price", "delivery", "payment"]);
  });

  it("unresolved slots are not asked again", () => {
    const ledger = applyTerms(emptyLedger(), {});
    ledger.quantity = { ...ledger.quantity, value: 500, status: "unresolved" };
    expect(check({}, "", ledger)).toEqual([]);
  });
});

describe("parseIndicNumbers", () => {
  it.each([
    ["dedh hazaar", 1500],
    ["sava lakh", 125000],
    ["dhai sau", 250],
    ["paanch sau pachas", 550],
    ["do lakh pachas hazaar", 250000],
    ["૫૦૦", 500],
    ["५००", 500],
    ["1,500 meter", 1500],
  ])("%s", (text, value) => {
    expect(parseIndicNumbers(text)).toEqual([value]);
  });

  it("finds several numbers", () => {
    expect(parseIndicNumbers("500 meter 118 rupaye")).toEqual([500, 118]);
  });
});

describe("numberGuard", () => {
  it("drops a value that is not in the transcript", () => {
    const safe = numberGuard({ quantity: { value: 600, unit: "meter" }, price: { amount: 118 } }, "500 meter 118 rupaye");
    expect(safe.quantity.value).toBeNull();
    expect(safe.quantity.unit).toBe("meter");
    expect(safe.price.amount).toBe(118);
  });

  it("accepts a value spoken as number words", () => {
    expect(numberGuard({ quantity: { value: 1500 } }, "dedh hazaar").quantity.value).toBe(1500);
  });
});

describe("applyOption and formatting", () => {
  it("sets the field from the chosen option and does not mutate the input", () => {
    const ledger = applyTerms(emptyLedger(), { quantity: { value: 500 } });
    const [a] = check({}, "", ledger);
    const next = applyOption(ledger, a, "meter");
    expect(next.quantity.unit).toBe("meter");
    expect(next.quantity.status).toBe("ok");
    expect(ledger.quantity.unit).toBeNull();
  });

  it("keeping rolls is remembered so A2 is not asked again", () => {
    const ledger = applyTerms(emptyLedger(), { quantity: { value: 5, unit: "roll" } });
    const [a] = check({}, "", ledger);
    expect(check({}, "", applyOption(ledger, a, "keep"))).toEqual([]);
  });

  it("formats slots per language", () => {
    expect(formatSlot("quantity", { value: 500, unit: "meter" }, "en-IN")).toBe("500 meters");
    expect(formatSlot("quantity", { value: 500, unit: "meter" }, "hi-IN")).toBe("500 मीटर");
    expect(formatSlot("delivery", { date: "2026-11-13" }, "en-IN")).toBe("13 November 2026");
    expect(formatSlot("price", fullTerms.price, "en-IN")).toBe("118 rupees per meter, GST extra");
  });

  it("shows the product name in the reader's language when a translation is stored", () => {
    const product = { name: "કોટન કાપડ", nameTranslated: "सूती कपड़ा", nameLang: "gu-IN", spec: null };
    expect(formatSlot("product", product, "hi-IN")).toBe("सूती कपड़ा");
    expect(formatSlot("product", product, "gu-IN")).toBe("કોટન કાપડ");
    expect(formatSlot("product", { name: "cotton" }, "hi-IN")).toBe("cotton");
  });
});
