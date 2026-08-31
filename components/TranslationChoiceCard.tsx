'use client';

import { useEffect, useState } from 'react';
import { Word, glossFor } from '../lib/words';
import { getSettings } from '../lib/storage';
import { speakWord } from '../lib/speech';
import { playCorrectChime } from '../lib/sound';

interface Props {
  word: Word;
  correct: string;
  choices: string[];
  onAnswer: (correct: boolean) => void;
  // Whether this MCQ round belongs to today's review batch rather than
  // study — a day that starts with reviews due had no visual cue telling
  // the two apart, since this card's copy ("Which German word means
  // this?") reads identically either way.
  isReview?: boolean;
}

// Round 1.5 — the English word is shown, the user picks its German meaning
// (with article, e.g. "die Bibliothek") from 4 choices, all drawn from the
// word's own level so every option is something the learner could plausibly
// recognize. Reinforcement only: never touches masteryScore/growthScore/
// nextReviewDue, only the word's own round-ladder progress does that.
export default function TranslationChoiceCard({ word, correct: correctChoice, choices, onAnswer, isReview }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  // Guards against a stuck retry loop: when the same word is the only one
  // left in the round-1.5 retry queue, it comes back up as the very next
  // question with the same `word.id` — and since the parent's setMcqCurrent
  // calls (null, then the next question) both happen inside one handler,
  // React 18 batches them into a single commit and never actually unmounts
  // this component, so `selected` would otherwise carry over from the wrong
  // answer just given. `choices` is always a freshly-shuffled array from
  // buildMcqChoices — even for a repeated word — so it's a reliable signal
  // that a genuinely new question has started and the pick should reset.
  useEffect(() => {
    setSelected(null);
  }, [choices]);

  const handlePick = (choice: string) => {
    if (selected !== null) return;
    setSelected(choice);
  };

  const correct = selected !== null && selected === correctChoice;

  // Enter advances once a choice is picked. No arm/disarm double-press guard
  // here (unlike the round-ladder's Enter handling) — a choice is only ever
  // picked by clicking, never by pressing Enter, so there's no same-keypress
  // ambiguity to guard against; a single Enter press should just work.
  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') onAnswer(correct); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, correct, onAnswer]);

  // Every pick plays the word's pronunciation once. No auto-advance on a
  // correct pick any more (confirmed real: it kept firing before there
  // was time to register the correct-answer chime/reading) — every
  // answer, right or wrong, now waits for a manual Next. A correct pick
  // also plays the chime FIRST, THEN the word's pronunciation a moment
  // later — playing both at once made the chime intermittently inaudible
  // (see lib/sound's own comment on why), and the order also just reads
  // better: "yes, correct" before "here's how it's said".
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
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl shadow-sm border border-paper-line/50 p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-label">Which German word means this?</div>
          {isReview && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-label bg-paper-dim rounded-full px-2 py-0.5 shrink-0">
              Review
            </span>
          )}
        </div>
        <div className="text-center">
          <span className="text-2xl font-semibold text-ink">{glossFor(word, getSettings().nativeLanguage)}</span>
        </div>
        <div className="flex flex-col gap-2">
          {choices.map(choice => {
            const isCorrectChoice = choice === correctChoice;
            const isPicked = choice === selected;
            // A real bg-paper fill (not just a faint border on the card's
            // own translucent background) — confirmed real: against a
            // bright theme, the card's bg-paper/75 lets enough of a
            // vivid backdrop bleed through that a border-only button all
            // but disappeared. The fill keeps it visible regardless of
            // theme.
            let cls = 'border-2 border-accent/30 bg-paper/80 text-ink hover:border-accent/70 hover:bg-paper';
            if (selected !== null) {
              if (isCorrectChoice) cls = 'border-2 border-good-deep bg-good/25 text-good-deep';
              else if (isPicked) cls = 'border-2 border-clay bg-clay/20 text-clay';
              else cls = 'border-2 border-accent/30 bg-paper/60 text-ink-soft opacity-60';
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
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
