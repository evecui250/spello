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

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl shadow-sm border border-paper-line/50 p-6 flex flex-col gap-4">
        <div className="text-sm font-medium text-accent-deep">Match each word to its meaning</div>
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
            let germanCls = 'border-2 border-accent/30 bg-white/80 text-ink hover:border-accent/70 hover:bg-white';
            if (isCorrect) germanCls = 'border-2 border-good-deep bg-good/25 text-good-deep';
            else if (isWrong) germanCls = 'border-2 border-clay bg-clay/20 text-clay';
            else if (isSelected) germanCls = 'border-2 border-accent bg-accent/10 text-accent-deep';

            const text = shuffledEn[i];
            const enIsCorrect = words.some(ew => correctIds.has(ew.id) && glossFor(ew, nativeLanguage) === text);
            const enIsSelected = selectedEnglish === text;
            const enIsWrong = wrongFlash?.english === text;
            let enCls = 'border-2 border-accent/30 bg-white/80 text-ink hover:border-accent/70 hover:bg-white';
            if (enIsCorrect) enCls = 'border-2 border-good-deep bg-good/25 text-good-deep';
            else if (enIsWrong) enCls = 'border-2 border-clay bg-clay/20 text-clay';
            else if (enIsSelected) enCls = 'border-2 border-accent bg-accent/10 text-accent-deep';

            return (
              <Fragment key={w.id}>
                <button
                  onClick={() => pickGerman(w.id)}
                  disabled={isCorrect || !!wrongFlash}
                  className={`px-3 py-2.5 rounded-xl font-semibold text-sm text-left transition-colors ${germanCls}`}
                >
                  {w.article ? `${w.article} ` : ''}{w.de}
                </button>
                <button
                  onClick={() => pickEnglish(text)}
                  disabled={enIsCorrect || !!wrongFlash}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${enCls}`}
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
