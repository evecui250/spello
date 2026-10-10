'use client';

import { useRef, useState } from 'react';

// Profile → Books & level: the learner's own books as a list (tap to study
// one, swipe left to reveal Remove), like a mail or notes app. Pointer
// events, so it works with a finger on the phone and a mouse drag on a
// computer. Only one row is open at a time.
export interface BookListItem {
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
}

const ACTION_WIDTH = 88;

function SwipeRow({ item, open, onOpen, onClose, onSelect, onRemove }: {
  item: BookListItem;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState<number | null>(null);
  const offset = dx ?? (open ? -ACTION_WIDTH : 0);

  return (
    <div className="relative overflow-hidden">
      <button
        type="button"
        onClick={onRemove}
        tabIndex={open ? 0 : -1}
        className="absolute inset-y-0 right-0 bg-clay text-white font-semibold text-sm flex items-center justify-center"
        style={{ width: ACTION_WIDTH }}
      >
        Remove
      </button>
      <div
        className={`relative bg-paper flex items-center gap-3 px-4 py-3.5 select-none touch-pan-y ${dx === null ? 'transition-transform duration-200' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={e => {
          start.current = { x: e.clientX, y: e.clientY, base: open ? -ACTION_WIDTH : 0 };
          moved.current = false;
        }}
        onPointerMove={e => {
          if (!start.current) return;
          const ddx = e.clientX - start.current.x;
          if (!moved.current && Math.abs(ddx) < 8) return;
          if (!moved.current && Math.abs(e.clientY - start.current.y) > Math.abs(ddx)) { start.current = null; return; }
          moved.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDx(Math.max(-ACTION_WIDTH - 24, Math.min(0, start.current.base + ddx)));
        }}
        onPointerUp={() => {
          if (start.current && moved.current && dx !== null) {
            if (dx < -ACTION_WIDTH / 2) onOpen(); else onClose();
          }
          start.current = null;
          setDx(null);
        }}
        onPointerCancel={() => { start.current = null; setDx(null); }}
        onClick={() => {
          if (moved.current) return; // a swipe, not a tap
          if (open) onClose(); else onSelect();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') onSelect(); if (e.key === 'Delete' || e.key === 'Backspace') onRemove(); }}
        aria-label={`${item.title}${item.active ? ' (studying now)' : ''}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink truncate">{item.title}</span>
          <span className="block text-ink-soft text-sm truncate">{item.subtitle}</span>
        </span>
        {item.active ? (
          <span className="shrink-0 text-xs font-bold text-white bg-accent rounded-full px-2.5 py-1">Studying</span>
        ) : (
          <span className="shrink-0 text-ink-soft text-xl leading-none" aria-hidden>›</span>
        )}
      </div>
    </div>
  );
}

export default function BookList({ items, onSelect, onRemove }: {
  items: BookListItem[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="rounded-2xl border border-paper-line/60 overflow-hidden divide-y divide-paper-line/60">
      {items.map(item => (
        <SwipeRow
          key={item.id}
          item={item}
          open={openId === item.id}
          onOpen={() => setOpenId(item.id)}
          onClose={() => setOpenId(null)}
          onSelect={() => { setOpenId(null); onSelect(item.id); }}
          onRemove={() => { setOpenId(null); onRemove(item.id); }}
        />
      ))}
    </div>
  );
}
