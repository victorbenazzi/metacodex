/**
 * First user-perceived character (grapheme cluster) of a string. Emoji with
 * ZWJ sequences / skin tones span several code points, so neither `slice` nor
 * `Array.from(...)[0]` is safe; `Intl.Segmenter` is. Falls back to the first
 * code point where Segmenter is unavailable.
 */
export function firstGrapheme(input: string): string {
  const text = input.trim();
  if (!text) return "";
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(text)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  } catch {
    return Array.from(text)[0] ?? "";
  }
}
