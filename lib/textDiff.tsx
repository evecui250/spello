// Character-level diff between two short strings (a word, or a short
// phrase) — used to underline exactly which letters changed rather than
// bolding a whole word/phrase wholesale. Shared between DailySessionFlow's
// own correction/spelling display and WhyExplanationSheet's wrong->correct
// point cards, both of which need the identical "highlight only what
// actually differs" treatment.
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
