'use client';

import { useEffect, useMemo, useState } from 'react';
import { Word, glossFor, resolveClickedWord, tokenize, isWordToken } from '../lib/words';
import { ParagraphExercise } from '../lib/storage';
import { getSettings } from '../lib/storage';
import { playCorrectChime } from '../lib/sound';
import { getSentenceGlosses, WordGloss } from '../lib/ai';
import SpeakerButton from './SpeakerButton';
import WordInfoPanel from './WordInfoPanel';
import GlossPopup from './GlossPopup';

interface Props {
  exercise: ParagraphExercise;
  words: Word[]; // this batch's words, for the reveal panel after checking
  onComplete: () => void;
}

// The bonus end-of-introduction cloze paragraph: tap a word chip, then tap
// a blank to drop it there (tap a filled blank to pull it back out) --
// deliberately NOT real HTML5 drag-and-drop, which is unreliable on mobile
// touch (the actual target audience for a quick daily bonus round).
// Tracked by TRAY INDEX rather than the answer string itself throughout --
// two different words can coincidentally need the identical inflected
// form, and filtering "already placed" by string equality would then hide
// both copies the moment either one gets placed.
export default function ParagraphExerciseCard({ exercise, words, onComplete }: Props) {
  const [blankTray, setBlankTray] = useState<(number | null)[]>(() => exercise.blanks.map(() => null));
  const [selectedTray, setSelectedTray] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  // Two separate "what's selected" slots, same split as SentenceExercise's
  // own correction rendering: a real corpus match gets the rich
  // WordInfoPanel (meaning, level/book, plural or verb forms, and the
  // exact inflected form used here); anything else falls back to
  // GlossPopup's lighter lemma+gloss-only card. Only one is ever non-null
  // at a time.
  const [selectedWord, setSelectedWord] = useState<{ word: Word; usedForm?: string } | null>(null);
  const [selectedGlossToken, setSelectedGlossToken] = useState<string | null>(null);
  const [glosses, setGlosses] = useState<Record<string, WordGloss>>({});
  // Which sentence is highlighted in the post-check translation panel —
  // shared between the German and translation columns so tapping either
  // side highlights both (see TranslationPanel below). null = nothing
  // selected. Tapping the same index again clears it, same toggle
  // behavior as the tray/blank selection above.
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null);

  const wordById = useMemo(() => new Map(words.map(w => [w.id, w])), [words]);
  const usedIndices = new Set(blankTray.filter((i): i is number => i !== null));
  const allFilled = blankTray.every(i => i !== null);
  const results = checked ? blankTray.map((trayIdx, blankIdx) => trayIdx !== null && exercise.tray[trayIdx].answer === exercise.blanks[blankIdx].answer) : null;
  const allCorrect = results?.every(Boolean) ?? false;

  // The finished, CORRECT paragraph (blanks filled with their real
  // answers, not whatever the learner has tentatively placed) -- used only
  // to fetch a lemma+gloss map for the surrounding non-blank text, so
  // every ordinary word the AI wrote (not just the batch's own 5 target
  // words) is clickable too, same as a corrected sentence elsewhere in the
  // app. Stable across re-renders since it depends only on the exercise
  // itself, never on in-progress placement.
  const fullCorrectText = useMemo(
    () => exercise.segments.reduce((acc, seg, i) => acc + seg + (exercise.blanks[i]?.answer ?? ''), ''),
    [exercise],
  );

  useEffect(() => {
    let cancelled = false;
    const settings = getSettings();
    const fetchGlosses = (attempt: number) => {
      getSentenceGlosses(words[0]?.id ?? '', fullCorrectText, settings.level, settings.nativeLanguage, 'de-to-native')
        .then(map => { if (!cancelled) setGlosses(map); })
        .catch(() => {
          // One retry before giving up -- a real report ("some words
          // still aren't clickable") is at least partly explained by this
          // call having zero retry at all before, unlike every other AI
          // call in the app. Still best-effort beyond that: surrounding
          // words just aren't clickable if both attempts fail, the
          // exercise itself (and each blank's own always-available corpus
          // info) is unaffected either way.
          if (attempt === 0 && !cancelled) fetchGlosses(1);
        });
    };
    fetchGlosses(0);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullCorrectText]);

  const handleTrayTap = (trayIdx: number) => {
    if (checked || usedIndices.has(trayIdx)) return;
    setSelectedTray(prev => (prev === trayIdx ? null : trayIdx));
  };

  const handleBlankTap = (blankIdx: number) => {
    if (blankTray[blankIdx] !== null) {
      setBlankTray(arr => arr.map((v, i) => (i === blankIdx ? null : v)));
      return;
    }
    if (selectedTray === null) return;
    setBlankTray(arr => arr.map((v, i) => (i === blankIdx ? selectedTray : v)));
    setSelectedTray(null);
  };

  const handleBlankInfoTap = (blankIdx: number) => {
    const w = wordById.get(exercise.blanks[blankIdx].wordId);
    if (!w) return;
    setSelectedGlossToken(null);
    setSelectedWord(prev => (prev?.word.id === w.id ? null : { word: w, usedForm: exercise.blanks[blankIdx].answer }));
  };

  // Separate from handleBlankInfoTap/tap-to-place -- a real request: the
  // tray chips (this batch's own newly-learned words, easy to still be
  // shaky on) had no way to check meaning before placing them at all,
  // since a tap there is already spoken for (selecting which word to
  // drop next). A dedicated small button per chip avoids overloading
  // that gesture.
  const handleTrayInfoTap = (trayIdx: number) => {
    const w = wordById.get(exercise.tray[trayIdx].wordId);
    if (!w) return;
    setSelectedGlossToken(null);
    setSelectedWord(prev => (prev?.word.id === w.id ? null : { word: w, usedForm: exercise.tray[trayIdx].answer }));
  };

  const handleCheck = () => {
    setChecked(true);
    const correct = blankTray.every((trayIdx, blankIdx) => trayIdx !== null && exercise.tray[trayIdx].answer === exercise.blanks[blankIdx].answer);
    if (correct) playCorrectChime();
  };

  // Renders one segment of surrounding (non-blank) paragraph text as
  // clickable word tokens -- same resolveClickedWord-then-gloss-fallback
  // chain as SentenceExercise's own corrected-sentence rendering, minus
  // the separable-prefix repair heuristic (unnecessary here: separable
  // verbs are always forced into perfect tense server-side, so a prefix
  // can never legitimately turn up split across the text -- see
  // generate-paragraph's own comment). No targetWordDe is passed for the
  // same reason.
  const renderSegment = (segment: string, key: string) => {
    const lemmaMap = Object.fromEntries(Object.entries(glosses).map(([k, v]) => [k, v.lemma]));
    return tokenize(segment).map((text, i) => {
      if (!isWordToken(text)) return <span key={`${key}-${i}`}>{text}</span>;
      const match = resolveClickedWord(text, lemmaMap);
      const gloss = !match ? glosses[text] : undefined;
      if (match) {
        return (
          <button
            key={`${key}-${i}`}
            type="button"
            onClick={() => { setSelectedGlossToken(null); setSelectedWord(prev => (prev?.word.id === match.id ? null : { word: match })); }}
            className="hover:bg-accent/15 rounded px-0.5 -mx-0.5 transition-colors"
          >
            {text}
          </button>
        );
      }
      if (gloss) {
        return (
          <button
            key={`${key}-${i}`}
            type="button"
            onClick={() => { setSelectedWord(null); setSelectedGlossToken(prev => (prev === text ? null : text)); }}
            className="hover:bg-accent/15 rounded px-0.5 -mx-0.5 transition-colors"
          >
            {text}
          </button>
        );
      }
      return <span key={`${key}-${i}`}>{text}</span>;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl shadow-sm border border-paper-line/50 p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium text-label">
            {checked ? (allCorrect ? 'Perfect!' : 'Here\'s how it fits together') : 'Tap a word, then tap where it belongs'}
          </div>
          {/* Purely informational -- lets a learner curious about how
              this gets generated know at a glance, not tied to anything
              functional. Hardcoded rather than round-tripped from the
              server: this is cosmetic copy, not something that needs to
              survive a future model swap without a code change anyway. */}
          <span className="shrink-0 text-[11px] font-medium text-ink-soft/70 whitespace-nowrap">
            AI model: GPT-5.6-Luna
          </span>
        </div>

        {/* whitespace-pre-line only ever matters for the rare fallback
            where two smaller paragraphs got stitched into one exercise
            (see combineParagraphExercises) — a normal single-paragraph
            generation never contains a literal newline, so this is a
            no-op there and just lets that stitched boundary render as a
            real paragraph break instead of collapsing to one space. */}
        <div className="text-lg leading-relaxed text-ink whitespace-pre-line">
          {exercise.segments.map((segment, i) => (
            <span key={i}>
              {renderSegment(segment, `s${i}`)}
              {i < exercise.blanks.length && (
                <BlankSlot
                  filled={blankTray[i] !== null ? exercise.tray[blankTray[i] as number].answer : null}
                  selectable={!checked && blankTray[i] === null && selectedTray !== null}
                  checked={checked}
                  correct={results ? results[i] : null}
                  correctAnswer={exercise.blanks[i].answer}
                  onTap={() => (checked ? handleBlankInfoTap(i) : handleBlankTap(i))}
                />
              )}
            </span>
          ))}
        </div>

        {(selectedWord || selectedGlossToken) && (
          selectedWord
            ? <WordInfoPanel key={selectedWord.word.id} word={selectedWord.word} usedForm={selectedWord.usedForm} />
            : selectedGlossToken && glosses[selectedGlossToken] && (
              <GlossPopup surfaceForm={selectedGlossToken} gloss={glosses[selectedGlossToken]} />
            )
        )}

        {!checked && (
          <div className="flex flex-wrap gap-2 justify-center pt-1 border-t border-paper-line/60">
            {exercise.tray.map(({ answer }, trayIdx) =>
              usedIndices.has(trayIdx) ? null : (
                <div key={trayIdx} className="relative">
                  <button
                    onClick={() => handleTrayTap(trayIdx)}
                    className={`px-4 py-2 rounded-xl font-medium border-2 transition-all ${
                      selectedTray === trayIdx
                        ? 'border-accent bg-accent/15 text-label scale-105'
                        : 'border-accent/30 bg-paper/80 text-ink hover:border-accent/70'
                    }`}
                  >
                    {answer}
                  </button>
                  {/* Separate from the button above on purpose -- tapping
                      the chip itself selects it for placement, so "show
                      meaning" needs its own small target rather than
                      overloading that same tap. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleTrayInfoTap(trayIdx); }}
                    aria-label="Show meaning"
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center hover:bg-accent shadow-sm"
                  >
                    i
                  </button>
                </div>
              ),
            )}
          </div>
        )}

        {!checked && (
          <button
            onClick={handleCheck}
            disabled={!allFilled}
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all disabled:opacity-40 disabled:hover:bg-accent"
          >
            Check
          </button>
        )}

        {checked && (
          <>
            <div className="flex flex-col gap-2 pt-1 border-t border-paper-line/60">
              {exercise.blanks.map((blank, i) => {
                const w = wordById.get(blank.wordId);
                if (!w) return null;
                return (
                  <div key={i} className="flex items-center justify-between gap-3 bg-paper/70 rounded-xl px-4 py-2.5">
                    <div>
                      <span className="font-semibold text-ink">
                        {w.article ? `${w.article} ` : ''}{w.de}
                        <SpeakerButton word={w} className="ml-1.5 text-label hover:text-ink transition-colors align-middle" />
                      </span>
                      <div className="text-ink-soft text-sm">{glossFor(w, getSettings().nativeLanguage)}</div>
                    </div>
                    <span className={`shrink-0 text-lg ${results?.[i] ? 'text-good-deep' : 'text-clay'}`}>
                      {results?.[i] ? '✓' : '✗'}
                    </span>
                  </div>
                );
              })}
            </div>
            {exercise.translations && exercise.sentences && exercise.translations.length > 0
              && exercise.translations.length === exercise.sentences.length && (
              <TranslationPanel
                sentences={exercise.sentences}
                translations={exercise.translations}
                selected={selectedSentence}
                onSelect={i => setSelectedSentence(prev => (prev === i ? null : i))}
              />
            )}
            <button
              onClick={onComplete}
              className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
            >
              Continue →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// The post-check translation panel — German story (already fully
// resolved to its correct answers) above, the learner's own native-
// language translation below, split into parallel sentences (see
// generate-paragraph's own comment for how they're aligned). Tapping
// either side highlights that sentence AND its counterpart, so it's easy
// to line them up — exactly the interaction from the owner-approved
// design preview, just wired to real per-sentence data now instead of
// placeholder content. No separate language toggle — this always shows
// whichever language generate-paragraph was asked for (the learner's own
// Settings → native language), same as every other translation in the app.
function TranslationPanel({
  sentences, translations, selected, onSelect,
}: {
  sentences: string[];
  translations: string[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pt-1 border-t border-paper-line/60">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Translation</div>
      <div className="text-base leading-relaxed text-ink">
        {sentences.map((s, i) => (
          <span
            key={i}
            onClick={() => onSelect(i)}
            className={`cursor-pointer rounded px-0.5 -mx-0.5 transition-colors ${
              selected === i ? 'bg-accent/25 ring-1 ring-accent' : 'hover:bg-accent/10'
            }`}
          >
            {s}{i < sentences.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
      <div className="text-base leading-relaxed text-ink-soft border-t border-paper-line/40 pt-3">
        {translations.map((t, i) => (
          <span
            key={i}
            onClick={() => onSelect(i)}
            className={`cursor-pointer rounded px-0.5 -mx-0.5 transition-colors ${
              selected === i ? 'bg-accent/25 ring-1 ring-accent text-ink' : 'hover:bg-accent/10'
            }`}
          >
            {t}{i < translations.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function BlankSlot({
  filled, selectable, checked, correct, correctAnswer, onTap,
}: {
  filled: string | null;
  selectable: boolean;
  checked: boolean;
  correct: boolean | null;
  correctAnswer: string;
  onTap: () => void;
}) {
  let cls = 'border-paper-line bg-paper/60 text-ink-soft';
  if (checked) {
    cls = correct ? 'border-good-deep bg-good/25 text-good-deep hover:bg-good/35' : 'border-clay bg-clay/20 text-clay hover:bg-clay/30';
  } else if (filled !== null) {
    cls = 'border-accent/70 bg-accent/10 text-label';
  } else if (selectable) {
    cls = 'border-accent/70 bg-accent/60 text-ink animate-pulse';
  }
  return (
    <button
      onClick={onTap}
      className={`inline-flex items-center justify-center mx-1 px-2 py-0.5 rounded-lg border-2 font-semibold align-baseline ${cls}`}
    >
      {checked ? correctAnswer : (filled ?? '____')}
      {checked && !correct && filled && <span className="ml-1 text-xs line-through opacity-70">{filled}</span>}
    </button>
  );
}
