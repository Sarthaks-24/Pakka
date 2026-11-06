export const TYPES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"];

const ratio = (num, den) => (den === 0 ? null : num / den);

// results: [{ expected: string[], predicted: string[] }]
// Precision or recall is null when its denominator is zero.
export function score(results, types = TYPES) {
  const perType = {};
  for (const t of types) perType[t] = { tp: 0, fp: 0, fn: 0 };
  let falseAlarms = 0;
  let clean = 0;

  for (const { expected, predicted } of results) {
    const exp = new Set(expected);
    const pred = new Set(predicted);
    if (exp.size === 0) {
      clean += 1;
      if (pred.size > 0) falseAlarms += 1;
    }
    for (const t of types) {
      if (exp.has(t) && pred.has(t)) perType[t].tp += 1;
      else if (pred.has(t)) perType[t].fp += 1;
      else if (exp.has(t)) perType[t].fn += 1;
    }
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const t of types) {
    const c = perType[t];
    c.precision = ratio(c.tp, c.tp + c.fp);
    c.recall = ratio(c.tp, c.tp + c.fn);
    tp += c.tp;
    fp += c.fp;
    fn += c.fn;
  }

  return {
    perType,
    micro: { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) },
    clean: { total: clean, falseAlarms },
  };
}
