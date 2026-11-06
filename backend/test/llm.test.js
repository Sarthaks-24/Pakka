import { describe, it, expect } from "vitest";
import { sanitizeAnalysis } from "../src/llm.js";

describe("sanitizeAnalysis", () => {
  it("coerces numbers and drops unknown units, slots and types", () => {
    const out = sanitizeAnalysis({
      translation: " hello ",
      terms: {
        quantity: { value: "1,500", unit: "furlong" },
        price: { amount: -5, currency: "usd", gst: "extra" },
        colour: { name: "red" },
      },
      ambiguities: [
        { type: "A1", slot: "quantity", options: [] },
        { type: "A7", slot: "nowhere", options: [] },
        { type: "A7", slot: "product", quote: "the 60 one", options: [
          { label: "44 inch", field: "spec", value: "44 inch" },
          { label: "bad", field: "colour", value: "x" },
        ] },
      ],
    });
    expect(out.translation).toBe("hello");
    expect(out.terms).toEqual({ quantity: { value: 1500 }, price: { currency: "USD", gst: "extra" } });
    expect(out.ambiguities).toEqual([
      { type: "A7", slot: "product", quote: "the 60 one", options: [{ label: "44 inch", patch: { spec: "44 inch" } }] },
    ]);
  });

  it("rejects an answer with no translation", () => {
    expect(() => sanitizeAnalysis({ terms: {} })).toThrow(/translation/);
  });
});
