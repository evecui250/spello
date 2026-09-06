'use client';

import { Fragment, useEffect, useState } from 'react';
import { Word, glossFor } from '../lib/words';
import { getSettings } from '../lib/storage';
import { speakWord } from '../lib/speech';
import { playCorrectChime } from '../lib/sound';

interface Props {
  words: Word[];
  onComplete: () => void;
}

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// One page of the end-of-section matching quiz (exactly 5 words): click a
// German word and an English meaning, in either order, to try pairing them.
// A correct pair locks in green; a wrong one flashes red and both sides
// become pickable again — keep retrying until every pair on this page is
// correct, then "Continue" advances to the next page.
export default function MatchingQuizPage({ words, onComplete }: Props) {
  const nativeLanguage = getSettings().nativeLanguage;
  const [shuffledEn] = useState(() => shuffled(words.map(w => glossFor(w, nativeLanguage))));
  const [correctIds, setCorrectIds] = useState<Set<string>>(new Set());
  const [selectedGerman, setSelectedGerman] = useState<string | null>(null);
  const [selectedEnglish, setSelectedEnglish] = useState<string | null>(null);
  const [wrongFlash, setWrongFlash] = useState<{ german: string; english: string } | null>(null);

  const allCorrect = correctIds.size === words.length;

  // Chimes once, exactly when this page's last pair locks in — "finished
  // the matching quiz", not every individual correct pair along the way.
  useEffect(() => {
    if (allCorrect) playCorrectChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCorrect]);

  // Once both sides of a pair are selected (in either order), evaluate it.
  useEffect(() => {
    if (!selectedGerman || !selectedEnglish) return;
    const word = words.find(w => w.id === selectedGerman);
    if (!word) return;
    if (glossFor(word, nativeLanguage) === selectedEnglish) {
      setCorrectIds(prev => new Set(prev).add(selectedGerman));
      setSelectedGerman(null);
      setSelectedEnglish(null);
      // No speakWord here — pickGerman already spoke this word the moment
      // it was tapped (confirmed real: playing it a second time here, on
      // top of that, made every correct match speak twice — once for the
      // German tap, once again for completing the pair). One play per
      // word per attempt is enough.
      return;
    }
    setWrongFlash({ german: selectedGerman, english: selectedEnglish });
    const timer = setTimeout(() => {
      setWrongFlash(null);
      setSelectedGerman(null);
      setSelectedEnglish(null);
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGerman, selectedEnglish]);

  const pickGerman = (id: string) => {
    if (correctIds.has(id) || wrongFlash) return;
    setSelectedGerman(id);
    // Always speaks on tap, independent of the autoPlayAudio setting —
    // this is a deliberate "let me hear it" action, same as tapping the
    // speaker icon elsewhere, not the kind of automatic playback that
    // setting is meant to gate.
    const word = words.find(w => w.id === id);
    if (word) speakWord(word);
  };

  const pickEnglish = (text: string) => {
    if (wrongFlash) return;
    const alreadyCorrect = words.some(w => correctIds.has(w.id) && glossFor(w, nativeLanguage) === text);
    if (alreadyCorrect) return;
    setSelectedEnglish(text);
  };

  // Shared "tactile tile" treatment for every pairing button below (idle/
  // hover/selected/wrong/correct) — soft resting depth, a lift on hover,
  // and a pulsing ring while a tile is selected and waiting for its pair,
  // instead of a flat color-only state change.
  const TILE_IDLE = 'border-2 border-paper-line bg-paper/90 text-ink shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-accent/60 active:translate-y-0 active:scale-[0.98]';
  const TILE_SELECTED = 'border-2 border-accent bg-accent/10 text-label shadow-md animate-pulse';
  const TILE_WRONG = 'border-2 border-clay bg-clay/20 text-clay shadow-sm';
  const TILE_CORRECT = 'border-2 border-good-deep bg-good/25 text-good-deep shadow-sm';

  return (
    // Vertically centered in whatever space this page leaves below the
    // fixed nav/roadmap bar — same min-height convention Home already uses
    // (see app/page.tsx) — rather than sitting pinned to the top.
    <div className="flex flex-col justify-center min-h-[calc(100dvh-11rem)]">
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl shadow-sm border border-paper-line/50 p-6 flex flex-col gap-4">
        <div className="text-sm font-medium text-label">Match each word to its meaning</div>
        {/* One shared grid (German+English interleaved in DOM order) rather
            than two independently-flexed columns — CSS Grid sizes each row
            to its tallest cell across BOTH columns, so a two-line German
            word (more likely to wrap at a larger font size) still keeps
            that row's English cell vertically centered alongside it instead
            of the columns drifting out of alignment as soon as any text
            wraps. Pairing itself is still by click, never by row position —
            English stays independently shuffled — this only keeps the grid
            itself looking like a clean set of rows. */}
        <div className="grid grid-cols-2 gap-3">
          {words.map((w, i) => {
            const isCorrect = correctIds.has(w.id);
            const isSelected = selectedGerman === w.id;
            const isWrong = wrongFlash?.german === w.id;
            let germanCls = TILE_IDLE;
            if (isCorrect) germanCls = TILE_CORRECT;
            else if (isWrong) germanCls = TILE_WRONG;
            else if (isSelected) germanCls = TILE_SELECTED;

            const text = shuffledEn[i];
            const enIsCorrect = words.some(ew => correctIds.has(ew.id) && glossFor(ew, nativeLanguage) === text);
            const enIsSelected = selectedEnglish === text;
            const enIsWrong = wrongFlash?.english === text;
            let enCls = TILE_IDLE;
            if (enIsCorrect) enCls = TILE_CORRECT;
            else if (enIsWrong) enCls = TILE_WRONG;
            else if (enIsSelected) enCls = TILE_SELECTED;

            return (
              <Fragment key={w.id}>
                <button
                  onClick={() => pickGerman(w.id)}
                  disabled={isCorrect || !!wrongFlash}
                  className={`px-3.5 py-3 rounded-2xl text-left transition-all duration-200 ${germanCls}`}
                >
                  <span className="font-semibold text-base" style={{ fontFamily: 'var(--font-fraunces)' }}>
                    {w.article ? `${w.article} ` : ''}{w.de}
                  </span>
                </button>
                <button
                  onClick={() => pickEnglish(text)}
                  disabled={enIsCorrect || !!wrongFlash}
                  className={`px-3.5 py-3 rounded-2xl text-sm font-medium text-left transition-all duration-200 ${enCls}`}
                >
                  {text}
                </button>
              </Fragment>
            );
          })}
        </div>
        {allCorrect && (
          <button
            onClick={onComplete}
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
