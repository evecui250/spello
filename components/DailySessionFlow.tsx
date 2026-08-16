'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getDailySession, saveDailySession, DailySession, SessionPhase,
  getWordProgress, saveWordProgress, getAllProgress, getSettings, saveSettings, today,
  Round, WordProgress, Settings, MascotStageId,
  isStudyGoalDoneToday, isReviewGoalDoneToday, markStudyGoalDone, markReviewGoalDone,
  touchStreak, markCongratsShown, getDailyStats, addEarnedPuppy, addEarnedUpgrade,
} from '../lib/storage';
import {
  wordsById, generateHint, checkAnswer, applyResult, applyReviewResult, requestHint,
  buildMcqChoices, buildMatchingPages, getKnownVocabulary, isBootstrapCopyWord, shuffled,
} from '../lib/practice';
import { REVIEW_PLAN } from '../lib/srs';
import { Word, Level, resolveClickedWord, glossFor, findWordByEnglishForm, segmentChineseForClicks } from '../lib/words';
import LetterInputRow, { LetterInputRowHandle } from './LetterInputRow';
import SpecialCharButtons from './SpecialCharButtons';
import SpeakerButton from './SpeakerButton';
import TextSpeakerButton from './TextSpeakerButton';
import TranslationChoiceCard from './TranslationChoiceCard';
import MatchingQuizPage from './MatchingQuizPage';
import DachshundMascot from './Mascot';
import CongratsModal from './CongratsModal';
import WordInfoPanel from './WordInfoPanel';
import { speakWord, speakText, stopSpeech } from '../lib/speech';
import { imageUrlForWord } from '../lib/wordImage';
import { scheduleSync } from '../lib/sync';
import { correctSentence, generateSentence, DailyLimitReachedError, AIUnreachableError } from '../lib/ai';
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

