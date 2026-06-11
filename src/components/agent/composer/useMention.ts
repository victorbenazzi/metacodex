/**
 * Caret-token detection for the composer's inline autocomplete: a "/" (skills)
 * or "@" (context) at the start of the word under the caret opens the
 * MentionPopup; the chars between trigger and caret are the live query.
 * Pure function, the composer owns caret state and dismissal.
 */

export interface ActiveMention {
  trigger: "/" | "@";
  /** Chars typed after the trigger, up to the caret. */
  query: string;
  /** Index of the trigger char in the text (replace range start). */
  start: number;
  /** Caret index (replace range end). */
  end: number;
}

export function detectMention(text: string, caret: number): ActiveMention | null {
  if (caret < 1 || caret > text.length) return null;
  // Walk back to the start of the word under the caret.
  let i = caret - 1;
  while (i >= 0 && !/\s/.test(text[i])) i--;
  const wordStart = i + 1;
  const ch = text[wordStart];
  if (ch !== "/" && ch !== "@") return null;
  if (caret <= wordStart) return null;
  return { trigger: ch, query: text.slice(wordStart + 1, caret), start: wordStart, end: caret };
}

/** Imperative surface the composer's onKeyDown delegates to while open. */
export interface MentionPopupHandle {
  /** Returns true when the popup consumed the key (arrows / Enter / Escape). */
  handleKey: (e: React.KeyboardEvent) => boolean;
}
