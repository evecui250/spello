'use client';

import { useEffect, useState } from 'react';
import { Word } from '../lib/words';
import { speakWord, spokenForm } from '../lib/speech';
import { playCorrectChime } from '../lib/sound';
import SpeakerButton from './SpeakerButton';

interface Props {
  word: Word;
  correct: string;
  choices: string[];
  onAnswer: (correct: boolean) => void;
  isReview?: boolean;
  // Day-wide "Can't listen right now" flag (see DailySession's own
  // mcqReversedRevealed) — once set, every audio-first question today
  // starts pre-revealed instead of making the learner tap the fallback
  // button again for every single word.
  initiallyRevealed?: boolean;
  onReveal?: () => void;
}

// The reverse of TranslationChoiceCard: the learner picks the MEANING of a
// German word from 4 choices (see lib/practice.ts's buildReverseMcqChoices
// for how those are picked). Audio-first (owner call): the word itself
// stays HIDDEN and is only spoken aloud, not shown as text, until either
// the learner answers or explicitly asks to see it instead — listening
// comprehension is the actual point of this direction, and showing the
// written word alongside defeats that the same way subtitles undercut
// listening practice. Deliberately different eyebrow copy from
// TranslationChoiceCard ("What does this word mean?" vs "Which German
// word means this?") rather than reusing the same phrase for both
// directions — two near-identical 4-choice screens are easy to answer on
// autopilot without registering which direction is actually being tested;
// distinct framing keeps that a conscious choice each time.
// Reinforcement only, same as TranslationChoiceCard: never touches
// mastery/growth scoring or nextReviewDue on its own.
export default function WordMeaningChoiceCard({ word, correct: correctChoice, choices, onAnswer, isReview, initiallyRevealed, onReveal }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  // The learner's own escape hatch for "I can't listen right now" (no
  // headphones, a noisy room, sound off) — falls back to exactly the old
  // show-the-word behavior. Seeded from (and reset back to) whatever the
  // day-wide flag says, not hardcoded false, since tapping the fallback
  // once means every OTHER word today should also start revealed (see
  // onReveal/initiallyRevealed's own comment).
  const [wordRevealed, setWordRevealed] = useState(!!initiallyRevealed);

  // Same reset-on-fresh-question guard as TranslationChoiceCard's own
  // effect — see its comment for why `choices` (always freshly shuffled,
  // even for a repeated word) is the reliable signal here rather than
  // `word.id` alone. Deliberately NOT keyed on `initiallyRevealed` too —
  // that flag flipping true from THIS card's own fallback tap already set
  // local wordRevealed directly; re-running this on that same change would
  // just be a redundant no-op, not a bug, but there's no reason to invite
  // the extra render.
  useEffect(() => {
    setSelected(null);
    setWordRevealed(!!initiallyRevealed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices]);

  // Plays the word once a fresh question is actually on screen — this is
  // the ONLY way the learner encounters the word before answering (no
  // written form shown), so unlike SpeakerButton elsewhere this isn't an
  // optional nicety, it's the question itself. Skipped once the day-wide
  // "can't listen right now" flag is set — that's the learner explicitly
  // saying audio isn't wanted right now, not just for this one word.
  useEffect(() => {
    if (initiallyRevealed) return;
    speakWord(word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices]);

  const handlePick = (choice: string) => {
    if (selected !== null) return;
    setSelected(choice);
  };

  const correct = selected !== null && selected === correctChoice;
  // Revealed once answered regardless — confirming what was actually
  // just heard (and, on a miss, what it should have been) matters more
  // once the question is already settled than keeping it hidden does.
  const showWord = wordRevealed || selected !== null;

  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') onAnswer(correct); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, correct, onAnswer]);

  useEffect(() => {
    if (selected === null) return;
    if (correct) {
      playCorrectChime();
      const timer = setTimeout(() => speakWord(word), 550);
      return () => clearTimeout(timer);
    }
    speakWord(word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, word]);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-indigo-600">What does this word mean?</div>
          {isReview && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 shrink-0">
              Review
            </span>
          )}
        </div>
        {/* Fixed height regardless of which branch renders — the pre-answer
            audio prompt (icon + two lines of helper text) is taller than
            the post-answer revealed word, and letting the card's own
            height follow that difference made it visibly shrink the
            instant an answer was picked. */}
        <div className="min-h-[132px] flex flex-col items-center justify-center gap-2">
          {showWord ? (
            <div className="text-center">
              <span className="text-2xl font-semibold text-slate-700">
                {spokenForm(word)}
                <SpeakerButton word={word} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
              </span>
            </div>
          ) : (
            <>
              <button
                onClick={() => speakWord(word)}
                aria-label="Play the word again"
                className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-3xl hover:bg-indigo-200 active:scale-95 transition-all"
              >
                🔊
              </button>
              <span className="text-xs text-slate-400">Tap to hear it again</span>
              <button
                onClick={() => { setWordRevealed(true); onReveal?.(); }}
                className="text-xs text-indigo-500 underline mt-1"
              >
                Can't listen right now? Show the word
              </button>
            </>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {choices.map(choice => {
            const isCorrectChoice = choice === correctChoice;
            const isPicked = choice === selected;
            let cls = 'border-2 border-indigo-200 bg-white/80 text-slate-700 hover:border-indigo-400 hover:bg-white';
            if (selected !== null) {
              if (isCorrectChoice) cls = 'border-2 border-green-400 bg-green-100 text-green-700';
              else if (isPicked) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
              else cls = 'border-2 border-indigo-200 bg-white/60 text-slate-400 opacity-60';
            }
            return (
              <button
                key={choice}
                onClick={() => handlePick(choice)}
                disabled={selected !== null}
                className={`text-left px-4 py-3 rounded-xl font-medium transition-colors ${cls}`}
              >
                {choice}
              </button>
            );
          })}
        </div>
        {selected !== null && (
          <button
            onClick={() => onAnswer(correct)}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
