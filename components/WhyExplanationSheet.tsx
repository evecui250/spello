'use client';

import { createPortal } from 'react-dom';
import { ExplanationResult, ExplanationPoint } from '../lib/ai';
import { diffChars, renderDiffedWord } from '../lib/textDiff';

interface Props {
  explanation: ExplanationResult;
  onClose: () => void;
}

const TYPE_LABELS: Record<ExplanationPoint['type'], string> = {
  grammar: 'Grammar',
  word_order: 'Word order',
  word_form: 'Word form',
  meaning: 'Meaning',
};

// The dedicated "Why?" view — replaces the old cramped inline bullet list
// with room for a short summary plus 2-4 structured point cards (each
// showing a wrong->correct diff and a real explanation), and spelling kept
// in its own small section. Matches PetNicknameModal/MascotShopModal's own
// centered-modal convention (createPortal + backdrop + rounded panel) for
// visual consistency with the rest of Spello.
export default function WhyExplanationSheet({ explanation, onClose }: Props) {
  const { summary, points, spelling } = explanation;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Why?</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-soft hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        {summary && <p className="text-ink text-sm">{summary}</p>}

        {points.length > 0 && (
          <div className="flex flex-col gap-3">
            {points.map((point, i) => {
              const { aChanged, bChanged } = diffChars(point.wrong, point.correct);
              return (
                <div key={i} className="bg-accent/10 rounded-lg px-3 py-2.5 flex flex-col gap-1">
                  <span className="text-accent-deep text-[10px] font-semibold uppercase tracking-wide">
                    {TYPE_LABELS[point.type] ?? point.type}
                  </span>
                  <div className="text-ink text-sm">
                    {renderDiffedWord(point.wrong, aChanged)}
                    <span className="text-ink-soft mx-1.5">→</span>
                    {renderDiffedWord(point.correct, bChanged)}
                  </div>
                  <p className="text-ink-soft text-sm">{point.explanation}</p>
                </div>
              );
            })}
          </div>
        )}

        {spelling.length > 0 && (
          <div className="text-sm text-ink border-t border-paper-line pt-3">
            <span className="font-semibold">Spelling: </span>
            {spelling.map(({ wrong, correct }, i) => {
              const { aChanged, bChanged } = diffChars(wrong, correct);
              return (
                <span key={i}>
                  {i > 0 && ', '}
                  {renderDiffedWord(wrong, aChanged)}
                  {' → '}
                  {renderDiffedWord(correct, bChanged)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
