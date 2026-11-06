import { describe, it, expect } from "vitest";
import { score } from "./score.js";

describe("score", () => {
  it("scores a perfect run", () => {
    const r = score([
      { expected: ["A1"], predicted: ["A1"] },
      { expected: ["A4", "A3"], predicted: ["A3", "A4"] },
    ]);
    expect(r.micro.precision).toBe(1);
    expect(r.micro.recall).toBe(1);
    expect(r.perType.A4).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("counts misses and extras per type", () => {
    const r = score([
      { expected: ["A1"], predicted: ["A2"] },
      { expected: ["A1"], predicted: ["A1"] },
    ]);
    expect(r.perType.A1).toMatchObject({ tp: 1, fn: 1, precision: 1, recall: 0.5 });
    expect(r.perType.A2).toMatchObject({ tp: 0, fp: 1, precision: 0 });
    expect(r.micro).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
  });

  it("returns null, not NaN, on zero division", () => {
    const r = score([{ expected: [], predicted: [] }]);
    expect(r.micro.precision).toBeNull();
    expect(r.micro.recall).toBeNull();
    expect(r.perType.A7.precision).toBeNull();
    expect(r.perType.A7.recall).toBeNull();
  });

  it("counts false alarms on clean dialogues only", () => {
    const r = score([
      { expected: [], predicted: ["A4"] },
      { expected: [], predicted: [] },
      { expected: ["A1"], predicted: ["A1", "A5"] },
    ]);
    expect(r.clean).toEqual({ total: 2, falseAlarms: 1 });
    expect(r.perType.A5.fp).toBe(1);
  });
});
