'use client';

import { Word, LEVEL_ORDER } from './words';
import { getSettings, getActiveLevel, cefrLevelFor, today, Settings } from './storage';

// Review's optional "Past tense" step (see DailySessionFlow's
// review-past-tense phase): a few of today's review verbs, each asked as
// "er kauft -> er [hat|ist] ______" — pick the auxiliary, type the
// participle with no letters given (the present form is the hint). Built
// on each verb's pre-baked perfectTense ("hat gekauft", "ist gegangen").

export const PAST_TENSE_PER_DAY = 3;

// On by default from A2 up (books by their own CEFR level) — A1 learners
// haven't met the Perfekt yet. Settings' "Past tense practice" overrides.
export function pastTenseEnabled(s: Settings = getSettings()): boolean {
  if (typeof s.pastTensePractice === 'boolean') return s.pastTensePractice;
  return LEVEL_ORDER.indexOf(cefrLevelFor(s.level)) >= LEVEL_ORDER.indexOf('A2');
}

export interface PerfectForm {
  aux: 'hat' | 'ist';
  reflexive: boolean; // "hat sich verliebt" — "sich" is shown, not asked
  participle: string;
}

export function perfectFormOf(w: Word): PerfectForm | null {
  if (w.type !== 'verb' || !w.perfectTense) return null;
  const m = w.perfectTense.trim().match(/^(hat|ist)\s+(sich\s+)?(\S+)$/);
  return m ? { aux: m[1] as 'hat' | 'ist', reflexive: !!m[2], participle: m[3] } : null;
}

// Per-verb record, on this device only — it just decides which verbs come
// up, never anything about the word's own review schedule.
interface Stat { right: number; wrong: number; streak: number; last: string }
const statsKey = () => `wb2_past_tense__${getActiveLevel()}`;

function getStats(): Record<string, Stat> {
  try {
    return JSON.parse(localStorage.getItem(statsKey()) || '{}');
  } catch {
    return {};
  }
}

export function recordPastTense(id: string, correct: boolean): void {
  try {
    const all = getStats();
    const s = all[id] ?? { right: 0, wrong: 0, streak: 0, last: '' };
    all[id] = correct
      ? { ...s, right: s.right + 1, streak: s.streak + 1, last: today() }
      : { ...s, wrong: s.wrong + 1, streak: 0, last: today() };
    localStorage.setItem(statsKey(), JSON.stringify(all));
  } catch {
    // Storage full/blocked — only the verb choice suffers.
  }
}

// The harder kinds come up more: "ist" verbs and irregular participles
// (gegangen, geschrieben) over regular ge-…-t ones, and misses over
// verbs already right a few times running. A verb right 3+ times in a
// row rests for two weeks.
export function pickPastTenseVerbs(words: Word[], max = PAST_TENSE_PER_DAY): Word[] {
  const stats = getStats();
  const t = Date.parse(today());
  const scored = words.flatMap(w => {
    const f = perfectFormOf(w);
    if (!f) return [];
    const s = stats[w.id];
    if (s && s.streak >= 3 && t - Date.parse(s.last) < 14 * 86400000) return [];
    if (s?.last === today()) return [];
    const hard = (f.aux === 'ist' ? 2 : 0) + (/en$/.test(f.participle) ? 1.5 : 0);
    return [{ w, score: hard + (s ? s.wrong * 1.5 - s.streak : 1) + Math.random() * 2 }];
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.w);
}
