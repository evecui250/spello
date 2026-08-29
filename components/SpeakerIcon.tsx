// Plain line-art speaker glyph (no emoji) shared by every "tap to hear
// pronunciation" button — SpeakerButton, TextSpeakerButton, GlossPopup.
// Inherits color from its parent button via currentColor, same as the
// emoji it replaces did through the button's own text color class.
interface Props {
  className?: string;
  // SpeakerButton's own brief "that didn't play" state (see its own
  // comment) — swaps the sound-wave lines for a small X, same speaker
  // cone underneath, so it still reads as "speaker" but visibly silenced
  // rather than looking identical to the normal, working state.
  muted?: boolean;
}

export default function SpeakerIcon({ className = 'w-4 h-4 inline-block align-middle', muted = false }: Props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M3 8v4h3.2L10 15V5L6.2 8H3z" fill="currentColor" />
      {muted ? (
        <path
          d="M13 6l5 6M18 6l-5 6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M13 7c1 .8 1 5.2 0 6M15.3 5c2 1.8 2 8.2 0 10"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
