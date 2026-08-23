'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getDailySession, saveDailySession, DailySession, SessionPhase,
  getWordProgress, saveWordProgress, getAllProgress, getSettings, saveSettings, today,
  Round, WordProgress, Settings, MascotStageId, DailyStats,
  isStudyGoalDoneToday, isReviewGoalDoneToday, markStudyGoalDone, markReviewGoalDone,
  touchStreak, markCongratsShown, getDailyStats, addEarnedPuppy, addEarnedUpgrade,
  logWordActivity,
} from '../lib/storage';
import {
  wordsById, generateHint, checkAnswer, applyResult, applyReviewResult, requestHint,
  buildMcqChoices, buildMatchingPages, getKnownVocabulary, isBootstrapCopyWord, shuffled,
  hasEnoughWordsForGame,
} from '../lib/practice';
import { REVIEW_PLAN } from '../lib/srs';
import { Word, WordType, Level, resolveClickedWord, glossFor, findWordByEnglishForm, segmentChineseForClicks } from '../lib/words';
import LetterInputRow, { LetterInputRowHandle } from './LetterInputRow';
import SpecialCharButtons from './SpecialCharButtons';
import SpeakerButton from './SpeakerButton';
import TextSpeakerButton from './TextSpeakerButton';
import TranslationChoiceCard from './TranslationChoiceCard';
import MatchingQuizPage from './MatchingQuizPage';
import DachshundMascot from './Mascot';
import CongratsModal from './CongratsModal';
import WordMatchGame from './WordMatchGame';
import SignInNudge from './SignInNudge';
import AiUnlockCelebration from './AiUnlockCelebration';
import WordInfoPanel from './WordInfoPanel';
import GlossPopup from './GlossPopup';
import { speakWord, speakText, stopSpeech } from '../lib/speech';
import { imageUrlForWord } from '../lib/wordImage';
import { WORDS_WITH_IMAGES } from '../lib/wordImageManifest';
import { scheduleSync } from '../lib/sync';
import { playCorrectChime } from '../lib/sound';
import { correctSentence, generateSentence, explainCorrection, getSentenceGlosses, WordGloss, DailyLimitReachedError, AIUnreachableError } from '../lib/ai';
import { supabase } from '../lib/supabase';

// Locates wordForm inside sentence (case-insensitive) so callers can bold
// it — used by ReferenceSentence (round 1's copy-mode reference / the
// history replay of one of those rounds).
function splitOnWordForm(sentence: string, wordForm: string): { before: string; match: string; after: string } | null {
  const idx = sentence.toLowerCase().indexOf(wordForm.toLowerCase());
  if (idx === -1) return null;
  return {
    before: sentence.slice(0, idx),
    match: sentence.slice(idx, idx + wordForm.length),
    after: sentence.slice(idx + wordForm.length),
  };
}

// Same idea as splitOnWordForm, but for the ENGLISH/CHINESE translation
// line (see ReferenceSentence) — finds the target word's own gloss inside
// it so that can be bolded too (e.g. "verderben", en: "to spoil, go bad",
// bolds "spoil" inside "...it will spoil quickly."). English tokens get
// the same de-inflection (strip -s/-ed/-ing/-ies) findWordByEnglishForm's
// own corpus lookup already relies on, since a translation is written
// naturally and almost never uses the bare dictionary form verbatim.
// Chinese has no inflection to strip, so it's a plain substring search
// over each of word.zh's own comma/／-separated senses instead.
// Best-effort: returns null (plain, unbolded text) rather than risk a
// wrong guess when nothing lines up cleanly.
// Common irregular English forms that no suffix rule can derive (went isn't
// "go" with anything stripped off it) — the biggest real source of missed
// bolding, since a natural AI-written sentence uses whatever tense/form
// actually fits, not the bare dictionary form. Not exhaustive (this is
// still a best-effort client-side guess, not something the AI itself
// tagged) — covers the common irregular verbs/nouns/comparatives a B1/B2
// sentence is likely to reach for.
const IRREGULAR_EN_FORMS: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do',
  went: 'go', gone: 'go', goes: 'go',
  ate: 'eat', eaten: 'eat',
  bought: 'buy',
  saw: 'see', seen: 'see',
  took: 'take', taken: 'take',
  made: 'make',
  gave: 'give', given: 'give',
  got: 'get', gotten: 'get',
  came: 'come',
  found: 'find',
  thought: 'think',
  knew: 'know', known: 'know',
  told: 'tell',
  became: 'become',
  began: 'begin', begun: 'begin',
  broke: 'break', broken: 'break',
  brought: 'bring',
  built: 'build',
  chose: 'choose', chosen: 'choose',
  drank: 'drink', drunk: 'drink',
  drove: 'drive', driven: 'drive',
  fell: 'fall', fallen: 'fall',
  felt: 'feel',
  flew: 'fly', flown: 'fly',
  forgot: 'forget', forgotten: 'forget',
  heard: 'hear',
  held: 'hold',
  kept: 'keep',
  left: 'leave',
  lost: 'lose',
  met: 'meet',
  paid: 'pay',
  ran: 'run',
  said: 'say',
  sold: 'sell',
  sent: 'send',
  sat: 'sit',
  spoke: 'speak', spoken: 'speak',
  spent: 'spend',
  stood: 'stand',
  taught: 'teach',
  understood: 'understand',
  wore: 'wear', worn: 'wear',
  wrote: 'write', written: 'write',
  won: 'win',
  slept: 'sleep',
  sang: 'sing', sung: 'sing',
  rode: 'ride', ridden: 'ride',
  rose: 'rise', risen: 'rise',
  threw: 'throw', thrown: 'throw',
  grew: 'grow', grown: 'grow',
  swam: 'swim', swum: 'swim',
  shook: 'shake', shaken: 'shake',
  stole: 'steal', stolen: 'steal',
  froze: 'freeze', frozen: 'freeze',
  hid: 'hide', hidden: 'hide',
  meant: 'mean',
  dealt: 'deal',
  swept: 'sweep',
  kneeled: 'kneel', knelt: 'kneel',
  bent: 'bend',
  lent: 'lend',
  children: 'child', men: 'man', women: 'woman', people: 'person',
  feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  further: 'far', furthest: 'far', farther: 'far', farthest: 'far',
  less: 'little', least: 'little', more: 'much', most: 'much',
};

// Every plausible lemma a single inflected English token could reduce to —
// gathered as a set of GUESSES rather than one deterministic answer, since
// English spelling rules are ambiguous in isolation (does "-es" reduce
// "boxes" to "box", or does "-s" reduce "makes" to "make"? both patterns
// are real). Cheap to over-generate candidates here since callers only
// ever check set membership against a short, known list of senses.
function englishLemmaCandidates(token: string): string[] {
  const lower = token.toLowerCase();
  const c = new Set<string>([lower]);
  if (IRREGULAR_EN_FORMS[lower]) c.add(IRREGULAR_EN_FORMS[lower]);
  if (lower.length > 3 && lower.endsWith('ies')) c.add(lower.slice(0, -3) + 'y');
  if (lower.endsWith('es')) c.add(lower.slice(0, -2));
  if (lower.endsWith('s') && !lower.endsWith('ss')) c.add(lower.slice(0, -1));
  const doubledEd = lower.match(/^(.+?)([a-z])\2ed$/);
  if (doubledEd) c.add(doubledEd[1] + doubledEd[2]);
  if (lower.length > 3 && lower.endsWith('ied')) c.add(lower.slice(0, -3) + 'y');
  if (lower.endsWith('ed')) {
    c.add(lower.slice(0, -2)); // e.g. "worked" -> "work"
    c.add(lower.slice(0, -1)); // e.g. "used" -> "use" (silent e kept)
  }
  const doubledIng = lower.match(/^(.+?)([a-z])\2ing$/);
  if (doubledIng) c.add(doubledIng[1] + doubledIng[2]);
  if (lower.endsWith('ing')) {
    c.add(lower.slice(0, -3)); // e.g. "working" -> "work"
    c.add(lower.slice(0, -3) + 'e'); // e.g. "making" -> "make"
  }
  if (lower.length > 3 && lower.endsWith('ier')) c.add(lower.slice(0, -3) + 'y');
  if (lower.length > 4 && lower.endsWith('iest')) c.add(lower.slice(0, -4) + 'y');
  if (lower.endsWith('er')) c.add(lower.slice(0, -2));
  if (lower.endsWith('est')) c.add(lower.slice(0, -3));
  return [...c];
}

function splitOnTranslationForm(translation: string, word: Word, nativeLanguage: 'en' | 'zh'): { before: string; match: string; after: string } | null {
  if (nativeLanguage === 'zh') {
    const senses = (word.zh ?? '').split(/[／,]/).map(s => s.trim()).filter(Boolean);
    for (const sense of senses) {
      const idx = translation.indexOf(sense);
      if (idx !== -1) return { before: translation.slice(0, idx), match: translation.slice(idx, idx + sense.length), after: translation.slice(idx + sense.length) };
    }
    return null;
  }
  // Senses kept as WORD ARRAYS (not single strings) so a phrasal gloss
  // like "take care of" can match a contiguous multi-word run in the
  // translation too, not just a single token — a real gap before (only
  // the first word of a multi-word sense could ever match anything).
  const senses = word.en
    .split(/\s*\/\s*|,/)
    .map(s => s.trim().replace(/^to\s+/i, '').toLowerCase())
    .filter(Boolean)
    .map(s => s.split(/\s+/));
  const maxPhraseLen = senses.reduce((m, s) => Math.max(m, s.length), 1);

  const tokens = tokenize(translation);
  const offsets: number[] = [];
  { let o = 0; for (const t of tokens) { offsets.push(o); o += t.length; } }
  const wordIdxs = tokens.map((t, i) => (isWordToken(t) ? i : -1)).filter(i => i !== -1);

  // Longest phrase first at each position (so "take care of" wins over
  // just "take" when both could match), scanning left to right so the
  // FIRST occurrence in the sentence is what gets highlighted.
  for (let start = 0; start < wordIdxs.length; start++) {
    for (let len = Math.min(maxPhraseLen, wordIdxs.length - start); len >= 1; len--) {
      const idxSlice = wordIdxs.slice(start, start + len);
      const candidateSets = idxSlice.map(i => englishLemmaCandidates(tokens[i]));
      const matched = senses.find(sense => sense.length === len && sense.every((w, k) => candidateSets[k].includes(w)));
      if (matched) {
        const startOffset = offsets[idxSlice[0]];
        const lastIdx = idxSlice[idxSlice.length - 1];
        const endOffset = offsets[lastIdx] + tokens[lastIdx].length;
        return { before: translation.slice(0, startOffset), match: translation.slice(startOffset, endOffset), after: translation.slice(endOffset) };
      }
    }
  }
  return null;
}

// Splits into alternating word / non-word (whitespace, punctuation) tokens,
// covering German letters (umlauts, ß) as "word" characters.
function tokenize(s: string): string[] {
  return s.match(/[A-Za-zÀ-ÖØ-öø-ÿß']+|[^A-Za-zÀ-ÖØ-öø-ÿß']+/g) ?? [];
}

function isWordToken(t: string): boolean {
  return /[A-Za-zÀ-ÖØ-öø-ÿß]/.test(t);
}

// A render-ready span for the PROMPT sentence's Chinese path: same shape
// as ChineseClickSpan (see lib/words.ts), plus an optional `gloss` for a
// word segmentChineseForClicks didn't recognize as a corpus entry, but
// promptGlosses (an AI call over this exact sentence — see the effect
// above) did. segmentChineseForClicks already merges every unmatched
// stretch into one plain-text span (punctuation and non-corpus words
// alike) rather than one span per character — this walks each of THOSE
// spans a second time, greedily matching the LONGEST promptGlosses key at
// each position (glosses' own keys are already exact substrings of this
// specific sentence, so this never mis-segments the way matching against
// a huge global term list could). A corpus match (span.word already set)
// always wins outright and is never touched — this only ever fills in the
// gaps a corpus lookup left as plain, unclickable text.
interface GlossSpan { text: string; word?: Word; gloss?: WordGloss }
function applyGlossFallback(spans: { text: string; word?: Word }[], glosses: Record<string, WordGloss>): GlossSpan[] {
  const keys = Object.keys(glosses).sort((a, b) => [...b].length - [...a].length);
  if (keys.length === 0) return spans;
  const out: GlossSpan[] = [];
  for (const span of spans) {
    if (span.word) { out.push(span); continue; }
    const chars = [...span.text];
    let i = 0;
    while (i < chars.length) {
      const matchedKey = keys.find(key => {
        const klen = [...key].length;
        return klen > 0 && i + klen <= chars.length && chars.slice(i, i + klen).join('') === key;
      });
      if (matchedKey) {
        out.push({ text: matchedKey, gloss: glosses[matchedKey] });
        i += [...matchedKey].length;
      } else {
        const prev = out[out.length - 1];
        if (prev && !prev.word && !prev.gloss) prev.text += chars[i];
        else out.push({ text: chars[i] });
        i += 1;
      }
    }
  }
  return out;
}

