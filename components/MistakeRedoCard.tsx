'use client';

import { useEffect, useState } from 'react';
import { Word, Level, glossFor, diffAgainstAttempt, resolveClickedWord, isWordToken, findWordByEnglishForm, segmentChineseForClicks, applyGlossFallback, tokenize } from '../lib/words';
import { WordProgress, getSettings, getWordProgress, saveWordProgress, today } from '../lib/storage';
import { correctSentence, explainCorrection, getSentenceGlosses, WordGloss, ExplanationResult, DailyLimitReachedError, AIUnreachableError } from '../lib/ai';
import { scheduleSync } from '../lib/sync';
import { playCorrectChime } from '../lib/sound';
import { supabase } from '../lib/supabase';
import SpeakerButton from './SpeakerButton';
import TextSpeakerButton from './TextSpeakerButton';
import WordInfoPanel from './WordInfoPanel';
import GlossPopup from './GlossPopup';
import { PointsIcon } from './icons';

interface Props {
  word: Word;
  mistake: NonNullable<WordProgress['lastMistake']>;
  level: Level;
  onDone: () => void;
}

// The Word List's "Needs practice" redo flow (the "Mistake Notebook") —
// re-shows the EXACT SAME English prompt a word's round-1 introduction
// used (see WordProgress.lastMistake's own comment for why round 1 only
// ever happens once, so this is the only way to ever revisit it) and
// calls correctSentence live again on a fresh attempt, same as the real
// exercise does. Deliberately never touches round/mascotStage/scheduling —
// this is pure extra reinforcement, same "never touches scoring" status
// every other bonus/practice-more path in the app already has. Feature
// parity with the real correction card (SentenceExercise in
// DailySessionFlow) was a real request: clickable words, a "Why?"
// explanation, and the learner's own just-typed attempt staying visible
// alongside the correction, instead of a stripped-down diff-only view.
export default function MistakeRedoCard({ word, mistake, level, onDone }: Props) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'limit-reached' | 'unreachable'>('idle');
  const [result, setResult] = useState<{ sentence: string; wordForm: string } | null>(null);
  const [glosses, setGlosses] = useState<Record<string, WordGloss>>({});
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [selectedGlossToken, setSelectedGlossToken] = useState<string | null>(null);
  // Same idea as glosses/selectedWord above, but for the PROMPT sentence
  // (a hint while still attempting the translation) — kept fully separate
  // so tapping a word in one sentence never disturbs whatever's showing
  // for the other, same as the real correction card.
  const [promptGlosses, setPromptGlosses] = useState<Record<string, WordGloss>>({});
  const [selectedPromptWord, setSelectedPromptWord] = useState<Word | null>(null);
  const [selectedPromptGlossToken, setSelectedPromptGlossToken] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ExplanationResult | null>(null);
  const [explanationStatus, setExplanationStatus] = useState<'idle' | 'loading' | 'error' | 'limit-reached'>('idle');
  // Set true only when a perfect correction actually earns a NEW point --
  // i.e. this word hadn't already been touched today via the normal
  // study/review flow (points are 1-per-distinct-word-per-day, driven by
  // lastPracticed -- see this card's own handleSubmit for where that gets
  // set). Points only actually accrue for signed-in learners.
  const [earnedPoint, setEarnedPoint] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);
  const nativeLanguage = getSettings().nativeLanguage;

  const diff = result ? diffAgainstAttempt(input, result.sentence) : null;
  const promptOnScreen = nativeLanguage === 'zh' ? (mistake.englishPromptZh ?? mistake.englishPrompt) : mistake.englishPrompt;

  // Same best-effort per-word lemma+gloss fetch as the real correction
  // card, so every content word in the correction (not just ones already
  // in Spello's own corpus) ends up clickable.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    getSentenceGlosses(word.id, result.sentence, level, nativeLanguage)
      .then(words => { if (!cancelled) setGlosses(words); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Prompt words are clickable from the moment the card opens (unlike the
  // correction, which only exists after a check) — same 'native-to-de'
  // direction as SentenceExercise's own prompt-gloss fetch.
  useEffect(() => {
    if (!promptOnScreen) return;
    let cancelled = false;
    getSentenceGlosses(word.id, promptOnScreen, level, nativeLanguage, 'native-to-de')
      .then(words => { if (!cancelled) setPromptGlosses(words); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptOnScreen]);

  const handleSubmit = () => {
    if (!input.trim() || status === 'loading') return;
    setStatus('loading');
    correctSentence(word.id, word.de, level, mistake.englishPrompt ?? '', input.trim())
      .then(correction => {
        setResult(correction);
        setStatus('idle');
        const perfect = diffAgainstAttempt(input, correction.sentence).perfect;
        if (perfect) playCorrectChime();
        // Re-read fresh rather than trusting a closed-over copy of `word`
        // (which has no progress fields at all) — this card can sit open
        // a while (the learner may pause to think), and other progress
        // writes elsewhere shouldn't be clobbered by a stale snapshot.
        const current = getWordProgress(word.id);
        const at = new Date().toISOString();
        const t = today();
        // A perfect correction earns a point the same way any other
        // practice does -- by touching lastPracticed, which is exactly
        // what daily_activity's words_studied (and so the points economy,
        // see lib/shop.ts) already counts, once per distinct word per
        // day. Only a genuinely NEW touch today earns a NEW point --
        // re-perfecting a word already practiced today via the normal
        // flow doesn't double-count, same as any other source wouldn't.
        setEarnedPoint(perfect && current.lastPracticed !== t);
        saveWordProgress({
          ...current,
          lastPracticed: perfect ? t : current.lastPracticed,
          exampleSentence: perfect
            ? { sentence: correction.sentence, wordForm: correction.wordForm, englishPrompt: mistake.englishPrompt, englishPromptZh: mistake.englishPromptZh, at }
            : current.exampleSentence,
          lastMistake: perfect ? undefined : {
            englishPrompt: mistake.englishPrompt,
            englishPromptZh: mistake.englishPromptZh,
            userInput: input.trim(),
            correctedSentence: correction.sentence,
            wordForm: correction.wordForm,
            at,
          },
        });
        scheduleSync();
      })
      .catch(e => {
        if (e instanceof AIUnreachableError) { setStatus('unreachable'); return; }
        setStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
      });
  };

  async function handleExplain() {
    if (!result) return;
    setExplanationStatus('loading');
    try {
      const maxPoints = diff ? Math.max(1, diff.tokens.filter(t => t.changed).length) : undefined;
      const explained = await explainCorrection(word.id, word.de, level, input, result.sentence, nativeLanguage, maxPoints);
      setExplanation(explained);
      setExplanationStatus('idle');
    } catch (e) {
      setExplanationStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
    }
  }

  return (
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl shadow-sm border border-paper-line/50 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-ink">
          {word.article ? `${word.article} ` : ''}{word.de}
          <SpeakerButton word={word} className="ml-1.5 align-middle text-label hover:text-label transition-colors text-base" />
        </span>
        <span className="text-ink-soft text-sm">{glossFor(word, nativeLanguage)}</span>
      </div>

      <div className="bg-accent/10 rounded-xl px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-label mb-1">Translate to German</div>
        <div className="text-ink italic">
          {promptOnScreen && nativeLanguage === 'zh'
            ? applyGlossFallback(segmentChineseForClicks(promptOnScreen, word), promptGlosses).map((span, i) => {
              if (span.word) {
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setSelectedPromptGlossToken(null); setSelectedPromptWord(prev => (prev?.id === span.word!.id ? null : span.word!)); }}
                    className="hover:bg-accent/70 rounded px-0.5 -mx-0.5 transition-colors not-italic"
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
                    className="hover:bg-accent/70 rounded px-0.5 -mx-0.5 transition-colors not-italic"
                  >
                    {span.text}
                  </button>
                );
              }
              return <span key={i}>{span.text}</span>;
            })
            : promptOnScreen && tokenize(promptOnScreen).map((text, i, tokens) => {
              const nextWordToken = tokens.slice(i + 1).find(isWordToken);
              const match = /[A-Za-z]/.test(text) ? findWordByEnglishForm(text, word, nextWordToken) : undefined;
              const gloss = !match ? promptGlosses[text] : undefined;
              if (match) {
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setSelectedPromptGlossToken(null); setSelectedPromptWord(prev => (prev?.id === match.id ? null : match)); }}
                    className="hover:bg-accent/70 rounded px-0.5 -mx-0.5 transition-colors"
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
                    className="hover:bg-accent/70 rounded px-0.5 -mx-0.5 transition-colors"
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
          gloss={promptGlosses[selectedPromptGlossToken]}
        />
      )}

      {/* Stays visible (disabled once checked) rather than disappearing —
          same as the real correction card, so the learner's own just-typed
          attempt is still on screen right alongside the correction below,
          not just implied by the diff underlines. */}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!result) handleSubmit();
          }
        }}
        disabled={status === 'loading' || !!result}
        rows={2}
        placeholder="Type your German translation…"
        className="w-full border-2 border-paper-line rounded-xl px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent/50 resize-none disabled:opacity-60"
      />

      {!result && (
        <>
          {status === 'error' && <p className="text-clay text-xs">Couldn't check that — try again.</p>}
          {status === 'limit-reached' && <p className="text-label text-xs">Used up today's practice limit — come back tomorrow.</p>}
          {status === 'unreachable' && <p className="text-label text-xs">Can't reach our AI service right now.</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || status === 'loading'}
              className="flex-1 bg-accent text-white py-2.5 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all disabled:opacity-40"
            >
              {status === 'loading' ? 'Checking…' : 'Check'}
            </button>
            <button onClick={onDone} className="text-ink-soft text-sm px-3">Close</button>
          </div>
        </>
      )}

      {result && diff && (
        <>
          <div className="relative bg-good/25 border border-good rounded-xl px-4 py-3">
            {!diff.perfect && !explanation && (
              <button
                type="button"
                onClick={handleExplain}
                disabled={explanationStatus === 'loading'}
                aria-label="Explain the grammar"
                className="absolute top-2 right-2 text-label text-xs font-semibold bg-paper/70 hover:bg-paper hover:text-label rounded-full px-2 py-0.5 transition-colors disabled:opacity-50"
              >
                {explanationStatus === 'loading' ? '…' : 'Why?'}
              </button>
            )}
            <div className="text-xs uppercase tracking-wide text-good-deep mb-1 font-medium flex items-center justify-center gap-1.5">
              {diff.perfect ? '✓ Perfect!' : 'Correction'}
              <TextSpeakerButton text={result.sentence} className="text-good hover:text-good-deep transition-colors normal-case" />
            </div>
            {diff.perfect && earnedPoint && signedIn && (
              <div className="flex items-center justify-center gap-1 text-good-deep font-mono font-bold text-xs mb-1">
                <PointsIcon className="w-3.5 h-3.5" /> +1 point
              </div>
            )}
            <div className="text-lg text-good-deep text-center">
              {diff.tokens.map(({ text, changed }, i) => {
                const lemmaMap = Object.fromEntries(Object.entries(glosses).map(([k, v]) => [k, v.lemma]));
                const match = isWordToken(text) ? resolveClickedWord(text, lemmaMap, word.de) : undefined;
                const gloss = !match ? glosses[text] : undefined;
                const underline = changed ? ' underline decoration-accent decoration-2 underline-offset-2 font-bold' : '';
                if (match) {
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setSelectedGlossToken(null); setSelectedWord(prev => (prev?.id === match.id ? null : match)); }}
                      className={`hover:bg-good/70 rounded px-0.5 -mx-0.5 transition-colors${underline}`}
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
                      className={`hover:bg-good/70 rounded px-0.5 -mx-0.5 transition-colors${underline}`}
                    >
                      {text}
                    </button>
                  );
                }
                return <span key={i} className={underline || undefined}>{text}</span>;
              })}
            </div>
          </div>
          {!diff.perfect && explanation && (
            <div className="flex flex-col gap-1.5 -mt-1 bg-accent/10 rounded-lg px-4 py-2">
              {explanation.points.length > 0 && (
                <ul className="list-disc pl-5 flex flex-col gap-1 text-sm text-ink">
                  {explanation.points.map((point, i) => <li key={i}>{point}</li>)}
                </ul>
              )}
            </div>
          )}
          {!diff.perfect && explanationStatus === 'error' && (
            <p className="text-clay text-xs -mt-1">Couldn't load an explanation — try again.</p>
          )}
          {!diff.perfect && explanationStatus === 'limit-reached' && (
            <p className="text-label text-xs -mt-1">Used up today's practice limit — come back tomorrow.</p>
          )}
          {selectedWord && <WordInfoPanel key={selectedWord.id} word={selectedWord} />}
          {!selectedWord && selectedGlossToken && glosses[selectedGlossToken] && (
            <GlossPopup surfaceForm={selectedGlossToken} gloss={glosses[selectedGlossToken]} />
          )}
          {diff.perfect ? (
            <p className="text-good-deep text-sm text-center">Cleared from your mistake notebook</p>
          ) : (
            <p className="text-ink-soft text-sm text-center">Still not quite — want to try again?</p>
          )}
          <div className="flex gap-2">
            {!diff.perfect && (
              <button
                onClick={() => { setResult(null); setInput(''); setStatus('idle'); setGlosses({}); setSelectedWord(null); setSelectedGlossToken(null); setExplanation(null); setExplanationStatus('idle'); }}
                className="flex-1 bg-accent text-white py-2.5 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
              >
                Try again
              </button>
            )}
            <button
              onClick={onDone}
              className={diff.perfect ? 'flex-1 bg-accent text-white py-2.5 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all' : 'text-ink-soft text-sm px-3'}
            >
              {diff.perfect ? 'Done' : 'Close'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
