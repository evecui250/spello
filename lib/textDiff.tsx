import { diffWords } from './words';

// Character-level diff between two short strings — used to underline
// exactly which LETTERS changed within what is, by contract, the SAME
// underlying word (a genuine typo, e.g. "gefült"/"gefühlt"). Only ever
// appropriate for spelling entries specifically, which the backend
// already guarantees are letter-level typos of one word, not a different
// word/phrase entirely (see explain-correction's own Levenshtein-ratio
// guard) — using this for a GRAMMAR point's wrong/correct pair produced a
// real, confirmed bug: "die"/"Der" (a genuinely different, differently-
// cased article, not a typo) share a coincidental "e", so this diff only
// underlined the non-"e" letters ("D" and "r"), leaving "der" looking
// half-changed instead of the whole word being a different word. See
// renderWordDiff below for the word-level equivalent grammar points need.
export function diffChars(a: string, b: string): { aChanged: boolean[]; bChanged: boolean[] } {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMatched = new Array(n).fill(false);
  const bMatched = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      aMatched[i] = true; bMatched[j] = true;
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { aChanged: aMatched.map(v => !v), bChanged: bMatched.map(v => !v) };
}

// Groups consecutive same-state characters into runs so the DOM gets one
// span per CHANGED stretch, not one span per character.
export function renderDiffedWord(word: string, changed: boolean[]): React.ReactNode {
  const runs: React.ReactNode[] = [];
  let i = 0;
  while (i < word.length) {
    let j = i;
    while (j < word.length && changed[j] === changed[i]) j++;
    const text = word.slice(i, j);
    runs.push(
      changed[i]
        ? <span key={i} className="underline decoration-accent decoration-2 underline-offset-2 font-bold">{text}</span>
        : text,
    );
    i = j;
  }
  return runs;
}

// Word-level diff for a grammar point's wrong/correct pair, which is often
// a short PHRASE where one or more whole words differ (a different
// article, a reordered word) rather than a letter-level typo within one
// word — reuses diffAgainstAttempt's own word-level LCS (diffWords, case-
// sensitive, since German capitalization is a real grammar rule) instead
// of diffChars, so a genuinely different word like "Der" (capitalized,
// different case entirely from "die") gets underlined WHOLLY rather than
// only the letters it doesn't coincidentally share with the other side.
export function renderWordDiff(wrong: string, correct: string): { wrongNode: React.ReactNode; correctNode: React.ReactNode } {
  const wrongWords = wrong.split(/\s+/).filter(Boolean);
  const correctWords = correct.split(/\s+/).filter(Boolean);
  // diffWords(A, B) reports which words in B matched something in A: call
  // it once per direction to get both sides' own matched/changed status.
  const correctMatched = diffWords(wrongWords, correctWords);
  const wrongMatched = diffWords(correctWords, wrongWords);
  const renderSide = (words: string[], matched: boolean[]): React.ReactNode => (
    words.map((w, i) => (
      <span key={i}>
        {i > 0 && ' '}
        {matched[i]
          ? w
          : <span className="underline decoration-accent decoration-2 underline-offset-2 font-bold">{w}</span>}
      </span>
    ))
  );
  return { wrongNode: renderSide(wrongWords, wrongMatched), correctNode: renderSide(correctWords, correctMatched) };
}