// Word-level LCS diff (order-preserving, allows insertions/substitutions/
// deletions) — case-sensitive on purpose, since German capitalization is
// a real grammar rule (every noun, not just sentence starts), not
// cosmetic. Returns one boolean per correctedWords entry: true = matched
// something the learner actually wrote, in the same relative order; false
// = added or changed by the correction. Standard LCS-table + forward
// backtrack; the dp[i][j] === dp[i+1][j+1]+1 check on a match is what
// keeps the backtrack from greedily accepting a coincidental equal word
// that isn't actually part of the optimal alignment.
function diffWords(originalWords: string[], correctedWords: string[]): boolean[] {
  const n = originalWords.length, m = correctedWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = originalWords[i] === correctedWords[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (originalWords[i] === correctedWords[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      matched[j] = true;
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

// Compares a learner's raw attempt against the AI's corrected sentence,
// word by word — "Perfect" (no correction actually needed) vs. which
// specific corrected words are new/changed relative to what they wrote,
// so the UI can underline just those instead of the whole sentence.
// Trailing terminal punctuation is ignored on the ORIGINAL side only —
// correct-sentence's own prompt always adds proper end punctuation even
// when the learner's attempt omitted it (a real instruction, not a bug),
// so penalizing that here would make "Perfect" nearly unreachable for
// anyone who doesn't bother typing a period.
function diffAgainstAttempt(originalAttempt: string, correctedSentence: string): { perfect: boolean; tokens: { text: string; changed: boolean }[] } {
  const strippedOriginal = originalAttempt.trim().replace(/[.!?]+$/, '').trim();
  const originalWords = tokenize(strippedOriginal).filter(isWordToken);
  const correctedTokens = tokenize(correctedSentence);
  const correctedWordIndices: number[] = [];
  correctedTokens.forEach((t, idx) => { if (isWordToken(t)) correctedWordIndices.push(idx); });
  const correctedWords = correctedWordIndices.map(idx => correctedTokens[idx]);
  const matched = diffWords(originalWords, correctedWords);
  const perfect = matched.length > 0 && originalWords.length === correctedWords.length && matched.every(Boolean);
  const changedByTokenIdx = new Set(correctedWordIndices.filter((_, wi) => !matched[wi]));
  const tokens = correctedTokens.map((text, idx) => ({ text, changed: changedByTokenIdx.has(idx) }));
  return { perfect, tokens };
}


// How many of the 4 lifetime milestones (Learn, 1st/2nd/3rd review) a word
// has actually, permanently earned — read straight from its saved
// mascotStage/fullyMastered, so this is always live/accurate (in
// particular: it flips up the instant a milestone pass is saved, while
// the "✓ Correct!" banner is still showing, not just once the NEXT word
// loads).
function chunksEarned(mascotStage: MascotStageId | undefined, fullyMastered: boolean): 0 | 1 | 2 | 3 | 4 {
  if (fullyMastered || mascotStage === 'long-crowned') return 4;
  if (mascotStage === 'medium') return 3;
  if (mascotStage === 'short') return 2;
  if (mascotStage === 'puppy') return 1;
  return 0;
}

// Which of the 4 lifetime-milestone chunks TODAY's episode is working
// toward, keyed off the word's mascot stage rather than which rounds that
// stage's REVIEW_PLAN entry happens to span. Used to be `roundRange[0]`
// (a milestone's startRound), back when every milestone had a distinct
// startRound (1/2/3/4) so it could double as a chunk index for free. That
// stopped being true once puppy- and short-stage reviews were eased to
// share the same round span (2-3) — two different milestones with the
// same startRound made roundRange[0] ambiguous. This is just
// chunksEarned(stage, false) + 1: "the chunk right after whatever's
// already permanently earned", which is exactly "today's target" and
// stays correct regardless of how round spans overlap.
function chunkForStage(mascotStage: MascotStageId | undefined): 1 | 2 | 3 | 4 {
  return (Math.min(4, chunksEarned(mascotStage, false) + 1)) as 1 | 2 | 3 | 4;
}

// Always-4-chunk progress bar — one per lifetime milestone (Learn, 1st/
// 2nd/3rd review), not per round-within-today's-episode like the old dot
// row (which showed a DIFFERENT NUMBER of dots depending on the word's
// stage — 2 for a fresh word, 1 for a medium-stage review — the exact
// inconsistency that made it hard to tell at a glance which stage a word
// was actually at). `activeChunk` (see chunkForStage) is today's target
// chunk UNLESS it's already been earned (chunksEarned already covers it —
// reading live progress rather than inferring purely from the stage this
// episode started at is what makes the just-answered chunk actually turn
// green instead of staying amber until the next word loads). A wrong
// answer/hint never changes which milestone is being worked toward, only
// where currentRound sits within its round span, so exactly one chunk is
// ever "today's target" at a time — never two.
function MilestoneBar({ activeChunk, wordId }: { activeChunk: 1 | 2 | 3 | 4; wordId: string }) {
  const progress = getWordProgress(wordId);
  const earned = chunksEarned(progress.mascotStage, progress.fullyMastered);
  return (
    <div className="flex gap-1.5">
      {([1, 2, 3, 4] as const).map(chunk => (
        <div
          key={chunk}
          className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
            chunk <= earned ? 'bg-emerald-400'
              : chunk === activeChunk ? 'bg-amber-400'
                : 'bg-indigo-100'
          }`}
        />
      ))}
    </div>
  );
}

// The card header's own label — one name per chunk of the MilestoneBar
// below it (see chunksEarned/chunkForStage), not per individual round.
// Round 1 and round 2 both belong to chunk 1 (Day 1) despite being
// visibly different exercises (write a sentence, then spell it
// half-hinted); showing "Round 1"/"Round 2" text alongside a bar that
// only has ONE chunk for both was confusing (looked like there were more
// stages than the bar actually has). Keyed by the same 1-4 chunk index as
// MilestoneBar's activeChunk — see chunkForStage for why that's no longer
// just a round number.
const CHUNK_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'New',
  2: '1st review',
  3: '2nd review',
  4: '3rd review',
};

export type RoundMode = 'study' | 'review';

// A read-only snapshot of one just-answered round card, kept purely so the
// learner can page back and glance at what they just did (e.g. re-read a
// correction) — never re-editable, never re-scored. sentence is set only
// for a round-1 translate-mode pass; every other round (copy-the-word,
// typing rounds 2-4, review) shows the plain correct/incorrect banner
// instead, keyed off word.de/word.article like the live card does.
interface CardSnapshot {
  word: Word;
  roundMode: RoundMode;
  round: Round;
  roundRange: [Round, Round];
  // Captured alongside roundRange at episode-load time (see chunkForStage)
  // — the header label/MilestoneBar this snapshot replays need to show
  // whichever milestone THIS episode was actually working toward, not
  // whatever the word's live progress says now (which may have since
  // advanced past it).
  activeChunk: 1 | 2 | 3 | 4;
  wordStatus: 'New' | 'Continuing' | 'Review';
  correct: boolean;
  // isDirect marks a sentence-writing-mode-OFF round (see directSentence) —
  // there's no real translate-and-correct interaction behind it, just a
  // fetched reference sentence alongside a copy-the-word pass, so the
  // history replay below shows it that way instead of as a translate/
  // correction card.
  sentence?: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; userInput: string; isDirect?: boolean } | null;
  // The round 2+/review context sentence actually shown live (see the
  // parent's currentRound > 1 block) — captured at answer time so
  // reopening this exact card via "Previous" shows precisely what was on
  // screen then, not whatever the word's live saved sentence happens to
  // be now (only ever different if a LATER round for this same word, or a
  // future day, overwrote it — rare, but the live state and "what this
  // historical round actually looked like" aren't guaranteed to match).
  contextSentence?: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string } | null;
}

// Round 1 (translation exercise, all non-bootstrap words — see
// isBootstrapCopyWord): the AI generates an English sentence built only
// from vocabulary the learner already knows (lib/practice.ts's
// getKnownVocabulary) plus the new word, the learner translates it into
// German, and a second AI call corrects their OWN translation attempt
// (preserving their word choices/approach, not substituting an independent
// translation — see correct-sentence's prompt). The corrected translation
// becomes the word's permanent example sentence (shown on Word List, but
// not during later spelling rounds — reading it there doesn't actually
// help recall a word's spelling). Available whether signed in or not
// (during this early testing phase — see correct-sentence/generate-
// sentence, which rate-limit anonymous callers by IP instead of by
// user_id when there's no session to log usage against).
// Plural (nouns) / conjugation forms (verbs) — the same small caption
// used under a word's headline wherever it's shown at full size:
// SentenceWordHeader (round 1), the round-1-fallback "Copy this word"
// header, and now also the post-Check reveal on every later spelling
// round (see the parent's feedback!==null branch), so a learner isn't
// only ever shown this once, on day 1, and never again.
// Short tag for every word type that isn't a noun/verb (those two get
// their own richer line below instead — plural, or full conjugation).
// Confirmed real: a learner only ever saw a grammar note for nouns/verbs;
// every other word type (by far the minority of the corpus, but still a
// few hundred words) showed nothing at all here.
const WORD_TYPE_LABEL: Partial<Record<WordType, string>> = {
  adjective: 'Adjective',
  adverb: 'Adverb',
  preposition: 'Preposition',
  conjunction: 'Conjunction',
  phrase: 'Phrase',
};

function WordGrammarInfo({ word }: { word: Word }) {
  // Centered — this used to inherit whatever alignment its parent
  // happened to set (fine in the two ORIGINAL spots that were already
  // text-center containers, but left-aligned once also placed inside the
  // round 2+/review context block, which isn't).
  const cls = 'text-xs text-stone-400 mt-0.5 text-center';
  if (word.type === 'noun') {
    // Plural only shows when the corpus actually has one (a handful of
    // nouns — e.g. uncountable ones — are stored with an empty plural on
    // purpose); still tagged as a noun either way rather than showing
    // nothing for those.
    return <div className={cls}>{word.plural ? `Plural: die ${word.plural}` : 'Noun'}</div>;
  }
  if (word.type === 'verb') {
    return (
      <div className={cls}>
        {word.thirdPerson && word.pastTense && word.perfectTense
          ? `Verb | ${word.thirdPerson}, ${word.pastTense}, ${word.perfectTense}`
          : 'Verb'}
      </div>
    );
  }
  const label = WORD_TYPE_LABEL[word.type];
  return label ? <div className={cls}>{label}</div> : null;
}

// SentenceWordHeader is shown above both the input step and the result step
// (see the parent's currentRound === 1 branch) so the word stays visible
// throughout — the correction lands on the same card instead of swapping to
// what reads as a different screen. No "New word" caption here: the
// New/Continuing/Review badge already at the top of the card says that.
function SentenceWordHeader({ word }: { word: Word }) {
  return (
    <div className="text-center -mt-1">
      <div className="text-2xl font-bold text-indigo-800 tracking-wide break-words">
        {word.article ? `${word.article} ` : ''}{word.de}{' '}
        <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
      </div>
      <WordGrammarInfo word={word} />
    </div>
  );
}

// Most words don't have a pre-generated illustration yet (see
// scripts/generate-bootstrap-images.py) — render nothing rather than a
// broken-image icon when the file 404s.
function RoundWordImage({ word }: { word: Word }) {
  const [failed, setFailed] = useState(false);
  // A new word swapping in should re-attempt a fresh <img> (and re-show it
  // if a previous word in this session had no image) rather than staying
  // permanently hidden from an earlier word's error.
  useEffect(() => setFailed(false), [word.id]);
  // WORDS_WITH_IMAGES (a build-time manifest of what's actually under
  // public/images/words/) is checked synchronously, before ever rendering
  // an <img> at all — this used to always reserve a w-24 h-24 box and let
  // a real 404 collapse it, which fixed an earlier layout-jump bug but
  // traded it for a permanent blank gap on every one of the (majority of)
  // words with no illustration. Knowing in advance means a word with no
  // image renders nothing here at all — no gap, no flash, no jump either
  // way. `failed` stays as a defensive fallback only, in case the
  // manifest and the actual files on disk ever drift out of sync.
  if (!WORDS_WITH_IMAGES.has(word.id) || failed) return null;
  return (
    <div className="w-24 h-24 mx-auto mb-1">
      {/* key={word.id} forces a fresh <img> element per word instead of
          just updating `src` on the same one — without it, a slow-loading
          new image left the PREVIOUS word's picture visibly on screen
          until the new one finished decoding (a real reported mix-up: the
          picture briefly didn't match the word/text already showing).
          Safe to just go blank in the meantime rather than keep the old
          one — the surrounding box is a fixed w-24 h-24 regardless of
          whether the image inside has loaded yet, so this never causes
          the word/spelling-tiles layout below to jump either way. */}
      <img
        key={word.id}
        src={imageUrlForWord(word)}
        alt=""
        className="w-full h-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function SentenceExercise({
  word, level, correction, onCorrected, onNext, onUnreachable, input, onInputChange,
}: {
  word: Word;
  level: Level;
  // Also owned by the parent, same as `correction` below (see its own
  // comment) — specifically so the learner's in-progress typed attempt
  // survives the sentence-writing-mode toggle, which unmounts this whole
  // component (see the parent's sentenceInput state for the full reasoning).
  input: string;
  onInputChange: (value: string) => void;
  // Owned by the parent (persists across this same render — see the
  // round-1 branch below, which no longer swaps to a separate result view
  // on correction, so the learner's own typed attempt stays visible
  // alongside the correction instead of disappearing).
  correction: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string } | null;
  // userInput (the learner's own typed attempt) rides along only for the
  // Back button's history snapshot — the parent keeps it separate from what
  // actually gets persisted to WordProgress.
  onCorrected: (correction: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string }, userInput: string) => void;
  onNext: () => void;
  // Called when either AI call fails with AIUnreachableError (a genuine
  // network-level failure to reach the Edge Function, not an ordinary API
  // error) — see the parent's handleAiUnreachable for what this does
  // (turns sentence-writing mode off going forward and auto-files a bug
  // report), so this component itself only needs to report the event up.
  onUnreachable: () => void;
}) {
  // Almost every word already has a pre-generated exercisePrompt baked into
  // lib/words.ts (see scripts/generate-exercise-prompts.py) — instant, no
  // AI wait at all for this step. generateSentence is only a live fallback
  // for the rare word missing one (e.g. added to the corpus after the last
  // batch run). SentenceExercise is remounted (key={word.id}) per word, so
  // these initializers are safe to read directly from the word prop.
  const [promptSentence, setPromptSentence] = useState<string | null>(word.exercisePrompt ?? null);
  // Chinese translation of promptSentence, for DISPLAY only — the AI calls
  // below (generateSentence's known-vocabulary constraint, correctSentence's
  // own understanding) always use the English promptSentence regardless of
  // nativeLanguage; this is purely what the learner sees on screen.
  const [promptSentenceZh, setPromptSentenceZh] = useState<string | null>(word.exercisePromptZh ?? null);
  const [promptStatus, setPromptStatus] = useState<'loading' | 'ready' | 'error' | 'limit-reached' | 'unreachable'>(word.exercisePrompt ? 'ready' : 'loading');
  const [promptRetry, setPromptRetry] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'limit-reached' | 'unreachable'>('idle');
  // The "Why?" button's own state — entirely separate from `status`
  // above (the main check), since asking for an explanation is optional
  // and happens after a correction already landed, never blocking or
  // replacing it.
  const [explanation, setExplanation] = useState<string[] | null>(null);
  const [explanationStatus, setExplanationStatus] = useState<'idle' | 'loading' | 'error' | 'limit-reached'>('idle');
  // Per-word lemma+translation for EVERY content word in the correction
  // (not just ones already in Spello's corpus) — fetched separately once
  // the correction lands (see the effect below), so it never delays the
  // correction itself. Keyed by the word exactly as it appears in
  // correction.sentence, matching resolveClickedWord's own token shape.
  const [glosses, setGlosses] = useState<Record<string, WordGloss>>({});
  // Same idea as `glosses` above, but for the PROMPT sentence (English/
  // Chinese, before the learner has translated it) — see the effect below
  // and findWordByEnglishForm/segmentChineseForClicks's own comments for
  // why a corpus-only lookup used to leave some prompt words permanently
  // unclickable (a real reported bug: "carefully" in a prompt sentence
  // wasn't in Spello's corpus at all, so tapping it did nothing). Keyed by
  // the word exactly as it appears in promptSentence/promptSentenceZh —
  // {lemma: German hint, gloss: that word's own base form}, same shape as
  // `glosses`, just built from the not-yet-translated sentence instead
  // (see getSentenceGlosses' direction param).
  const [promptGlosses, setPromptGlosses] = useState<Record<string, WordGloss>>({});
  // Which word in the corrected sentence the learner tapped (see the
  // clickable-word rendering below and WordInfoPanel) — cleared implicitly
  // on remount (this whole component is keyed by word.id) rather than
  // needing its own reset effect. selectedPromptWord is the same idea but
  // for the PROMPT sentence (a hint while still attempting the
  // translation) — kept as its own separate state so tapping a word in
  // one sentence never disturbs whatever's showing for the other.
  // selectedGlossToken is the fallback for a correction word that isn't a
  // real corpus entry (see GlossPopup below) — mutually exclusive with
  // selectedWord, since only one detail panel shows at a time.
  // selectedPromptGlossToken is that same fallback for the PROMPT sentence
  // (see promptGlosses above) — mutually exclusive with selectedPromptWord
  // the same way.
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [selectedGlossToken, setSelectedGlossToken] = useState<string | null>(null);
  const [selectedPromptWord, setSelectedPromptWord] = useState<Word | null>(null);
  const [selectedPromptGlossToken, setSelectedPromptGlossToken] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!correction) return;
    let cancelled = false;
    getSentenceGlosses(word.id, correction.sentence, level, getSettings().nativeLanguage)
      .then(words => { if (!cancelled) setGlosses(words); })
      // Best-effort — a failure here just means correction words stay
      // non-clickable (beyond whatever the corpus/heuristic chain below
      // already resolves), never a blocking error for the exercise itself.
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correction]);

  useEffect(() => {
    if (promptStatus !== 'ready' || !promptSentence) return;
    const nativeLanguage = getSettings().nativeLanguage;
    // Whichever sentence is actually ON SCREEN — the Chinese one when
    // that's the display language and it's actually available, English
    // otherwise (including a Chinese learner whose prompt has no zh
    // translation yet, which already falls back to English on screen —
    // see the render branch below).
    const sentenceOnScreen = nativeLanguage === 'zh' && promptSentenceZh ? promptSentenceZh : promptSentence;
    let cancelled = false;
    getSentenceGlosses(word.id, sentenceOnScreen, level, nativeLanguage, 'native-to-de')
      .then(words => { if (!cancelled) setPromptGlosses(words); })
      // Best-effort, same as the correction's own glosses effect above —
      // a failure just means prompt words stay non-clickable beyond
      // whatever the corpus lookup already resolves.
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptStatus, promptSentence, promptSentenceZh]);

  useEffect(() => {
    if (word.exercisePrompt) return;
    let cancelled = false;
    setPromptStatus('loading');
    generateSentence(word.id, word.de, word.en, level, getKnownVocabulary(level), getSettings().nativeLanguage)
      .then(({ sentence, sentenceZh }) => {
        if (cancelled) return;
        setPromptSentence(sentence);
        setPromptSentenceZh(sentenceZh ?? null);
        setPromptStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AIUnreachableError) { setPromptStatus('unreachable'); onUnreachable(); return; }
        setPromptStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id, promptRetry]);

  // The corrected sentence has no pre-recorded audio file of its own (unlike
  // single vocabulary words) — always the free on-device browser voice, same
  // as speakWord's own fallback path, so this costs no API/AI usage at all.
  // Cancelled on cleanup (word change, or this whole exercise unmounting) —
  // otherwise a still-queued utterance keeps playing after the learner has
  // already moved on to the next word or left the page entirely. On a
  // genuinely perfect translation, the chime plays first and the spoken
  // sentence is delayed a beat behind it (same reasoning as the
  // round-ladder's own chime-then-word sequencing) rather than both
  // firing at once.
  useEffect(() => {
    if (!correction) return;
    const diff = diffAgainstAttempt(input, correction.sentence);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (diff.perfect) {
      playCorrectChime();
      if (getSettings().autoPlayAudio) timer = setTimeout(() => speakText(correction.sentence), 550);
    } else if (getSettings().autoPlayAudio) {
      speakText(correction.sentence);
    }
    return () => { clearTimeout(timer); stopSpeech(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correction]);

  async function handleSubmit() {
    if (!input.trim() || status === 'loading' || !promptSentence) return;
    setStatus('loading');
    try {
      const result = await correctSentence(word.id, word.de, level, promptSentence, input.trim());
      // promptSentenceZh pairs with promptSentence here the same way it's
      // displayed above (corpus exercisePromptZh, or the live generateSentence
      // call's own sentenceZh) — saving it alongside is what lets a later
      // display of this exact sentence (Word List, the daily summary) show
      // Chinese consistently instead of falling back to English for
      // whichever words the corpus itself has no translation for.
      onCorrected({ sentence: result.sentence, wordForm: result.wordForm, englishPrompt: promptSentence, englishPromptZh: promptSentenceZh ?? undefined }, input.trim());
    } catch (e) {
      if (e instanceof AIUnreachableError) { setStatus('unreachable'); onUnreachable(); return; }
      setStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
    }
  }

  // Diffed against `input` (the learner's own raw attempt, still in local
  // state even after correction lands — see its own comment) rather than
  // re-deriving anything from the correction response itself, since the
  // AI never reports "was this already correct" explicitly (see
  // correct-sentence) — comparing what came back against what they
  // actually wrote is what tells us that.
  const correctionDiff = correction ? diffAgainstAttempt(input, correction.sentence) : null;
  // The chime for a genuinely perfect translation lives in the speakText
  // effect above (sequenced ahead of the spoken sentence), not a separate
  // effect here.

  // Not folded into onUnreachable/the parent's session-wide AI-unreachable
  // handling — this is a small optional extra on top of a correction that
  // already succeeded, so losing just this call shouldn't turn off
  // sentence-writing mode for the rest of the session the way losing an
  // actual correction does. A plain inline error is enough here.
  async function handleExplain() {
    if (!correction) return;
    setExplanationStatus('loading');
    try {
      // Cap how many grammar points come back at how many words actually
      // changed (see correctionDiff, above) — a correction that only
      // touched one or two words has at most one or two real grammar
      // points to make; asking for "up to 3" regardless used to pad out
      // trivial corrections with generic filler alongside the real point.
      const maxPoints = correctionDiff ? Math.max(1, correctionDiff.tokens.filter(t => t.changed).length) : undefined;
      const result = await explainCorrection(word.id, word.de, level, input, correction.sentence, getSettings().nativeLanguage, maxPoints);
      setExplanation(result);
      setExplanationStatus('idle');
    } catch (e) {
      setExplanationStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SentenceWordHeader word={word} />
      {promptStatus === 'loading' && (
        <p className="text-stone-500 text-sm text-center py-4">Preparing a sentence…</p>
      )}
      {promptStatus === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="text-red-600 text-sm text-center">Couldn't prepare a sentence — check your connection and try again.</p>
          <button
            onClick={() => setPromptRetry(k => k + 1)}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Retry
          </button>
        </div>
      )}
      {promptStatus === 'limit-reached' && (
        <p className="text-amber-700 text-sm text-center py-4">
          You've used up today's practice limit — come back tomorrow for more!
        </p>
      )}
      {promptStatus === 'unreachable' && (
        <p className="text-amber-700 text-sm text-center py-4">
          Can't reach our AI service right now (this can happen depending on your network) —
          switched off sentence-writing mode. You can turn it back on anytime in Settings.
        </p>
      )}
      {promptStatus === 'ready' && promptSentence && (
        <>
          <div className="bg-indigo-50 rounded-xl px-3 py-2 text-center">
            <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Translate to German</div>
            {/* No visual affordance otherwise marks which words are
                clickable (hover alone isn't discoverable on a touch
                screen, which this PWA mostly runs on) — a persistent,
                short reminder rather than a one-time tip, since there's
                nothing else teaching this. */}
            <p className="text-[11px] text-indigo-400/80 mb-1">Tip: tap a word for a hint</p>
            <div className="text-stone-700 italic">
              {/* Tap a word for a hint — its German dictionary-form
                  translation, regardless of this word's own tense/case
                  here ("reads" and "read" both just show "lesen"). English
                  goes through the same tokenize+lookup shape the corrected
                  sentence's own clickable words already use; Chinese has
                  no word boundaries to tokenize, so it's segmented as a
                  whole string instead (see segmentChineseForClicks). A
                  corpus match wins first either way; promptGlosses (an AI
                  lookup over this exact sentence, applyGlossFallback
                  above) fills in every OTHER content word so a prompt
                  word being clickable never depends on it happening to
                  already be a Spello corpus entry — confirmed real: a
                  learner couldn't tap "carefully" in a prompt sentence at
                  all before this, since it was never anyone's corpus
                  word, so they just left it untranslated (see
                  correct-sentence's own comment on catching that). A pure
                  grammar word (the/a, 的/了/吗) still stays plain, since
                  the AI is told to skip those the same way the corpus
                  lookup always did. */}
              {getSettings().nativeLanguage === 'zh' && promptSentenceZh
                ? applyGlossFallback(segmentChineseForClicks(promptSentenceZh, word), promptGlosses).map((span, i) => {
                  if (span.word) {
                    return (
                      <button
                        key={i}
                        type="button"
                        // Clicking the already-selected word again hides its
                        // hint instead of just re-showing the same panel.
                        onClick={() => { setSelectedPromptGlossToken(null); setSelectedPromptWord(prev => (prev?.id === span.word!.id ? null : span.word!)); }}
                        className="hover:bg-indigo-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                      >
                        {span.text}
                      </button>
                    );
                  }
                  if (span.gloss) {
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setSelectedPromptWord(null); setSelectedPromptGlossToken(prev => (prev === span.text ? null : span.text)); }}
                        className="hover:bg-indigo-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                      >
                        {span.text}
                      </button>
                    );
                  }
                  return <span key={i}>{span.text}</span>;
                })
                : tokenize(promptSentence).map((text, i) => {
                  const match = /[A-Za-z]/.test(text) ? findWordByEnglishForm(text, word) : undefined;
                  const gloss = !match ? promptGlosses[text] : undefined;
                  if (match) {
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setSelectedPromptGlossToken(null); setSelectedPromptWord(prev => (prev?.id === match.id ? null : match)); }}
                        className="hover:bg-indigo-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                      >
                        {text}
                      </button>
                    );
                  }
                  if (gloss) {
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setSelectedPromptWord(null); setSelectedPromptGlossToken(prev => (prev === text ? null : text)); }}
                        className="hover:bg-indigo-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                      >
                        {text}
                      </button>
                    );
                  }
                  return <span key={i}>{text}</span>;
                })}
            </div>
          </div>
          {selectedPromptWord && <WordInfoPanel key={`prompt-${selectedPromptWord.id}`} word={selectedPromptWord} />}
          {!selectedPromptWord && selectedPromptGlossToken && promptGlosses[selectedPromptGlossToken] && (
            <GlossPopup
              key={`prompt-gloss-${selectedPromptGlossToken}`}
              surfaceForm={selectedPromptGlossToken}
              lemma={promptGlosses[selectedPromptGlossToken].lemma}
              gloss={promptGlosses[selectedPromptGlossToken].gloss}
            />
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!correction) handleSubmit();
              }
            }}
            disabled={status === 'loading' || status === 'limit-reached' || !!correction}
            placeholder="Your best attempt is fine — mixing in English is OK too."
            rows={2}
            className="w-full border-2 border-indigo-100 rounded-xl px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-300 resize-none disabled:opacity-60"
          />
          {/* No German keyboard on hand? There's no web API to switch the
              OS's on-screen keyboard layout — this row of ä/ö/ü/ß buttons
              is the actual, working fix (see SpecialCharButtons). Hidden
              once corrected, same as the textarea being disabled then. */}
          {!correction && <SpecialCharButtons inputRef={textareaRef} />}
          {status === 'error' && (
            <p className="text-red-600 text-sm text-center">Couldn't get a correction — check your connection and try again.</p>
          )}
          {status === 'limit-reached' && (
            <p className="text-amber-700 text-sm text-center">
              You've used up today's practice limit — come back tomorrow for more!
            </p>
          )}
          {status === 'unreachable' && (
            <p className="text-amber-700 text-sm text-center">
              Can't reach our AI service right now (this can happen depending on your network) —
              switched off sentence-writing mode. You can turn it back on anytime in Settings.
            </p>
          )}
          {correction && correctionDiff ? (
            <>
              <div className="relative text-center py-3 rounded-xl font-semibold bg-green-50 border border-green-200 px-4">
                {/* Upper-right corner of the panel, not inline with the
                    rest of the content — a grammar explanation is a
                    secondary, optional action on top of the correction,
                    not part of reading it. Nothing to explain when there
                    was no correction needed at all. */}
                {!correctionDiff.perfect && !explanation && (
                  <button
                    type="button"
                    onClick={handleExplain}
                    disabled={explanationStatus === 'loading'}
                    aria-label="Explain the grammar"
                    className="absolute top-2 right-2 text-indigo-500 text-xs font-semibold bg-white/70 hover:bg-white hover:text-indigo-700 rounded-full px-2 py-0.5 transition-colors disabled:opacity-50"
                  >
                    {explanationStatus === 'loading' ? '…' : 'Why?'}
                  </button>
                )}
                <div className="text-xs uppercase tracking-wide text-green-600 mb-1 font-medium flex items-center justify-center gap-1.5">
                  {correctionDiff.perfect ? '✓ Perfect!' : 'Correction'}
                  <TextSpeakerButton text={correction.sentence} className="text-green-500 hover:text-green-700 transition-colors normal-case" />
                </div>
                <div className="text-lg text-green-800">
                  {correctionDiff.tokens.map(({ text, changed }, i) => {
                    // Every token is already either a whole word or a whole
                    // non-word (punctuation/whitespace) run — see tokenize's
                    // regex — so there's no need to re-split; just check
                    // whether THIS one looks up to a dictionary word at all.
                    // See resolveClickedWord for the full resolution chain
                    // (AI lemma -> heuristic -> separable-prefix repair).
                    // The AI lemma map now comes from `glosses` (fetched
                    // separately, see the effect above) rather than riding
                    // along on the correction itself — that's what lets the
                    // main correction render fast. A word not resolved
                    // against the corpus at all still gets a gloss fallback
                    // below, so EVERY content word ends up clickable, not
                    // just ones already in Spello's own vocabulary.
                    // `changed` (from diffAgainstAttempt, above) underlines
                    // specifically the words that differ from what the
                    // learner actually wrote — independent of whether it's
                    // also clickable, so a wrong word stays both lookup-able
                    // and visibly flagged.
                    const lemmaMap = Object.fromEntries(Object.entries(glosses).map(([k, v]) => [k, v.lemma]));
                    const match = isWordToken(text)
                      ? resolveClickedWord(text, lemmaMap, word.de)
                      : undefined;
                    const gloss = !match ? glosses[text] : undefined;
                    // Purple reads as a calm "this changed" flag against the
                    // green correction box — amber (and red, tried earlier)
                    // both looked alarming/urgent here, which isn't the tone
                    // a correction should have.
                    const underline = changed ? ' underline decoration-violet-500 decoration-2 underline-offset-2' : '';
                    if (match) {
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setSelectedGlossToken(null); setSelectedWord(prev => (prev?.id === match.id ? null : match)); }}
                          className={`hover:bg-green-200/70 rounded px-0.5 -mx-0.5 transition-colors${underline}`}
                        >
                          {text}
                        </button>
                      );
                    }
                    if (gloss) {
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setSelectedWord(null); setSelectedGlossToken(prev => (prev === text ? null : text)); }}
                          className={`hover:bg-green-200/70 rounded px-0.5 -mx-0.5 transition-colors${underline}`}
                        >
                          {text}
                        </button>
                      );
                    }
                    return <span key={i} className={underline}>{text}</span>;
                  })}
                </div>
              </div>
              {!correctionDiff.perfect && explanation && (
                <ul className="list-disc pl-5 flex flex-col gap-1 -mt-2 bg-indigo-50 rounded-lg px-4 py-2 text-sm text-indigo-800">
                  {explanation.map((point, i) => <li key={i}>{point}</li>)}
                </ul>
              )}
              {!correctionDiff.perfect && explanationStatus === 'error' && (
                <p className="text-red-500 text-xs -mt-2">Couldn't load an explanation — try again.</p>
              )}
              {!correctionDiff.perfect && explanationStatus === 'limit-reached' && (
                <p className="text-amber-600 text-xs -mt-2">Used up today's practice limit — come back tomorrow.</p>
              )}
              {selectedWord && <WordInfoPanel key={selectedWord.id} word={selectedWord} />}
              {!selectedWord && selectedGlossToken && glosses[selectedGlossToken] && (
                <GlossPopup surfaceForm={selectedGlossToken} lemma={glosses[selectedGlossToken].lemma} gloss={glosses[selectedGlossToken].gloss} />
              )}
              <button
                onClick={onNext}
                className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Next →
              </button>
            </>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || status === 'loading' || status === 'limit-reached'}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
            >
              {status === 'loading' ? 'Checking…' : 'Check'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Shows a correct example sentence with the target word called out in bold
// — used for round 1's copy-mode reference (sentence writing mode off, or
// the history replay of one of those rounds), and now also round 2+/
// review's own context sentence (see the parent's currentRound > 1
// branch). wordForm is the exact inflected substring the AI reported
// using, so the bolding (or the blank, when masked) lines up with however
// the word actually appears in the sentence (which may differ from its
// dictionary form, e.g. plural/case endings).
//
// masked (round 2+/review's pre-Check state only): swaps the target word
// for a plain blank instead of bolding it — the whole point of showing
// context here is the SENTENCE, not a second free look at the spelling
// mid-attempt, which would just hand the learner the answer they're
// supposed to be recalling unaided. A fixed-width blank rather than one
// sized to the word's own length, so it doesn't leak letter-count as an
// extra hint on top of whatever the letter-tiles already show. Revealed
// (masked=false) the instant Check is pressed, same moment the tiles
// themselves reveal right/wrong.
function ReferenceSentence({ example, word, masked = false }: {
  example: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string };
  // Optional purely for the translation fallback below — a saved
  // exampleSentence from before englishPrompt/englishPromptZh existed as
  // fields at all has neither, which used to just silently show the
  // German sentence with no translation underneath it (confirmed real:
  // "sometimes only the German sentence is shown"). Falling back to the
  // corpus's own pre-baked exercisePrompt/exercisePromptZh (the same
  // fallback chain the history/"Back" view already uses elsewhere in this
  // file) recovers a translation for that case; still nothing to show
  // for the rare word with neither.
  word?: Word;
  masked?: boolean;
}) {
  const parts = splitOnWordForm(example.sentence, example.wordForm);
  // englishPrompt/englishPromptZh is literally what this German sentence
  // translates (see correctSentence's own contract) — the same meaning,
  // just not re-fetched as a separate "translate this back" call. Shown
  // beneath so copy-mode (no writing exercise, so this is the learner's
  // only look at what the sentence actually means) isn't just an opaque
  // German string to memorize.
  const nativeLanguage = getSettings().nativeLanguage;
  const translation = nativeLanguage === 'zh'
    ? (example.englishPromptZh ?? word?.exercisePromptZh ?? example.englishPrompt)
    : (example.englishPrompt ?? word?.exercisePrompt);
  // Bold the target word's own gloss inside the translation too, same
  // spirit as bolding wordForm in the German sentence above — needs the
  // actual Word (for its en/zh gloss), so this stays null (plain,
  // unbolded translation) for the one call site that doesn't pass one.
  const translationParts = translation && word ? splitOnTranslationForm(translation, word, nativeLanguage) : null;
  return (
    <div className="text-center bg-indigo-50 rounded-xl px-3 py-2">
      {/* No "Example sentence"/"In context" label any more — confirmed
          real feedback that it read as clutter once the sentence itself
          was already doing that job. The speaker button now sits inline
          at the END of the German sentence instead of its own header row
          above it — confirmed real that the old row-above placement took
          up a lot of vertical space for a single icon. */}
      <div className="text-stone-700 italic">
        {parts ? (
          <>
            {parts.before}
            {masked ? (
              <span className="inline-block px-2 rounded bg-indigo-200/70 text-transparent select-none not-italic" aria-hidden>
                ____
              </span>
            ) : (
              <span className="font-bold text-indigo-700 not-italic">{parts.match}</span>
            )}
            {parts.after}
          </>
        ) : example.sentence}
        {' '}
        <TextSpeakerButton text={example.sentence} className="text-indigo-400 hover:text-indigo-600 transition-colors align-middle not-italic" />
      </div>
      {translation && (
        <div className="text-stone-500 text-sm mt-1">
          {translationParts ? (
            <>
              {translationParts.before}
              <span className="font-bold text-indigo-700">{translationParts.match}</span>
              {translationParts.after}
            </>
          ) : translation}
        </div>
      )}
    </div>
  );
}

export function isRoundsDone(id: string, mode: RoundMode): boolean {
  const p = getWordProgress(id);
  if (mode === 'study') return !!p.mascotStage;
  return p.fullyMastered || !!(p.nextReviewDue && p.nextReviewDue > today());
}

export default function DailySessionFlow() {
  const router = useRouter();
  const [session, setSession] = useState<DailySession | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);

  const [queue, setQueue] = useState<Word[]>([]);
  const [totalWords, setTotalWords] = useState(0);
  const reviewRoundsRef = useRef<Record<string, Round>>({});

  const [currentRound, setCurrentRound] = useState<Round>(1);
  // Which rounds this specific card's episode actually spans — Day-1 study
  // is always rounds 1-2 (sentence, then half-hinted spelling); a review
  // episode's range depends on the word's CURRENT mascot stage (see
  // REVIEW_PLAN): puppy-stage and short-stage reviews both run 2-3
  // (half-hint then first-letter-hint — the 2nd review repeats the 1st's
  // difficulty on purpose, easing the ramp), and medium-stage runs 3-4
  // (first-letter-hint then a final no-hint round). The round dots below
  // render only this range, not a fixed 4, since most episodes never
  // touch rounds outside it.
  const [roundRange, setRoundRange] = useState<[Round, Round]>([1, 2]);
  // Which of the 4 lifetime-milestone chunks this episode targets — see
  // chunkForStage. Set alongside roundRange in loadCurrent, from the same
  // stage read, but kept as its own piece of state rather than derived
  // from roundRange[0] since puppy- and short-stage reviews now share a
  // round span (see REVIEW_PLAN) and are no longer distinguishable that way.
  const [activeChunk, setActiveChunk] = useState<1 | 2 | 3 | 4>(1);
  const [hint, setHint] = useState<boolean[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [articleValues, setArticleValues] = useState<string[]>(['', '', '']);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);

  // Bumped on every matching-quiz page completion so MatchingQuizPage always
  // remounts fresh for the next page.
  const [matchingPageKey, setMatchingPageKey] = useState(0);
  const [mcqCurrent, setMcqCurrent] = useState<{ word: Word; correct: string; choices: string[] } | null>(null);
  // The current word's saved example sentence, if it already has one from
  // a previous round-1 pass — gates which round-1 UI shows, AND (now) is
  // also shown as context on every round 2+/review card too (see the
  // parent's currentRound > 1 branch and ReferenceSentence's own masked
  // prop). Typed with the full translation fields (not just sentence/
  // wordForm) specifically so that reuse doesn't need a second, separate
  // read of the same saved data. The just-produced correction for the
  // round-1 sentence exercise is a separate piece of state (sentenceResult,
  // below) shown in place of the generic "✓ Correct!" banner.
  const [exampleSentence, setExampleSentence] = useState<{ sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string } | null>(null);
  const [sentenceResult, setSentenceResult] = useState<{ sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string } | null>(null);
  // The learner's in-progress typed attempt, lifted up here (rather than
  // living only as SentenceExercise's own local state) specifically so it
  // survives the sentence-writing-mode toggle: that switch changes which
  // branch renders below, unmounting SentenceExercise entirely, and a
  // component's local state doesn't survive its own unmount. Reset to ''
  // whenever the word changes (see the effect below) so it doesn't leak
  // into the next word's exercise.
  const [sentenceInput, setSentenceInput] = useState('');
  // Sentence-writing-mode OFF (Settings): a correct example sentence
  // fetched directly, with no user attempt involved, shown as reference
  // alongside the copy-the-word tiles below instead of SentenceExercise's
  // translate-and-correct flow. Non-blocking — if the fetch fails, the
  // copy-the-word interaction still proceeds, just without a sentence
  // saved for this word today (same as any other bootstrap-style word).
  const [directSentence, setDirectSentence] = useState<{ sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string } | null>(null);
  const [directSentenceStatus, setDirectSentenceStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unreachable'>('idle');
  // Set the first time any AI call fails with AIUnreachableError (a real
  // network-level failure to reach the Edge Function — see lib/ai.ts) —
  // once true, both useDirectSentence and the round-1 sentence-exercise
  // branch below stop attempting further AI calls for the rest of this
  // session (there's no reason to expect the very next one to succeed
  // when the underlying cause is "can't reach Supabase from here" — that
  // won't have changed a few seconds later), falling back to the plain
  // copy-the-word tiles instead. Reset on a fresh page load, since that's
  // a reasonable point to let it try again.
  const [aiUnreachable, setAiUnreachable] = useState(false);
  // "Review" = already fully learned, back for spaced repetition. "New" =
  // never touched before today. "Continuing" = mid-ladder from a PREVIOUS
  // day (not brand new, hasn't reached round 4 yet either) — this is the
  // one that looks confusingly like "new" without a label, since it still
  // shows up in the study queue and can start anywhere from round 2-4.
  const [wordStatus, setWordStatus] = useState<'New' | 'Continuing' | 'Review'>('New');
  // Choices already shown per word this round-1.5 pass, in-memory only (a
  // retry within the redo loop should get fresh distractors; losing this on
  // a reload is a harmless cosmetic detail, not a correctness issue).
  const mcqSeenRef = useRef<Record<string, string[]>>({});
  const [showCongrats, setShowCongrats] = useState(false);
  // Snapshotted once, the moment the congrats phase is entered (see the
  // effect below) — NOT re-read fresh on every render. getDailyStats()
  // resets to zero the instant its own `date` no longer matches today()
  // (a real, correct reset for a genuinely new calendar day), but the
  // congrats card can render some time after the session that earned
  // these numbers actually finished (the user closing/reopening the tab,
  // or simply still being on screen right as a midnight rollover
  // happens) — re-fetching at render time meant a late-night session
  // could finish, and by the time this modal actually painted, the day
  // had already turned over, showing "0 reviewed" for a session that
  // very much wasn't zero. Capturing it once at phase-entry means the
  // card always reflects what was actually just accomplished.
  const [congratsStats, setCongratsStats] = useState<DailyStats | null>(null);
  const [showSignInNudge, setShowSignInNudge] = useState(false);
  const [showAiUnlockCelebration, setShowAiUnlockCelebration] = useState(false);

  // Dev/design preview: /practice/?previewSignInNudge=1 or
  // ?previewAiUnlock=1 show the matching one-off card immediately, without
  // needing to actually reach the real trigger (sign out and finish a
  // day's goal; or reach A1 word #221) to check how it looks. Plain
  // window.location (not Next's useSearchParams) specifically to avoid the
  // Suspense-boundary requirement that hook needs under `output: 'export'`,
  // for a debug-only one-liner that doesn't need it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('previewSignInNudge') === '1') setShowSignInNudge(true);
    if (params.get('previewAiUnlock') === '1') setShowAiUnlockCelebration(true);
  }, []);

  // Every answered round card this session (study or review), oldest first
  // — purely a "peek backward" log for the Back button below; never
  // touches scoring/progress, which is already committed the moment
  // submitResult runs. historyIndex === null means showing the live,
  // still-in-progress card; otherwise showing cardHistory[historyIndex]
  // read-only.
  const [cardHistory, setCardHistory] = useState<CardSnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const letterRowRef = useRef<LetterInputRowHandle | null>(null);
  const articleRowRef = useRef<LetterInputRowHandle | null>(null);
  const handleNextRef = useRef<() => void>(() => {});

  const roundMode: RoundMode = session?.phase === 'review-rounds' ? 'review' : 'study';
  const word = queue[0] ?? null;
  const needsArticle = !!(settings?.requireArticle && word?.type === 'noun' && word?.article);
  // Same gating reasons as the copy-the-word fallback below (see its own
  // comment) PLUS sentence writing mode being explicitly off — a word
  // that's already bootstrap/demoted doesn't need a fetched reference
  // sentence layered on top of its own handling.
  const useDirectSentence = !!word && currentRound === 1 && roundMode === 'study'
    && !isBootstrapCopyWord(word) && !exampleSentence && settings?.sentenceWritingMode === false && !aiUnreachable;
  // Same gating as useDirectSentence, minus the sentenceWritingMode check
  // itself — this is the corner toggle that flips that very setting, so it
  // needs to show on round 1 of a genuine new-word study card regardless of
  // which side of the setting it's currently on (sentence-writing view or
  // the copy-mode/reference-sentence view), but nowhere else (not on
  // rounds 2-4, review rounds, or bootstrap-copy words).
  const showSentenceModeToggle = !!word && currentRound === 1 && roundMode === 'study'
    && !isBootstrapCopyWord(word) && !exampleSentence;

  // Fires once: the first time an A1 learner's round 1 lands on a genuine
  // new word that ISN'T one of the ~220 bootstrap words — same shape as
  // showSentenceModeToggle's own gate above, plus the level check and the
  // hasSeenAiUnlockCelebration flag that keeps this from ever firing again
  // once it has (set by handleCloseAiUnlockCelebration below). Naturally
  // won't re-fire while the celebration is already showing (its own
  // top-level render check takes over first), or after dismissal, since
  // the flag flips to true immediately on close.
  useEffect(() => {
    if (!settings || settings.level !== 'A1' || settings.hasSeenAiUnlockCelebration) return;
    if (!word || currentRound !== 1 || roundMode !== 'study') return;
    if (isBootstrapCopyWord(word) || exampleSentence) return;
    setShowAiUnlockCelebration(true);
  }, [settings, word, currentRound, roundMode, exampleSentence]);

  function handleCloseAiUnlockCelebration() {
    setShowAiUnlockCelebration(false);
    if (settings) {
      const next = { ...settings, hasSeenAiUnlockCelebration: true };
      saveSettings(next);
      setSettings(next);
      scheduleSync();
    }
  }

  function persistSession(next: DailySession) {
    setSession(next);
    saveDailySession(next);
  }

  // Fired the first time any AI call this session fails with
  // AIUnreachableError. Two things, both best-effort: turns off sentence-
  // writing mode going forward (persisted, not just for this session — no
  // reason to keep hitting the same wall on every future word too) and
  // auto-files a bug report through the same pipeline the manual "Report a
  // problem" button uses, so this gets flagged without the learner having
  // to notice and report it themselves. The bug-report insert has an
  // honest limitation worth naming: if the real cause is "this device
  // can't reach Supabase at all" (rather than, say, just this one Edge
  // Function route having an issue), the report itself — also a Supabase
  // call — may fail silently too. It's still worth attempting, since it
  // catches every failure mode short of a full domain-level block.
  const aiUnreachableReportedRef = useRef(false);
  function handleAiUnreachable() {
    if (aiUnreachableReportedRef.current) return;
    aiUnreachableReportedRef.current = true;
    setAiUnreachable(true);
    if (settings) {
      const next = { ...settings, sentenceWritingMode: false };
      saveSettings(next);
      setSettings(next);
      scheduleSync();
    }
    supabase.from('bug_reports').insert({
      user_id: null,
      email: null,
      message: 'Auto-detected: could not reach the AI service (correct-sentence/generate-sentence timed out or failed at the network level, not just an API error). Sentence-writing mode was automatically turned off on this device.',
      page_path: window.location.pathname,
      user_agent: navigator.userAgent,
    }).then(() => {}, () => {});
  }

  // Fetches a correct example sentence with no user attempt involved (see
  // directSentence above) — chains generateSentence's live fallback (rare;
  // most words already have a pre-baked exercisePrompt) into correctSentence
  // called with no userTranslation, which per its own contract always
  // succeeds with a natural direct translation. Re-fires whenever a new
  // word enters this mode (loadCurrent resets directSentenceStatus to
  // 'idle' below). directSentenceStatus is deliberately NOT a dependency
  // here, even though the effect reads it — setting it to 'loading' inside
  // the effect would otherwise immediately re-trigger this same effect,
  // whose cleanup would cancel the fetch it had just started.
  useEffect(() => {
    if (!useDirectSentence || !word || !settings || directSentenceStatus !== 'idle') return;
    let cancelled = false;
    setDirectSentenceStatus('loading');
    (async () => {
      try {
        // Chinese pairs with whichever English prompt actually got used —
        // the corpus's own exercisePromptZh for a pre-baked prompt, or the
        // AI's own sentenceZh when a word without one falls back to a live
        // generateSentence call. Capturing it here (not re-derived later
        // from the word's static corpus fields at display time) is what
        // keeps a saved sentence's language pairing accurate even for a
        // word the corpus never got a Chinese translation for.
        let englishPrompt = word.exercisePrompt;
        let englishPromptZh = word.exercisePromptZh;
        if (!englishPrompt) {
          const generated = await generateSentence(word.id, word.de, word.en, settings.level, getKnownVocabulary(settings.level), settings.nativeLanguage);
          englishPrompt = generated.sentence;
          englishPromptZh = generated.sentenceZh;
        }
        const result = await correctSentence(word.id, word.de, settings.level, englishPrompt);
        if (cancelled) return;
        setDirectSentence({ sentence: result.sentence, wordForm: result.wordForm, englishPrompt, englishPromptZh });
        setDirectSentenceStatus('ready');
      } catch (e) {
        if (cancelled) return;
        if (e instanceof AIUnreachableError) { setDirectSentenceStatus('unreachable'); handleAiUnreachable(); return; }
        setDirectSentenceStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDirectSentence, word, settings]);

  // Backfills a missing reference sentence for a round 2+/review card whose
  // progress simply predates this feature (or whose real round-1 pass hit
  // sentenceWritingMode === false while an earlier AI call had already
  // failed this session, so useDirectSentence above never got to run for
  // it) — without this, such a word would show no context at all, forever,
  // and keep auto-advancing on a correct answer unlike every other round
  // 2+ card. Same two exceptions as everywhere else this session:
  // isBootstrapCopyWord's ~220 A1 words never get an AI sentence at any
  // round, and a session where aiUnreachable already fired doesn't get a
  // second AI call to fail the same way. Same generateSentence ->
  // correctSentence (no user translation) pipeline as useDirectSentence,
  // just triggered later in a word's life instead of only at round 1, and
  // persisted onto the word's progress so it sticks for every future
  // review too, not just this card.
  const backfillingForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!word || !settings || currentRound <= 1) return;
    if (exampleSentence || isBootstrapCopyWord(word) || aiUnreachable) return;
    if (backfillingForRef.current === word.id) return;
    backfillingForRef.current = word.id;
    let cancelled = false;
    (async () => {
      try {
        let englishPrompt = word.exercisePrompt;
        let englishPromptZh = word.exercisePromptZh;
        if (!englishPrompt) {
          const generated = await generateSentence(word.id, word.de, word.en, settings.level, getKnownVocabulary(settings.level), settings.nativeLanguage);
          englishPrompt = generated.sentence;
          englishPromptZh = generated.sentenceZh;
        }
        const result = await correctSentence(word.id, word.de, settings.level, englishPrompt);
        if (cancelled) return;
        const sentence = { sentence: result.sentence, wordForm: result.wordForm, englishPrompt, englishPromptZh };
        setExampleSentence(sentence);
        saveWordProgress({ ...getWordProgress(word.id), exampleSentence: sentence });
        scheduleSync();
      } catch (e) {
        if (!cancelled && e instanceof AIUnreachableError) handleAiUnreachable();
        // Any other failure just leaves this card without a sentence —
        // the quick auto-advance timer below is still correct for it.
      } finally {
        if (backfillingForRef.current === word.id) backfillingForRef.current = null;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, currentRound, exampleSentence, settings, aiUnreachable]);

  const loadCurrent = (w: Word, mode: RoundMode) => {
    const progress = getWordProgress(w.id);
    const stage = (progress.mascotStage ?? 'puppy') as 'puppy' | 'short' | 'medium';
    const plan = REVIEW_PLAN[stage];
    const round = mode === 'review' ? (reviewRoundsRef.current[w.id] ?? plan.startRound) : progress.round;
    setCurrentRound(round);
    setRoundRange(mode === 'review' ? [plan.startRound, plan.capRound] : [1, 2]);
    setActiveChunk(mode === 'review' ? chunkForStage(stage) : 1);
    const h = generateHint(w, round);
    const chars = [...w.de];
    setHint(h);
    setValues(chars.map((c, i) => (h[i] ? '' : c)));
    setArticleValues(['', '', '']);
    setFeedback(null);
    setJustCompleted(false);
    setAttemptKey(k => k + 1);
    setExampleSentence(progress.exampleSentence ?? null);
    setSentenceResult(null);
    setSentenceInput('');
    setDirectSentence(null);
    setDirectSentenceStatus('idle');
    setWordStatus(mode === 'review' ? 'Review' : (progress.lastPracticed && progress.lastPracticed !== today() ? 'Continuing' : 'New'));
    if (round === 1 && getSettings().autoPlayAudio) speakWord(w);
  };

  function enterRoundsPhase(ds: DailySession, mode: RoundMode) {
    const ids = mode === 'study' ? ds.studyWordIds : ds.reviewWordIds;
    // Resume the exact in-session order if one was already persisted (see
    // studyQueueIds/reviewQueueIds); only the very first entry into this
    // phase this session falls back to computing it fresh from `ids`.
    const persistedQueueIds = mode === 'study' ? ds.studyQueueIds : ds.reviewQueueIds;
    const isFirstEntryToday = persistedQueueIds === undefined;
    const sourceIds = persistedQueueIds !== undefined ? persistedQueueIds : ids;
    let pending = sourceIds.filter(id => !isRoundsDone(id, mode));
    // A "Continuing" word (started introduction on a previous day, already
    // past round 1) would otherwise sit wherever buildStudyWords happened to
    // place it — often near the front, since it's prioritized for
    // *inclusion* in today's batch. Sorting round-1-needing words first, just
    // once at the start of today's session, means the learner meets every
    // brand-new word before any carryover word's round-2+ continuation —
    // independent of the MCQ checkpoint below, which is now scoped to just
    // the round-1-needing words (see studyRound1NeededIds) rather than
    // studyWordIds as a whole.
    let studyRound1NeededIds: string[] | undefined;
    if (mode === 'study' && isFirstEntryToday) {
      const progress = getAllProgress();
      pending = [...pending].sort((a, b) => (progress[a]?.round ?? 1) - (progress[b]?.round ?? 1));
      // Captured once, right here — see DailySession.studyRound1NeededIds
      // for why the MCQ checkpoint needs this narrower set instead of all
      // of studyWordIds.
      studyRound1NeededIds = ids.filter(id => (progress[id]?.round ?? 1) === 1);
    }
    const words = wordsById(pending);
    setQueue(words);
    setTotalWords(ids.length);
    // Restored from the persisted session (see DailySession.reviewRounds)
    // rather than reset to {} unconditionally — this function re-runs on
    // every remount (navigating away and back, e.g. to change a Settings
    // toggle), and a hard reset here used to silently rewind any
    // in-progress review word back to its milestone's starting round.
    reviewRoundsRef.current = { ...(ds.reviewRounds ?? {}) };
    const withQueue: DailySession = mode === 'study'
      ? { ...ds, studyQueueIds: pending, ...(studyRound1NeededIds !== undefined ? { studyRound1NeededIds } : {}) }
      : { ...ds, reviewQueueIds: pending };
    persistSession(withQueue);
    if (words.length > 0) {
      loadCurrent(words[0], mode);
    } else if (mode === 'study') {
      finishStudyRounds(withQueue);
    } else {
      finishReviewRounds(withQueue);
    }
  }

  // Pre-review reminder for every review-eligible word (see
  // reviewMcqQueueIds) — retried until a clean pass: once the queue drains,
  // a non-empty reviewMcqWrongIds becomes the next (reshuffled) pass, same
  // mechanic as enterStudyMcqPhase below.
  function enterReviewMcqPhase(ds: DailySession) {
    if (ds.reviewMcqQueueIds.length === 0) {
      if (ds.reviewMcqWrongIds.length > 0) {
        const next: DailySession = { ...ds, reviewMcqQueueIds: shuffled(ds.reviewMcqWrongIds), reviewMcqWrongIds: [] };
        persistSession(next);
        enterReviewMcqPhase(next);
        return;
      }
      const next: DailySession = { ...ds, phase: 'review-rounds' };
      persistSession(next);
      enterRoundsPhase(next, 'review');
      return;
    }
    const w = wordsById([ds.reviewMcqQueueIds[0]])[0];
    if (!w) {
      const next: DailySession = { ...ds, reviewMcqQueueIds: ds.reviewMcqQueueIds.slice(1) };
      persistSession(next);
      enterReviewMcqPhase(next);
      return;
    }
    const { correct, choices } = buildMcqChoices(w, mcqSeenRef.current[w.id] ?? []);
    mcqSeenRef.current[w.id] = [...(mcqSeenRef.current[w.id] ?? []), ...choices];
    setMcqCurrent({ word: w, correct, choices });
  }

  // Round-1.5 checkpoint — "what does this word mean?" once every study
  // word has had its round-1 pass (see advanceStudyQueue's gate), same
  // retry-until-clean mechanic as review's own MCQ above. Ends by
  // continuing the round ladder into round 2.
  function enterStudyMcqPhase(ds: DailySession) {
    if (ds.studyMcqQueueIds.length === 0) {
      if (ds.studyMcqWrongIds.length > 0) {
        const next: DailySession = { ...ds, studyMcqQueueIds: shuffled(ds.studyMcqWrongIds), studyMcqWrongIds: [] };
        persistSession(next);
        enterStudyMcqPhase(next);
        return;
      }
      const next: DailySession = { ...ds, phase: 'study-rounds' };
      persistSession(next);
      enterRoundsPhase(next, 'study');
      return;
    }
    const w = wordsById([ds.studyMcqQueueIds[0]])[0];
    if (!w) {
      const next: DailySession = { ...ds, studyMcqQueueIds: ds.studyMcqQueueIds.slice(1) };
      persistSession(next);
      enterStudyMcqPhase(next);
      return;
    }
    const { correct, choices } = buildMcqChoices(w, mcqSeenRef.current[w.id] ?? []);
    mcqSeenRef.current[w.id] = [...(mcqSeenRef.current[w.id] ?? []), ...choices];
    setMcqCurrent({ word: w, correct, choices });
  }

  // --- Mount: load today's session (Home always creates one before routing
  // here) and resume at whatever phase it's at. ---
  useEffect(() => {
    const s = getSettings();
    setSettings(s);
    const ds = getDailySession();
    if (!ds) { setReady(true); return; }

    // Idempotent: a batch that was empty from the very start still needs its
    // goal marked done, since its phase never visits the normal completion
    // transition that would otherwise do this.
    if (ds.studyWordIds.length === 0 && !isStudyGoalDoneToday()) markStudyGoalDone(0);
    if (ds.reviewWordIds.length === 0 && !isReviewGoalDoneToday()) markReviewGoalDone(0);

    setSession(ds);
    if (ds.phase === 'study-mcq') enterStudyMcqPhase(ds);
    else if (ds.phase === 'study-rounds') enterRoundsPhase(ds, 'study');
    else if (ds.phase === 'review-mcq') enterReviewMcqPhase(ds);
    else if (ds.phase === 'review-rounds') enterRoundsPhase(ds, 'review');
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- report phase: auto-skip when nothing upgraded (same routing as its
  // own "Continue" button — onward into study if there's any today, since
  // review runs first now, otherwise straight to congrats) ---
  useEffect(() => {
    if (!session || session.phase !== 'report') return;
    const total = Object.values(session.earnedUpgrades).reduce((a, b) => a + (b ?? 0), 0);
    if (total === 0) handleContinueFromReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.phase]);

  // --- congrats phase: fire streak/congrats bookkeeping once, then show the modal ---
  useEffect(() => {
    if (!session || session.phase !== 'congrats') return;
    const stats = getDailyStats();
    if (stats.studyDone && stats.reviewDone && !stats.congratsShown) {
      touchStreak();
      markCongratsShown();
    }
    // Snapshot BEFORE showing the modal (see congratsStats' own comment) —
    // markCongratsShown() above doesn't change studiedCount/reviewedCount,
    // so re-reading here isn't required for correctness, just consistent
    // with "the numbers this effect just looked at are the ones shown".
    setCongratsStats(stats);
    setShowCongrats(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.phase]);

  // sentenceForHistory carries the learner's own typed attempt alongside the
  // correction, purely for the Back button's read-only replay below — it's
  // never written into WordProgress (extra is the only thing that is).
  const submitResult = (
    correct: boolean,
    extra?: Partial<WordProgress>,
    sentenceForHistory?: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; userInput: string; isDirect?: boolean },
  ) => {
    if (!session || !word || !settings || feedback !== null) return;
    const progress = getWordProgress(word.id);
    const beforeStage = progress.mascotStage;
    setCardHistory(h => [...h, {
      word, roundMode, round: currentRound, roundRange, activeChunk, wordStatus, correct, sentence: sentenceForHistory ?? null,
      contextSentence: currentRound > 1 ? (exampleSentence ?? null) : null,
    }]);

    if (roundMode === 'review') {
      const outcome = applyReviewResult(progress, correct, currentRound);
      if (outcome.isFinal) delete reviewRoundsRef.current[word.id];
      else reviewRoundsRef.current[word.id] = outcome.nextRound;

      saveWordProgress(outcome.progress);
      scheduleSync();
      // Only once this word's review is actually DONE for today
      // (isFinal) — confirmed real: logging on every submission counted
      // a word the learner started but hadn't finished (still mid-retry
      // after a wrong answer, still sitting in the queue) as "reviewed"
      // on the Progress page calendar, which didn't match reality (their
      // own daily-goal counts still showed it as not-yet-done).
      if (outcome.isFinal) logWordActivity(word.id, 'reviewed');
      setFeedback(correct);
      setJustCompleted(outcome.isFinal);

      // Always persists the ref's new state (see DailySession.reviewRounds)
      // — folded into one persistSession call together with the earned-
      // upgrade bump, rather than two separate calls, since a second call
      // spreading the same (still-stale, pre-rerender) `session` variable
      // would silently undo whatever the first call had just changed.
      const stage = outcome.progress.mascotStage;
      const earnedUpgrade = !!(outcome.isFinal && outcome.scored && correct && stage && beforeStage !== stage);
      persistSession({
        ...session,
        reviewRounds: { ...reviewRoundsRef.current },
        ...(earnedUpgrade ? { earnedUpgrades: { ...session.earnedUpgrades, [stage!]: (session.earnedUpgrades[stage!] ?? 0) + 1 } } : {}),
      });
      if (earnedUpgrade) addEarnedUpgrade(stage!);
    } else {
      // Day 1 (introduction) completes on a clean round-2 pass — correct at
      // round 1 just promotes to round 2 (applyResult), it isn't "done" yet.
      const completed = progress.round === 2 && correct;
      const updated = { ...applyResult(progress, correct), ...extra };
      const earnedBadge = updated.studiedTimes > progress.studiedTimes;

      saveWordProgress(updated);
      scheduleSync();
      // earnedBadge is the exact submission that completes round-1
      // introduction (mascotStage reaches 'puppy' for the first time) — the
      // Progress page calendar's "learned" bucket; any other CORRECT study
      // attempt on this word today (e.g. round 1 -> round 2, not yet
      // earning the badge) is "reviewed" instead, same as review-mode's
      // own submissions above. A wrong answer doesn't log anything —
      // same reasoning as the review branch: it didn't actually finish
      // anything for this word today.
      if (correct) logWordActivity(word.id, earnedBadge ? 'learned' : 'reviewed');
      setFeedback(correct);
      setJustCompleted(completed);

      if (earnedBadge) {
        persistSession({ ...session, earnedPuppies: session.earnedPuppies + 1 });
        addEarnedPuppy();
      }
    }

    // The round-1 translate exercise already auto-plays the corrected
    // sentence itself (see SentenceExercise) — playing the bare word here
    // too would overlap it, so that case stays gated behind autoPlayAudio
    // (and skipped entirely when a reference sentence is about to play its
    // own audio). Every actual spelling card (round 2+, study or review)
    // always confirms pronunciation right after Check regardless of that
    // setting and regardless of right/wrong — hearing the correct word
    // immediately after attempting to spell it is the whole point, not
    // something the ambient auto-play preference should gate.
    //
    // On a CORRECT answer, the chime plays first and the word's own
    // pronunciation is delayed a beat behind it — playing both at the
    // same instant made the chime intermittently inaudible, and the
    // order also just reads better: "yes, correct" before "here's how
    // it's said".
    const playWord = () => {
      if (currentRound === 1) {
        if (settings.autoPlayAudio && !extra?.exampleSentence) speakWord(word);
      } else {
        speakWord(word);
      }
    };
    if (correct) {
      playCorrectChime();
      setTimeout(playWord, 550);
    } else {
      playWord();
    }
  };

  const handleSubmit = () => {
    if (!word || !wordComplete) return;
    const wordRight = checkAnswer(word.de, values.join(''));
    const articleGuess = articleValues.join('').toLowerCase();
    const articleRight = !needsArticle || articleGuess === word.article;
    // Chime lives in submitResult now, sequenced ahead of the word's own
    // pronunciation (see its own comment) — playing it here too would
    // double it up.
    // A fetched reference sentence (sentence writing mode off) is saved
    // exactly like a real round-1 correction would be — same shape, same
    // downstream behavior (shown on Word List) — just with no actual user
    // translation attempt behind it.
    submitResult(
      wordRight && articleRight,
      directSentence ? { exampleSentence: directSentence } : undefined,
      directSentence ? { ...directSentence, userInput: '', isDirect: true } : undefined,
    );
  };
  // A deliberate "give me more help" request — demotes one round (more
  // scaffolding) instead of retrying the same round the way a wrong typed
  // answer does. Not available at round 1 (nothing lower to demote to); the
  // button itself is hidden then. Counts as a mistake for SRS purposes, same
  // as a wrong answer, since the learner didn't recall it unaided.
  const handleHint = () => {
    if (!word || feedback !== null || currentRound <= 1) return;
    const progress = getWordProgress(word.id);
    const { progress: updated, nextRound } = requestHint(progress, currentRound);
    const finalProgress = roundMode === 'study' ? { ...updated, round: nextRound } : updated;
    saveWordProgress(finalProgress);
    scheduleSync();
    if (roundMode === 'review' && session) {
      reviewRoundsRef.current[word.id] = nextRound;
      persistSession({ ...session, reviewRounds: { ...reviewRoundsRef.current } });
    }

    setCurrentRound(nextRound);
    const h = generateHint(word, nextRound);
    const chars = [...word.de];
    setHint(h);
    setValues(chars.map((c, i) => (h[i] ? '' : c)));
    setArticleValues(['', '', '']);
    setAttemptKey(k => k + 1);
  };

  // The matching-quiz recap, at the true end of either study or review —
  // pages are fully padded to 5 (or fewer, only if the whole batch is under
  // 5) up front, so the queue is just consumed 5 at a time — see
  // currentMatchingPage/handleMatchingPageComplete.
  function enterMatchingPhase(ds: DailySession, mode: RoundMode) {
    const wordIds = mode === 'study' ? ds.studyWordIds : ds.reviewWordIds;
    persistSession({
      ...ds,
      phase: mode === 'study' ? 'study-matching' : 'review-matching',
      ...(mode === 'study' ? { studyMatchingDone: true } : { reviewMatchingDone: true }),
      matchingQueueIds: buildMatchingPages(wordIds).flat(),
    });
  }

  // Shared by finishStudyRounds and the matching-quiz recap's own
  // completion — whichever gets there second is what actually continues
  // past study. Study is always the LAST block of the day now (review runs
  // first — see startDailySession), so there's nothing left to route to
  // afterward except the "N words learned" summary itself; its own
  // "Continue" button (handleFinishStudy) takes it from there to congrats.
  function proceedPastStudy(ds: DailySession) {
    persistSession({ ...ds, phase: 'study-done' });
  }

  // Day 1 truly complete for every word in today's batch (round 2 passed —
  // see isRoundsDone's study branch) — the matching-quiz recap runs once,
  // here at the actual end, before the "N words learned" summary.
  function finishStudyRounds(ds: DailySession) {
    markStudyGoalDone(ds.studyWordIds.length);
    if (!ds.studyMatchingDone) {
      enterMatchingPhase(ds, 'study');
      return;
    }
    proceedPastStudy(ds);
  }

  // Every review word has reached its own milestone's cap round — same
  // matching-quiz recap as study, then straight to the report card. Review
  // runs FIRST in the day (see startDailySession) — the report card's own
  // "Continue" button (handleContinueFromReport) is what takes it onward
  // into study, so no separate interim screen is needed here either.
  function finishReviewRounds(ds: DailySession) {
    markReviewGoalDone(ds.reviewWordIds.length);
    if (!ds.reviewMatchingDone) {
      enterMatchingPhase(ds, 'review');
      return;
    }
    persistSession({ ...ds, phase: 'report' });
  }

  // Retried until a clean pass — see enterReviewMcqPhase.
  function handleReviewMcqAnswer(correct: boolean) {
    if (!session || !mcqCurrent) return;
    // No playCorrectChime() here -- TranslationChoiceCard already plays it
    // the moment a correct choice is picked, not when Next is eventually
    // clicked.
    const next: DailySession = {
      ...session,
      reviewMcqQueueIds: session.reviewMcqQueueIds.slice(1),
      reviewMcqWrongIds: correct ? session.reviewMcqWrongIds : [...session.reviewMcqWrongIds, mcqCurrent.word.id],
    };
    setMcqCurrent(null);
    persistSession(next);
    enterReviewMcqPhase(next);
  }

  // Retried until a clean pass — see enterStudyMcqPhase.
  function handleStudyMcqAnswer(correct: boolean) {
    if (!session || !mcqCurrent) return;
    // See handleReviewMcqAnswer's own comment -- TranslationChoiceCard
    // already played the chime on pick.
    const next: DailySession = {
      ...session,
      studyMcqQueueIds: session.studyMcqQueueIds.slice(1),
      studyMcqWrongIds: correct ? session.studyMcqWrongIds : [...session.studyMcqWrongIds, mcqCurrent.word.id],
    };
    setMcqCurrent(null);
    persistSession(next);
    enterStudyMcqPhase(next);
  }

  function advanceStudyQueue() {
    if (!session) return;
    const rest = queue.slice(1);
    if (!justCompleted) rest.push(queue[0]);
    setQueue(rest);
    const restIds = rest.map(w => w.id);

    // The round-1.5 "what does this word mean?" checkpoint fires once,
    // exactly when every word that actually NEEDED a round-1 pass today
    // has finished it (the sentence exercise always promotes round 1 -> 2
    // on submit, so "round >= 2" is that signal) — before round 2
    // continues. Scoped to studyRound1NeededIds (see its own comment), NOT
    // the full studyWordIds — a "Continuing" carryover word already past
    // round 1 would otherwise satisfy this gate for free, firing the
    // checkpoint (and quizzing on that carryover word too) the moment a
    // single genuinely-new word finishes round 1, before the learner has
    // even reached the carryover words in today's queue.
    if (!session.studyMcqDone) {
      const progress = getAllProgress();
      const round1NeededIds = session.studyRound1NeededIds ?? session.studyWordIds;
      const allDoneRound1 = round1NeededIds.every(id => (progress[id]?.round ?? 1) >= 2);
      if (allDoneRound1) {
        const next: DailySession = {
          ...session, studyQueueIds: restIds, phase: 'study-mcq',
          studyMcqDone: true, studyMcqQueueIds: [...round1NeededIds],
        };
        persistSession(next);
        enterStudyMcqPhase(next);
        return;
      }
    }

    const next: DailySession = { ...session, studyQueueIds: restIds };
    persistSession(next);
    if (rest.length > 0) loadCurrent(rest[0], 'study');
    else finishStudyRounds(next);
  }

  function advanceReviewQueue() {
    if (!session) return;
    const rest = queue.slice(1);
    if (!justCompleted) rest.push(queue[0]);
    setQueue(rest);
    const next: DailySession = { ...session, reviewQueueIds: rest.map(w => w.id) };
    persistSession(next);
    if (rest.length > 0) loadCurrent(rest[0], 'review');
    else finishReviewRounds(next);
  }

  const handleNext = () => {
    if (!session || !word) return;
    if (roundMode === 'review') {
      advanceReviewQueue();
      return;
    }
    advanceStudyQueue();
  };
  handleNextRef.current = handleNext;

  function currentMatchingPage(ds: DailySession): Word[] {
    return wordsById(ds.matchingQueueIds.slice(0, 5));
  }

  function handleMatchingPageComplete() {
    if (!session) return;
    setMatchingPageKey(k => k + 1);
    const remainingQueue = session.matchingQueueIds.slice(5);

    if (remainingQueue.length > 0) {
      persistSession({ ...session, matchingQueueIds: remainingQueue });
      return;
    }
    finishMatchingPhase(session);
  }

  // Reached from either study-matching or review-matching, at the true end
  // of that side's rounds — routes to whatever comes after each.
  function finishMatchingPhase(ds: DailySession) {
    if (ds.phase === 'study-matching') {
      proceedPastStudy(ds);
    } else {
      persistSession({ ...ds, phase: 'report' });
    }
  }

  // The "N words learned" summary's own "Continue" button — study is
  // always the last block of the day now, so there's nothing left to route
  // to except the congrats card.
  function handleFinishStudy() {
    if (!session) return;
    persistSession({ ...session, phase: 'congrats' });
  }

  // The report card's (review's results screen) own "Continue" button —
  // review runs first in the day, so this is what takes the learner onward
  // into study, or straight to congrats if there's nothing to study today.
  function handleContinueFromReport() {
    if (!session) return;
    if (session.studyWordIds.length > 0) {
      const next: DailySession = { ...session, phase: 'study-rounds' };
      persistSession(next);
      enterRoundsPhase(next, 'study');
    } else {
      persistSession({ ...session, phase: 'congrats' });
    }
  }

  // The actual "leave the daily flow" step — shared by closing the
  // congrats card directly (no bonus round today) and quitting out of the
  // bonus round once a learner's done playing it (see handleCloseCongrats/
  // handleQuitPlay). Always the same ending regardless of which path got
  // here: mark today's session done, then either nudge an anonymous
  // learner to sign in or send them home.
  async function finishForToday() {
    if (session) persistSession({ ...session, phase: 'done' });
    // One soft nudge, right after the celebration rather than overlapping
    // or blocking it — a learner who isn't signed in has just finished
    // today's goal, the moment they're most likely to actually care about
    // not losing it. Checked fresh here (not a cached signedIn state) since
    // sign-in status can change mid-session and this only needs to be
    // right once, at this exact moment.
    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession) {
      setShowSignInNudge(true);
      return;
    }
    router.push('/');
  }

  async function handleCloseCongrats() {
    setShowCongrats(false);
    // The bonus round only exists at all when there's enough learned
    // vocabulary to fill even one board (see hasEnoughWordsForGame) — the
    // exact same gate StudyRoadmap already uses to decide whether to show
    // "Play" as a real destination in the first place, so a learner who
    // never sees it promised there never lands on it here either.
    if (session && hasEnoughWordsForGame()) {
      persistSession({ ...session, phase: 'play' });
      return;
    }
    await finishForToday();
  }

  // Replayable as many times as the learner likes (see WordMatchGame's own
  // "Play again" button) — this only fires once they actively choose to
  // stop, via its "Finish for today" button.
  async function handleQuitPlay() {
    await finishForToday();
  }

  function handleCloseSignInNudge() {
    setShowSignInNudge(false);
    router.push('/');
  }

  // Enter advances past feedback; a correct answer also auto-advances. Only
  // live during the actual round-ladder screens — otherwise a stale
  // `feedback` left over from the round just before an MCQ/matching phase
  // started would fire handleNext (built for the round queue) into a screen
  // it knows nothing about. Re-evaluated on phase changes too, so a phase
  // change on its own (without `feedback` changing) still clears any
  // pending auto-advance timer from the round that just ended.
  const isRoundScreen = session?.phase === 'study-rounds' || session?.phase === 'review-rounds';
  useEffect(() => {
    if (feedback === null || !isRoundScreen) return;
    // Time-gated rather than requiring a keyup-then-keydown: the sentence
    // exercise's Check is async (awaits the AI call), so by the time
    // `feedback` actually flips true and this effect attaches, the Enter
    // press that triggered Check has long since released — its keyup never
    // reaches this listener, so a "must see a keyup before arming" gate
    // just silently eats the next fresh press, forcing a second one to
    // register. A short ignore-window after attaching still filters out
    // key-repeat from a still-held Enter carrying over from a *synchronous*
    // submit (e.g. LetterInputRow's rounds), without needing that press's
    // keyup to ever be observed.
    const attachedAt = Date.now();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && Date.now() - attachedAt > 300) handleNextRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    // Suppressed for the round-1 sentence exercise, and now equally for
    // any round 2+/review card showing its own context sentence (see the
    // currentRound > 1 block below) — both need a real moment to actually
    // read, not a fixed 1.5s flash timed for a bare "✓ Correct!" banner.
    // Confirmed real: 1.5s wasn't enough to even start reading a sentence
    // that had just appeared, let alone its translation and grammar info
    // too. A word with no saved sentence yet still gets the quick
    // auto-advance, same as before, since there's nothing extra to read.
    const isSentenceRoundDone = currentRound === 1 && roundMode === 'study' && sentenceResult !== null;
    const hasContextToRead = currentRound > 1 && !!exampleSentence;
    const timer = feedback === true && !isSentenceRoundDone && !hasContextToRead ? setTimeout(() => handleNextRef.current(), 1500) : undefined;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer) clearTimeout(timer);
    };
    // exampleSentence is included so a card whose sentence backfills in
    // (see the effect above) DURING the correct-answer window still
    // cancels/re-evaluates the auto-advance timer instead of firing on
    // stale info from before the sentence arrived.
  }, [feedback, isRoundScreen, exampleSentence]);

  const articleComplete = !needsArticle || articleValues.every(v => !!v);
  const wordComplete = hint.length > 0 && hint.every((h, i) => !h || !!values[i]) && articleComplete;
  const completedCount = totalWords - queue.length;
  const progressPct = totalWords > 0 ? Math.min(100, Math.round((completedCount / totalWords) * 100)) : 0;

  if (!ready || !settings) return null;

  // Checked ahead of every phase branch below (not nested inside the
  // 'done' one) so the ?previewSignInNudge=1 dev-preview effect works
  // regardless of whatever session/phase state happens to already be on
  // screen — the real flow only ever sets this true right as phase
  // becomes 'done' anyway (see handleCloseCongrats), so this is a no-op
  // reordering for actual users.
  if (showSignInNudge) {
    return <SignInNudge onClose={handleCloseSignInNudge} />;
  }

  if (showAiUnlockCelebration) {
    return <AiUnlockCelebration onClose={handleCloseAiUnlockCelebration} />;
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-emerald-100/70 mb-6">No session started yet today.</p>
        <Link href="/" className="text-amber-200 underline">Back to Home</Link>
      </div>
    );
  }

  if (session.phase === 'study-mcq' || session.phase === 'review-mcq') {
    if (!mcqCurrent) return null;
    const onAnswer = session.phase === 'study-mcq' ? handleStudyMcqAnswer : handleReviewMcqAnswer;
    return <TranslationChoiceCard key={mcqCurrent.word.id} word={mcqCurrent.word} correct={mcqCurrent.correct} choices={mcqCurrent.choices} onAnswer={onAnswer} isReview={session.phase === 'review-mcq'} />;
  }

  if (session.phase === 'study-matching' || session.phase === 'review-matching') {
    const page = currentMatchingPage(session);
    if (page.length === 0) return null;
    return <MatchingQuizPage key={matchingPageKey} words={page} onComplete={handleMatchingPageComplete} />;
  }

  if (session.phase === 'study-done') {
    // Every word in studyWordIds started the day without a mascotStage (that's
    // what made it eligible for today's batch — see buildStudyWords) and, by
    // the time this phase is reached, all of them have one (that's what
    // finishStudyRounds's completion check means) — so the whole batch is
    // this session's newly-Introduced words, no extra date filtering needed.
    const todaysWords = wordsById(session.studyWordIds);
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          Study complete!
        </h2>
        <p className="text-amber-100/80 mb-6">
          Today {session.studyWordIds.length} word{session.studyWordIds.length === 1 ? '' : 's'} learned.
        </p>
        {session.earnedPuppies > 0 && (
          <div className="mx-auto mb-6 max-w-xs bg-amber-50/75 backdrop-blur-sm border border-amber-100/50 rounded-2xl px-5 py-4 flex flex-col items-center gap-1.5">
            <DachshundMascot stage="puppy" className="w-20 h-20" />
            <p className="text-slate-700 font-semibold">
              {session.earnedPuppies} pupp{session.earnedPuppies === 1 ? 'y' : 'ies'} earned today!
            </p>
          </div>
        )}
        {todaysWords.length > 0 && (
          <div className="mx-auto mb-6 max-w-sm flex flex-col gap-2 text-left">
            <div className="text-amber-100/70 text-xs font-semibold uppercase tracking-wide text-center mb-1">
              Words introduced today
            </div>
            {todaysWords.map(w => {
              const sentence = getWordProgress(w.id).exampleSentence;
              return (
                <div key={w.id} className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-stone-800">
                      {w.article ? `${w.article} ` : ''}{w.de}
                      <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
                    </span>
                    <span className="shrink-0 text-[10px] font-medium text-stone-500 bg-slate-100 rounded-full px-2 py-0.5">
                      Introduced
                    </span>
                  </div>
                  <div className="text-stone-500 text-sm">{glossFor(w, getSettings().nativeLanguage)}</div>
                  {sentence && (
                    <div className="mt-1.5 pt-1.5 border-t border-amber-100/60 flex flex-col gap-0.5">
                      {sentence.englishPrompt && (
                        <div className="text-stone-500 text-xs">
                          {getSettings().nativeLanguage === 'zh' ? (sentence.englishPromptZh ?? w.exercisePromptZh ?? sentence.englishPrompt) : sentence.englishPrompt}
                        </div>
                      )}
                      <div className="text-stone-700 text-sm italic">{sentence.sentence}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleFinishStudy}
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Continue →
          </button>
          <Link href="/" className="text-amber-200 underline text-sm">Back to Home</Link>
        </div>
      </div>
    );
  }

  if (session.phase === 'report') {
    // Every word that reaches this report already passed its review round(s)
    // today (see applyReviewResult / recordMilestonePass) — there's no
    // partial-credit state to report separately from the list below, so a
    // review with nothing to show just skips this phase entirely.
    if (session.reviewWordIds.length === 0) return null;
    const reviewedWords = wordsById(session.reviewWordIds);
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {session.reviewWordIds.length} word{session.reviewWordIds.length === 1 ? '' : 's'} reviewed today
        </h2>
        {reviewedWords.length > 0 && (
          <div className="mx-auto mb-6 max-w-sm flex flex-col gap-2 text-left">
            {reviewedWords.map(w => {
              const progress = getWordProgress(w.id);
              const sentence = progress.exampleSentence;
              return (
                <div key={w.id} className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-semibold text-stone-800">
                      {w.article ? `${w.article} ` : ''}{w.de}
                    </span>
                    <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
                    <div className="text-stone-500 text-sm">{glossFor(w, getSettings().nativeLanguage)}</div>
                    {sentence && (
                      <div className="mt-1.5 pt-1.5 border-t border-amber-100/60 flex flex-col gap-0.5">
                        {sentence.englishPrompt && (
                          <div className="text-stone-500 text-xs">
                            {getSettings().nativeLanguage === 'zh' ? (sentence.englishPromptZh ?? w.exercisePromptZh ?? sentence.englishPrompt) : sentence.englishPrompt}
                          </div>
                        )}
                        <div className="text-stone-700 text-sm italic">{sentence.sentence}</div>
                      </div>
                    )}
                  </div>
                  <DachshundMascot stage={progress.mascotStage ?? 'puppy'} className="w-11 h-11 shrink-0" />
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={handleContinueFromReport}
          className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
        >
          Continue →
        </button>
      </div>
    );
  }

  if (session.phase === 'congrats') {
    if (!showCongrats || !congratsStats) return null;
    return (
      <CongratsModal
        studiedCount={congratsStats.studiedCount}
        reviewedCount={congratsStats.reviewedCount}
        language="German"
        level={settings?.level}
        date={today()}
        onClose={handleCloseCongrats}
      />
    );
  }

  if (session.phase === 'play') {
    return <WordMatchGame source="daily_flow" onQuit={handleQuitPlay} />;
  }

  if (session.phase === 'done') {
    // Closing the congrats card already navigates to Home directly (see
    // handleCloseCongrats) — this only renders in the brief instant before
    // that push resolves, or if the phase is reached some other way.
    return null;
  }

  // --- study-rounds / review-rounds: the shared spelling-round card ---
  if (!word) return null;
  const chars = [...word.de];

  // Back button: a pure "peek backward" log, never re-editable/re-scored —
  // see CardSnapshot. Viewing history swaps out the whole live card for a
  // read-only one; the one edge case that loses anything is an UNSUBMITTED
  // in-progress translation, since the read-only history view doesn't
  // render SentenceExercise at all while it's showing — accepted as a
  // rare, low-stakes tradeoff rather than keeping every round type's UI
  // permanently mounted-but-hidden just for this (the attempt itself does
  // survive a plain sentence-writing-mode toggle now, via sentenceInput
  // above, just not this specific history view). Every other round type's
  // state (values/hint/articleValues) lives in this component already, so
  // it's untouched either way.
  // submitResult pushes the live card's own snapshot into cardHistory the
  // moment it's answered (feedback !== null) — so once that's happened,
  // cardHistory's last entry is just a duplicate of what's already on
  // screen, and the newest entry actually worth paging back TO is one
  // further behind that.
  const newestHistoryIndex = feedback !== null ? cardHistory.length - 2 : cardHistory.length - 1;

  if (historyIndex !== null) {
    const snap = cardHistory[historyIndex];
    return (
      <div className="flex flex-col gap-5">
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5 min-h-[30rem]">
          <div>
            <div className="text-sm font-medium text-indigo-600 mb-1">
              {CHUNK_LABELS[snap.activeChunk]}
            </div>
            <MilestoneBar activeChunk={snap.activeChunk} wordId={snap.word.id} />
          </div>

          <div className="text-center">
            <div className="text-2xl font-semibold text-slate-700">{glossFor(snap.word, getSettings().nativeLanguage)}</div>
          </div>

          {snap.sentence && snap.sentence.isDirect ? (
            <div className="flex flex-col gap-3">
              <div className="text-center -mt-1">
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Copy this word</div>
                <div className="text-2xl font-bold text-indigo-800 tracking-wide break-words">
                  {snap.word.article ? `${snap.word.article} ` : ''}{snap.word.de}
                </div>
                <WordGrammarInfo word={snap.word} />
              </div>
              <ReferenceSentence example={snap.sentence} word={snap.word} />
              <div className={`text-center py-3 rounded-xl font-semibold text-lg ${snap.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {snap.correct ? '✓ Correct!' : '✗ Wrong that time'}
              </div>
            </div>
          ) : snap.sentence ? (
            <div className="flex flex-col gap-3">
              <SentenceWordHeader word={snap.word} />
              <div className="bg-indigo-50 rounded-xl px-3 py-2 text-center">
                <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Translate to German</div>
                <div className="text-stone-700 italic">
                  {getSettings().nativeLanguage === 'zh' ? (snap.sentence.englishPromptZh ?? snap.word.exercisePromptZh ?? snap.sentence.englishPrompt) : snap.sentence.englishPrompt}
                </div>
              </div>
              <div className="w-full border-2 border-indigo-100 rounded-xl px-3 py-2 text-stone-500">
                {snap.sentence.userInput}
              </div>
              <div className="text-center py-3 rounded-xl font-semibold bg-green-50 border border-green-200 px-4">
                <div className="text-xs uppercase tracking-wide text-green-600 mb-1 font-medium flex items-center justify-center gap-1.5">
                  Correction
                  <TextSpeakerButton text={snap.sentence.sentence} className="text-green-500 hover:text-green-700 transition-colors normal-case" />
                </div>
                <div className="text-lg text-green-800">
                  {tokenize(snap.sentence.sentence).map((text, i) => <span key={i}>{text}</span>)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-center -mt-1">
                <div className="text-2xl font-bold text-indigo-800 tracking-wide break-words">
                  {snap.word.article ? `${snap.word.article} ` : ''}{snap.word.de}
                </div>
              </div>
              <div className={`text-center py-3 rounded-xl font-semibold text-lg ${snap.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {snap.correct ? '✓ Correct!' : '✗ Wrong that time'}
              </div>
              {/* Same round 2+/review context block the live card showed —
                  see the live version's own comment. Always revealed here
                  (never masked): "Previous" is a read-only replay of an
                  ALREADY-answered round, so it should show exactly what
                  was on screen right before Next was pressed, not the
                  pre-Check state — confirmed real: this used to show
                  nothing at all once paged back to. */}
              {snap.round > 1 && (
                <div className="flex flex-col gap-2">
                  {snap.contextSentence && <ReferenceSentence example={snap.contextSentence} word={snap.word} />}
                  <WordGrammarInfo word={snap.word} />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setHistoryIndex(i => Math.max(0, (i ?? 0) - 1))}
              disabled={historyIndex === 0}
              className="flex-1 bg-white text-indigo-700 border-2 border-indigo-100 py-2.5 rounded-xl font-semibold disabled:opacity-40 hover:enabled:bg-indigo-50 transition-all"
            >
              ← Previous
            </button>
            <button
              onClick={() => setHistoryIndex(i => (i !== null && i < newestHistoryIndex ? i + 1 : null))}
              className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-emerald-100/70">
          <span>
            {roundMode === 'study'
              ? `${completedCount} / ${totalWords} new words learned today`
              : `${completedCount} / ${totalWords} words reviewed`}
          </span>
          {newestHistoryIndex >= 0 && (
            <button
              onClick={() => setHistoryIndex(newestHistoryIndex)}
              className="text-amber-200 hover:text-amber-100 underline font-medium"
            >
              ← Previous
            </button>
          )}
        </div>
        <div className="h-2 w-full bg-white/15 rounded-full overflow-hidden">
          {/* emerald, matching MilestoneBar's own earned/completed color —
              this fill represents progress already done, not "still to
              go" (that's what amber means on MilestoneBar), so it should
              read the same way here for consistency. */}
          <div
            className="h-full bg-emerald-400 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5 min-h-[30rem]">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-medium text-indigo-600">
              {CHUNK_LABELS[activeChunk]}
            </div>
            {/* A labeled switch, not a pill that just names the current
                state — confirmed real: "Writing"/"Copy" text alone didn't
                read as something tappable, just as a status label. The
                track+knob is the standard on/off affordance; the label
                stays put either way so it doesn't look like a different
                control depending on state. */}
            {showSentenceModeToggle && settings && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...settings, sentenceWritingMode: !settings.sentenceWritingMode };
                  saveSettings(next);
                  setSettings(next);
                  scheduleSync();
                }}
                aria-label={settings.sentenceWritingMode ? 'Turn off sentence writing mode (switch to copy mode)' : 'Turn on sentence writing mode'}
                title={settings.sentenceWritingMode ? 'Sentence writing: on — tap to switch to copy mode' : 'Sentence writing: off — tap to turn on'}
                className="flex items-center gap-1.5 shrink-0"
              >
                <span className="text-[10px] font-semibold text-indigo-600">Writing</span>
                <span className={`relative inline-block w-7 h-4 rounded-full transition-colors ${settings.sentenceWritingMode ? 'bg-indigo-600' : 'bg-stone-300'}`}>
                  <span
                    className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform"
                    style={{ transform: settings.sentenceWritingMode ? 'translateX(0.75rem)' : 'translateX(0)' }}
                  />
                </span>
              </button>
            )}
          </div>
          <MilestoneBar activeChunk={activeChunk} wordId={word.id} />
        </div>

        <div className="text-center">
          <RoundWordImage word={word} />
          <div className="text-2xl font-semibold text-slate-700">{glossFor(word, getSettings().nativeLanguage)}</div>
        </div>

        {/* Context for every round 2+/review card, not just round 1 —
            fixed in this ONE spot regardless of feedback state (used to
            jump from here, pre-Check, down to the bottom, post-Check —
            confirmed real: reported as visually inconsistent). Pre-Check,
            the word's own saved sentence shows with the target word
            blanked out (a hint about USAGE/meaning, not a second free
            look at the spelling they're supposed to be recalling
            unaided — see ReferenceSentence's own masked comment); the
            instant Check is pressed, it reveals in place, joined by the
            same plural/verb-forms round 1 already shows once and never
            again otherwise (see WordGrammarInfo). currentRound > 1
            excludes round 1 itself (which either runs its own translate
            exercise or, in copy-mode, already shows the word in full —
            nothing to mask there) and any round-1 Hint-demotion (still
            pure copy-mode, same reasoning). */}
        {currentRound > 1 && (
          <div className="flex flex-col gap-2">
            {exampleSentence && (
              <ReferenceSentence example={exampleSentence} word={word} masked={feedback === null} />
            )}
            {feedback !== null && <WordGrammarInfo word={word} />}
          </div>
        )}

        {/* Four reasons the translation exercise is skipped for round 1:
            !exampleSentence excludes a word demoted BACK to round 1 via Hint
            from round 2 — it already has a saved sentence from its real
            round-1 pass, so it shouldn't be asked to translate another one.
            isBootstrapCopyWord excludes A1's ~220 curated high-frequency
            words permanently — they always use the old copy-the-word
            mechanic instead, never the AI exercise. sentenceWritingMode
            === false is a deliberate opt-out (Settings) — same copy-the-
            word fallback, but with a fetched reference sentence layered
            on top (see useDirectSentence/directSentence above).
            !aiUnreachable excludes a session where an AI call has already
            failed at the network level once (see handleAiUnreachable) —
            no reason to let the very next word try and fail the same way.
            Available whether signed in or not (see this file's earlier
            comment on SentenceWordHeader) — all four still fall through to
            the else branch's round-1 handling (copy-the-word tiles — a
            word demoted back here from round 2 doesn't get its saved
            sentence shown again either, same reasoning as
            ReferenceSentence's own comment). */}
        {currentRound === 1 && roundMode === 'study' && !isBootstrapCopyWord(word) && !exampleSentence && settings.sentenceWritingMode && !aiUnreachable ? (
          <SentenceExercise
            key={word.id}
            word={word}
            level={settings.level}
            correction={sentenceResult}
            input={sentenceInput}
            onInputChange={setSentenceInput}
            onCorrected={(correction, userInput) => {
              setSentenceResult(correction);
              submitResult(true, { exampleSentence: correction }, { ...correction, userInput });
            }}
            onNext={handleNext}
            onUnreachable={handleAiUnreachable}
          />
        ) : (
          <>
            {/* Reachable at round 1 either as A1 bootstrap words' genuine
                first pass, or via a Hint demotion from round 2 for a word
                that already has a saved sentence (see the gate above). */}
            {currentRound === 1 && (
              <div className="text-center -mt-1">
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Copy this word</div>
                <div className="text-2xl font-bold text-indigo-800 tracking-wide break-words">
                  {word.article ? `${word.article} ` : ''}{word.de} <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
                </div>
                <WordGrammarInfo word={word} />
              </div>
            )}

            {useDirectSentence && directSentenceStatus === 'loading' && (
              <p className="text-stone-400 text-xs text-center">Preparing an example sentence…</p>
            )}
            {useDirectSentence && directSentenceStatus === 'ready' && directSentence && (
              <ReferenceSentence example={directSentence} word={word} />
            )}
            {/* aiUnreachable, not directSentenceStatus — this needs to show
                regardless of which of the three AI call sites tripped it
                (including SentenceExercise's own, which unmounts the
                instant aiUnreachable flips, before its own local status
                message ever gets a chance to render). */}
            {aiUnreachable && (
              <p className="text-amber-700 text-xs text-center px-2">
                Can't reach our AI service right now (this can happen depending on your network) —
                switched off sentence-writing mode. You can turn it back on anytime in Settings.
              </p>
            )}

            {word.type === 'noun' && word.article && (
              needsArticle ? (
                <div className="text-center -mb-2">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Article — der / die / das</div>
                  <LetterInputRow
                    ref={articleRowRef}
                    chars={word.article ? [...word.article] : ['_', '_', '_']}
                    hint={[true, true, true]}
                    values={articleValues}
                    onChange={setArticleValues}
                    onSubmit={handleSubmit}
                    disabled={feedback !== null}
                    showCorrectness={feedback !== null}
                    activeInputRef={activeInputRef}
                    resetFocusKey={`article-${word.id}-${attemptKey}`}
                    autoFocus
                    onFilled={() => letterRowRef.current?.focusFirstEmpty()}
                  />
                </div>
              ) : (
                <div className="flex justify-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 font-bold px-4 py-1 rounded-full text-lg">{word.article}</span>
                </div>
              )
            )}

            <LetterInputRow
              ref={letterRowRef}
              chars={chars}
              hint={hint}
              values={values}
              onChange={next => setValues(word.type === 'noun' && next[0] ? [next[0].toUpperCase(), ...next.slice(1)] : next)}
              onSubmit={handleSubmit}
              disabled={feedback !== null}
              showCorrectness={feedback !== null}
              activeInputRef={activeInputRef}
              resetFocusKey={`${word.id}-${attemptKey}`}
              autoFocus={!needsArticle}
              onBackspaceAtStart={needsArticle ? () => {
                setArticleValues(v => v.map((c, i) => (i === v.length - 1 ? '' : c)));
                articleRowRef.current?.focusLast();
              } : undefined}
            />

            {/* Sits in normal flow right after the blanks (not inside the
                mt-auto block below) — reported that the middle of the
                card felt overly empty, since mt-auto was pushing this row
                all the way down to sit flush with Check/Hint rather than
                staying close to the letters it's actually for. Pulling it
                up here doesn't disturb the mt-auto block's own height
                consistency (see its own comment) since that block's floor
                is unchanged either way. */}
            {feedback === null && <SpecialCharButtons inputRef={activeInputRef} />}

            {/* min-h keeps this action area a consistent height across both
                states — without it, the "answering" layout (Check + Hint)
                and the "feedback" layout (banner + Next) render at
                different total heights, so Check/Hint/Next visibly jump
                position every time the card switches between them. Sized
                generously enough to cover the taller variant (round 2+
                with the Hint button, or a two-line-wrapped feedback
                message on a long word) — a shorter variant just leaves
                empty space below it instead of the container shrinking,
                since flex-col lays children out from the top regardless
                of the container's own height. */}
            {feedback === null ? (
              <div className="flex flex-col gap-3 min-h-48 mt-auto">
                <button
                  onClick={handleSubmit}
                  disabled={!wordComplete}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  Check
                </button>
                {currentRound > 1 && (
                  <button onClick={handleHint} className="w-full text-slate-400 py-1 text-sm font-medium hover:text-slate-600 transition-colors">
                    Hint
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 min-h-48 mt-auto">
                <div className={`text-center py-3 px-2 rounded-xl font-semibold text-lg break-words ${feedback ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {feedback ? '✓ Correct!' : (
                    <>
                      ✗ The answer is:{' '}
                      <span className="">{word.article ? `${word.article} ` : ''}{word.de}</span>{' '}
                      <SpeakerButton word={word} className="align-middle text-red-600 hover:text-red-800 transition-colors" />
                    </>
                  )}
                </div>
                <button
                  onClick={handleNext}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
