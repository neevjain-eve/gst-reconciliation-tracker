import { panFromGstin } from "@/lib/gstin";
import { trailingDigits } from "./normalize";

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 - normalised edit distance, in [0, 1]. */
export function editRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/**
 * Similarity of two *normalised* invoice numbers in [0, 1].
 * 1.0   identical
 * 0.7–0.9  one contains the other ("45" ending "INV202645"): partial numbers, dropped prefixes
 * 0.75  same trailing sequence number (≥2 digits) with different prefixes
 * else  edit-distance ratio, ignored below 0.6 to avoid noise
 */
export function invoiceNumberSimilarity(a: string, b: string): number {
  if (a === b) return a === "" ? 0 : 1;
  if (!a || !b) return 0;
  let best = 0;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if ((short.length >= 3 && long.includes(short)) || (short.length >= 2 && long.endsWith(short))) best = Math.max(best, 0.7 + 0.2 * (short.length / long.length));

  const ta = trailingDigits(a);
  const tb = trailingDigits(b);
  if (ta.length >= 2 && ta === tb) best = Math.max(best, 0.75);

  const r = editRatio(a, b);
  if (r >= 0.6) best = Math.max(best, r);

  return Math.min(best, 0.99); // reserve 1.0 for identical numbers
}

/** 1 identical · 0.6 same PAN (another state registration) or ≤2 character typo · 0 otherwise. */
export function gstinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 15 && b.length === 15) {
    if (panFromGstin(a) === panFromGstin(b)) return 0.6;
    if (levenshtein(a, b) <= 2) return 0.6;
  }
  return 0;
}