// Splits into alternating word / non-word (whitespace, punctuation) tokens,
// covering German letters (umlauts, ß) as "word" characters.
function tokenize(s: string): string[] {
  return s.match(/[A-Za-zÀ-ÖØ-öø-ÿß']+|[^A-Za-zÀ-ÖØ-öø-ÿß']+/g) ?? [];
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

// Always-4-chunk progress bar — one per lifetime milestone (Learn, 1st/
// 2nd/3rd review), not per round-within-today's-episode like the old dot
// row (which showed a DIFFERENT NUMBER of dots depending on the word's
// stage — 2 for a fresh word, 1 for a medium-stage review — the exact
// inconsistency that made it hard to tell at a glance which stage a word
// was actually at). A milestone's own startRound doubles as its chunk
// index by construction (Learn=[1,2], 1st review=[2,3], 2nd=[3,4], 3rd=
// [4,4]) — that's `roundRange[0]` below, today's target chunk UNLESS it's
// already been earned (chunksEarned already covers it — reading live
// progress rather than inferring purely from roundRange is what makes the
// just-answered chunk actually turn green instead of staying amber until
// the next word loads). A wrong answer/hint never changes roundRange,
// only where currentRound sits within it, so exactly one chunk is ever
// "today's target" at a time — never two.
function MilestoneBar({ roundRange, wordId }: { roundRange: [Round, Round]; wordId: string }) {
  const progress = getWordProgress(wordId);
  const earned = chunksEarned(progress.mascotStage, progress.fullyMastered);
  const activeChunk = roundRange[0];
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
// below it (see chunksEarned), not per individual round. Round 1 and
// round 2 both belong to chunk 1 (Day 1) despite being visibly different
// exercises (write a sentence, then spell it half-hinted); showing
// "Round 1"/"Round 2" text alongside a bar that only has ONE chunk for
// both was confusing (looked like there were more stages than the bar
// actually has). roundRange[0] doubles as the chunk index — see
// MilestoneBar's own comment for why.
const CHUNK_LABELS: Record<Round, string> = {
  1: 'New',
  2: '1st review',
  3: '2nd review',
  4: '3rd review',
};

type RoundMode = 'study' | 'review';

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
  wordStatus: 'New' | 'Continuing' | 'Review';
  correct: boolean;
  // isDirect marks a sentence-writing-mode-OFF round (see directSentence) —
  // there's no real translate-and-correct interaction behind it, just a
  // fetched reference sentence alongside a copy-the-word pass, so the
  // history replay below shows it that way instead of as a translate/
  // correction card.
  sentence?: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; userInput: string; isDirect?: boolean } | null;
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
// SentenceWordHeader is shown above both the input step and the result step
// (see the parent's currentRound === 1 branch) so the word stays visible
// throughout — the correction lands on the same card instead of swapping to
// what reads as a different screen. No "New word" caption here: the
// New/Continuing/Review badge already at the top of the card says that.
function SentenceWordHeader({ word }: { word: Word }) {
  return (
    <div className="text-center -mt-1">
      <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide break-words">
        {word.article ? `${word.article} ` : ''}{word.de}{' '}
        <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
      </div>
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
  // Reserves the same w-24 h-24 footprint regardless of outcome — most
  // words have no illustration yet (see imageUrlForWord) and 404, and
  // returning null here on that error used to collapse this space a beat
  // after the card had already rendered with it reserved, reading as the
  // whole card visibly resizing right after "Next". An empty placeholder
  // keeps every card's height consistent whether or not this particular
  // word has an image.
  return (
    <div className="w-24 h-24 mx-auto mb-1">
      {!failed && (
        <img
          src={imageUrlForWord(word)}
          alt=""
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function SentenceExercise({
  word, level, correction, onCorrected, onNext, onUnreachable,
}: {
  word: Word;
  level: Level;
  // Owned by the parent (persists across this same render — see the
  // round-1 branch below, which no longer swaps to a separate result view
  // on correction, so the learner's own typed attempt stays visible
  // alongside the correction instead of disappearing).
  // lemmas (word-as-it-appears -> dictionary form, from correct-sentence's
  // own AI call) lets word-click resolution below prefer the AI's own
  // grammatical analysis over findWordByGermanForm's suffix-stripping
  // guesswork — the only way to correctly resolve irregular plurals, past
  // participles, and separable-prefix verbs split across the sentence.
  correction: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; lemmas?: Record<string, string> } | null;
  // userInput (the learner's own typed attempt) rides along only for the
  // Back button's history snapshot — the parent keeps it separate from what
  // actually gets persisted to WordProgress.
  onCorrected: (correction: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; lemmas?: Record<string, string> }, userInput: string) => void;
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
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'limit-reached' | 'unreachable'>('idle');
  // Which word in the corrected sentence the learner tapped (see the
  // clickable-word rendering below and WordInfoPanel) — cleared implicitly
  // on remount (this whole component is keyed by word.id) rather than
  // needing its own reset effect. selectedPromptWord is the same idea but
  // for the PROMPT sentence (a hint while still attempting the
  // translation) — kept as its own separate state so tapping a word in
  // one sentence never disturbs whatever's showing for the other.
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [selectedPromptWord, setSelectedPromptWord] = useState<Word | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  // already moved on to the next word or left the page entirely.
  useEffect(() => {
    if (correction && getSettings().autoPlayAudio) speakText(correction.sentence);
    return () => stopSpeech();
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
      onCorrected({ sentence: result.sentence, wordForm: result.wordForm, englishPrompt: promptSentence, englishPromptZh: promptSentenceZh ?? undefined, lemmas: result.lemmas }, input.trim());
    } catch (e) {
      if (e instanceof AIUnreachableError) { setStatus('unreachable'); onUnreachable(); return; }
      setStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
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
            <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Translate this sentence into German!</div>
            <div className="text-stone-700 italic">
              {/* Tap a word for a hint — its German dictionary-form
                  translation, regardless of this word's own tense/case
                  here ("reads" and "read" both just show "lesen"). English
                  goes through the same tokenize+lookup shape the corrected
                  sentence's own clickable words already use;
                  Chinese has no word boundaries to tokenize, so it's
                  segmented as a whole string instead (see
                  segmentChineseForClicks) — a pure grammar word in either
                  language (the/a, 的/了/吗) is simply never anyone's
                  corpus entry, so it naturally stays plain, non-clickable
                  text without needing an explicit exclusion list. */}
              {getSettings().nativeLanguage === 'zh' && promptSentenceZh
                ? segmentChineseForClicks(promptSentenceZh, word).map((span, i) => (
                  span.word ? (
                    <button
                      key={i}
                      type="button"
                      // Clicking the already-selected word again hides its
                      // hint instead of just re-showing the same panel.
                      onClick={() => setSelectedPromptWord(prev => (prev?.id === span.word!.id ? null : span.word!))}
                      className="hover:bg-indigo-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                    >
                      {span.text}
                    </button>
                  ) : <span key={i}>{span.text}</span>
                ))
                : tokenize(promptSentence).map((text, i) => {
                  const match = /[A-Za-z]/.test(text) ? findWordByEnglishForm(text, word) : undefined;
                  return match ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedPromptWord(prev => (prev?.id === match.id ? null : match))}
                      className="hover:bg-indigo-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                    >
                      {text}
                    </button>
                  ) : <span key={i}>{text}</span>;
                })}
            </div>
          </div>
          {selectedPromptWord && <WordInfoPanel key={`prompt-${selectedPromptWord.id}`} word={selectedPromptWord} />}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
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
          {correction ? (
            <>
              <div className="text-center py-3 rounded-xl font-semibold bg-green-50 border border-green-200 px-4">
                <div className="text-xs uppercase tracking-wide text-green-600 mb-1 font-medium flex items-center justify-center gap-1.5">
                  Correction
                  <TextSpeakerButton text={correction.sentence} className="text-green-500 hover:text-green-700 transition-colors normal-case" />
                </div>
                <div className="text-lg text-green-800">
                  {tokenize(correction.sentence).map((text, i) => {
                    // Every token is already either a whole word or a whole
                    // non-word (punctuation/whitespace) run — see tokenize's
                    // regex — so there's no need to re-split; just check
                    // whether THIS one looks up to a dictionary word at all.
                    // See resolveClickedWord for the full resolution chain
                    // (AI lemma -> heuristic -> separable-prefix repair).
                    const match = /[A-Za-zÀ-ÖØ-öø-ÿß]/.test(text)
                      ? resolveClickedWord(text, correction.lemmas, word.de)
                      : undefined;
                    return match ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedWord(prev => (prev?.id === match.id ? null : match))}
                        className="hover:bg-green-200/70 rounded px-0.5 -mx-0.5 transition-colors"
                      >
                        {text}
                      </button>
                    ) : <span key={i}>{text}</span>;
                  })}
                </div>
              </div>
              {selectedWord && <WordInfoPanel key={selectedWord.id} word={selectedWord} />}
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
// the history replay of one of those rounds). wordForm is the exact
// inflected substring the AI reported using, so the bolding lines up with
// however the word actually appears in the sentence (which may differ from
// its dictionary form, e.g. plural/case endings).
function ReferenceSentence({ example, label = 'Example sentence' }: { example: { sentence: string; wordForm: string }; label?: string }) {
  const parts = splitOnWordForm(example.sentence, example.wordForm);
  if (!parts) {
    return (
      <div className="text-center bg-indigo-50 rounded-xl px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1 flex items-center justify-center gap-1.5">
          {label}
          <TextSpeakerButton text={example.sentence} className="text-indigo-400 hover:text-indigo-600 transition-colors normal-case" />
        </div>
        <div className="text-stone-700 italic">{example.sentence}</div>
      </div>
    );
  }
  return (
    <div className="text-center bg-indigo-50 rounded-xl px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1 flex items-center justify-center gap-1.5">
        {label}
        <TextSpeakerButton text={example.sentence} className="text-indigo-400 hover:text-indigo-600 transition-colors normal-case" />
      </div>
      <div className="text-stone-700 italic">
        {parts.before}
        <span className="font-bold text-indigo-700 not-italic">
          {parts.match}
        </span>
        {parts.after}
      </div>
    </div>
  );
}

function isRoundsDone(id: string, mode: RoundMode): boolean {
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
  // REVIEW_PLAN): puppy-stage reviews run 2-3, short-stage 3-4, and
  // medium-stage is a single round (4-4, one shot at the cap). The round
  // dots below render only this range, not a fixed 4, since most episodes
  // never touch rounds outside it.
  const [roundRange, setRoundRange] = useState<[Round, Round]>([1, 2]);
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
  // a previous round-1 pass (only used to gate which round-1 UI shows —
  // no longer displayed during rounds 2+/review, see ReferenceSentence's
  // own comment for why), and the just-produced correction for the round-1
  // sentence exercise (shown in place of the generic "✓ Correct!" banner).
  const [exampleSentence, setExampleSentence] = useState<{ sentence: string; wordForm: string } | null>(null);
  const [sentenceResult, setSentenceResult] = useState<{ sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; lemmas?: Record<string, string> } | null>(null);
  // Sentence-writing-mode OFF (Settings): a correct example sentence
  // fetched directly, with no user attempt involved, shown as reference
  // alongside the copy-the-word tiles below instead of SentenceExercise's
  // translate-and-correct flow. Non-blocking — if the fetch fails, the
  // copy-the-word interaction still proceeds, just without a sentence
  // saved for this word today (same as any other bootstrap-style word).
  const [directSentence, setDirectSentence] = useState<{ sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; lemmas?: Record<string, string> } | null>(null);
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
        setDirectSentence({ sentence: result.sentence, wordForm: result.wordForm, englishPrompt, englishPromptZh, lemmas: result.lemmas });
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

  const loadCurrent = (w: Word, mode: RoundMode) => {
    const progress = getWordProgress(w.id);
    const stage = (progress.mascotStage ?? 'puppy') as 'puppy' | 'short' | 'medium';
    const plan = REVIEW_PLAN[stage];
    const round = mode === 'review' ? (reviewRoundsRef.current[w.id] ?? plan.startRound) : progress.round;
    setCurrentRound(round);
    setRoundRange(mode === 'review' ? [plan.startRound, plan.capRound] : [1, 2]);
    const h = generateHint(w.de, round);
    const chars = [...w.de];
    setHint(h);
    setValues(chars.map((c, i) => (h[i] ? '' : c)));
    setArticleValues(['', '', '']);
    setFeedback(null);
    setJustCompleted(false);
    setAttemptKey(k => k + 1);
    setExampleSentence(progress.exampleSentence ?? null);
    setSentenceResult(null);
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
    // *inclusion* in today's batch. That risks it reaching round 2 (and the
    // MCQ checkpoint never having fired yet, since that only triggers once
    // every round-1-needing word clears round 1) before a brand-new word
    // even gets its first look. Sorting round-1-needing words first, just
    // once at the start of today's session, guarantees the checkpoint
    // always runs before anyone's first round-2 attempt — carryovers
    // included — instead of only covering words that are new today.
    if (mode === 'study' && isFirstEntryToday) {
      const progress = getAllProgress();
      pending = [...pending].sort((a, b) => (progress[a]?.round ?? 1) - (progress[b]?.round ?? 1));
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
      ? { ...ds, studyQueueIds: pending }
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
      word, roundMode, round: currentRound, roundRange, wordStatus, correct, sentence: sentenceForHistory ?? null,
    }]);

    if (roundMode === 'review') {
      const outcome = applyReviewResult(progress, correct, currentRound);
      if (outcome.isFinal) delete reviewRoundsRef.current[word.id];
      else reviewRoundsRef.current[word.id] = outcome.nextRound;

      saveWordProgress(outcome.progress);
      scheduleSync();
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
      setFeedback(correct);
      setJustCompleted(completed);

      if (earnedBadge) {
        persistSession({ ...session, earnedPuppies: session.earnedPuppies + 1 });
        addEarnedPuppy();
      }
    }

    // The round-1 translate exercise already auto-plays the corrected
    // sentence itself (see SentenceExercise) — playing the bare word here
    // too would overlap it, so skip this generic word-audio call for that
    // one case only.
    if (settings.autoPlayAudio && !extra?.exampleSentence) speakWord(word);
  };

  const handleSubmit = () => {
    if (!word || !wordComplete) return;
    const wordRight = checkAnswer(word.de, values.join(''));
    const articleGuess = articleValues.join('').toLowerCase();
    const articleRight = !needsArticle || articleGuess === word.article;
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
    const h = generateHint(word.de, nextRound);
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
    // exactly when every word in today's batch has finished round 1 (the
    // sentence exercise always promotes round 1 -> 2 on submit, so
    // "round >= 2" is that signal) — before round 2 continues.
    if (!session.studyMcqDone) {
      const progress = getAllProgress();
      const allDoneRound1 = session.studyWordIds.every(id => (progress[id]?.round ?? 1) >= 2);
      if (allDoneRound1) {
        const next: DailySession = {
          ...session, studyQueueIds: restIds, phase: 'study-mcq',
          studyMcqDone: true, studyMcqQueueIds: [...session.studyWordIds],
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

  function handleCloseCongrats() {
    setShowCongrats(false);
    if (session) persistSession({ ...session, phase: 'done' });
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
    // Suppressed for the round-1 sentence exercise — the corrected sentence
    // needs a moment to actually read, not a fixed 1.5s flash, so that case
    // waits for the learner's own "Next" click instead.
    const isSentenceRoundDone = currentRound === 1 && roundMode === 'study' && sentenceResult !== null;
    const timer = feedback === true && !isSentenceRoundDone ? setTimeout(() => handleNextRef.current(), 1500) : undefined;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [feedback, isRoundScreen]);

  const articleComplete = !needsArticle || articleValues.every(v => !!v);
  const wordComplete = hint.length > 0 && hint.every((h, i) => !h || !!values[i]) && articleComplete;
  const completedCount = totalWords - queue.length;
  const progressPct = totalWords > 0 ? Math.min(100, Math.round((completedCount / totalWords) * 100)) : 0;

  if (!ready || !settings) return null;

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
    return <TranslationChoiceCard key={mcqCurrent.word.id} word={mcqCurrent.word} correct={mcqCurrent.correct} choices={mcqCurrent.choices} onAnswer={onAnswer} />;
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
    if (!showCongrats) return null;
    const dailyStats = getDailyStats();
    return (
      <CongratsModal
        studiedCount={dailyStats.studiedCount}
        reviewedCount={dailyStats.reviewedCount}
        language="German"
        level={settings?.level}
        onClose={handleCloseCongrats}
      />
    );
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
  // in-progress translation (SentenceExercise's own input is local state,
  // reset on remount) — accepted as a rare, low-stakes tradeoff rather than
  // keeping every round type's UI permanently mounted-but-hidden just for
  // this. Every other round type's state (values/hint/articleValues) lives
  // in this component already, so it's untouched either way.
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
              {CHUNK_LABELS[snap.roundRange[0]]}
            </div>
            <MilestoneBar roundRange={snap.roundRange} wordId={snap.word.id} />
          </div>

          <div className="text-center">
            <div className="text-2xl font-semibold text-slate-700">{glossFor(snap.word, getSettings().nativeLanguage)}</div>
          </div>

          {snap.sentence && snap.sentence.isDirect ? (
            <div className="flex flex-col gap-3">
              <div className="text-center -mt-1">
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Copy this word</div>
                <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide break-words">
                  {snap.word.article ? `${snap.word.article} ` : ''}{snap.word.de}
                </div>
              </div>
              <ReferenceSentence example={snap.sentence} />
              <div className={`text-center py-3 rounded-xl font-semibold text-lg ${snap.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {snap.correct ? '✓ Correct!' : '✗ Wrong that time'}
              </div>
            </div>
          ) : snap.sentence ? (
            <div className="flex flex-col gap-3">
              <SentenceWordHeader word={snap.word} />
              <div className="bg-indigo-50 rounded-xl px-3 py-2 text-center">
                <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Translate this sentence into German!</div>
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
                <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide break-words">
                  {snap.word.article ? `${snap.word.article} ` : ''}{snap.word.de}
                </div>
              </div>
              <div className={`text-center py-3 rounded-xl font-semibold text-lg ${snap.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {snap.correct ? '✓ Correct!' : '✗ Wrong that time'}
              </div>
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
              {CHUNK_LABELS[roundRange[0]]}
            </div>
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
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-95 transition-all shrink-0"
              >
                {settings.sentenceWritingMode ? 'Writing' : 'Copy'}
              </button>
            )}
          </div>
          <MilestoneBar roundRange={roundRange} wordId={word.id} />
        </div>

        <div className="text-center">
          <RoundWordImage word={word} />
          <div className="text-2xl font-semibold text-slate-700">{glossFor(word, getSettings().nativeLanguage)}</div>
        </div>

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
                <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide break-words">
                  {word.article ? `${word.article} ` : ''}{word.de} <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
                </div>
              </div>
            )}

            {useDirectSentence && directSentenceStatus === 'loading' && (
              <p className="text-stone-400 text-xs text-center">Preparing an example sentence…</p>
            )}
            {useDirectSentence && directSentenceStatus === 'ready' && directSentence && (
              <ReferenceSentence example={directSentence} />
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
                    chars={['_', '_', '_']}
                    hint={[true, true, true]}
                    values={articleValues}
                    onChange={setArticleValues}
                    onSubmit={handleSubmit}
                    disabled={feedback !== null}
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
              activeInputRef={activeInputRef}
              resetFocusKey={`${word.id}-${attemptKey}`}
              autoFocus={!needsArticle}
              onBackspaceAtStart={needsArticle ? () => {
                setArticleValues(v => v.map((c, i) => (i === v.length - 1 ? '' : c)));
                articleRowRef.current?.focusLast();
              } : undefined}
            />

            {/* min-h keeps this action area a consistent height across both
                states — without it, the "answering" layout (special-char
                row + Check + Hint) and the "feedback" layout (banner +
                Next) render at different total heights, so Check/Hint/Next
                visibly jump position every time the card switches between
                them. Sized generously enough to cover the taller variant
                (round 2+ with the Hint button, or a two-line-wrapped
                feedback message on a long word) — a shorter variant just
                leaves empty space below it instead of the container
                shrinking, since flex-col lays children out from the top
                regardless of the container's own height. */}
            {feedback === null ? (
              <div className="flex flex-col gap-3 min-h-48">
                <SpecialCharButtons inputRef={activeInputRef} />
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
              <div className="flex flex-col gap-3 min-h-48">
                <div className={`text-center py-3 px-2 rounded-xl font-semibold text-lg break-words ${feedback ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {feedback ? '✓ Correct!' : (
                    <>
                      ✗ The answer is:{' '}
                      <span className="font-mono">{word.article ? `${word.article} ` : ''}{word.de}</span>{' '}
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
