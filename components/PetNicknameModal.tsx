'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AVATAR_CATALOG, heroImageFor, getDisplayProfile, setAvatarId as saveRemoteAvatarId, setNickname as saveRemoteNickname } from '../lib/shop';
import { saveLocalAvatarId, saveLocalNickname } from '../lib/storage';

interface Props {
  onClose: () => void;
  // Same reasoning as MascotShopModal's own onProfileChange — this mutates
  // whatever the caller (Home, Welcome) is already displaying, so it needs
  // a way to know to re-read it once this closes.
  onProfileChange?: () => void;
}

// A lighter sibling of MascotShopModal — just the pet + nickname, no
// accessories/points balance, and (unlike that modal) it works whether or
// not the visitor is signed in. Reached from Home's gear icon, or used
// inline (not as a modal) during Welcome's own pet step.
export default function PetNicknameModal({ onClose, onProfileChange }: Props) {
  const [avatarId, setAvatarIdState] = useState('dachshund');
  const [nickname, setNicknameState] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDisplayProfile().then(profile => {
      setAvatarIdState(profile.avatarId);
      setNicknameState(profile.nickname ?? '');
      setSignedIn(profile.signedIn);
      setLoading(false);
    });
  }, []);

  const pickAvatar = (id: string) => {
    setAvatarIdState(id);
    if (signedIn) saveRemoteAvatarId(id);
    else saveLocalAvatarId(id);
  };

  const save = () => {
    if (signedIn) saveRemoteNickname(nickname);
    else saveLocalNickname(nickname);
    onProfileChange?.();
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={save}
    >
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Make it yours</h2>
          <button
            type="button"
            onClick={save}
            aria-label="Close"
            className="text-ink-soft hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="text-ink-soft text-sm">Loading…</p>
        ) : (
          <>
            <div>
              <div className="text-ink-soft text-xs font-semibold uppercase tracking-wide mb-2">Your pet</div>
              <div className="flex gap-3 flex-wrap">
                {AVATAR_CATALOG.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={a.comingSoon}
                    onClick={() => pickAvatar(a.id)}
                    className={`relative w-14 h-14 rounded-full overflow-hidden border-2 transition-colors ${
                      avatarId === a.id ? 'border-accent' : 'border-paper-line'
                    } ${a.comingSoon ? 'opacity-50' : ''}`}
                    title={a.comingSoon ? `${a.name} — coming soon` : a.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${heroImageFor(a.id)}`}
                      alt={a.name}
                      className="w-full h-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-ink mb-1">Nickname (optional)</label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNicknameState(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                maxLength={24}
                placeholder="What should we call you?"
                className="w-full border-2 border-accent/70 rounded-lg px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent"
              />
              <span className="block text-ink-soft text-xs mt-1">Leave blank to stay anonymous.</span>
            </div>

            {!signedIn && (
              <p className="text-ink-soft text-xs bg-paper-dim rounded-lg px-3 py-2">
                Sign in from Settings to appear on the leaderboard and unlock accessories.
              </p>
            )}

            <button
              type="button"
              onClick={save}
              className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
            >
              Save
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
