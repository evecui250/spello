'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AVATAR_CATALOG, ACCESSORY_CATALOG, getMyProfile, buyAccessory,
  setAvatarId as saveAvatarId, setEquippedAccessory,
} from '../lib/shop';

interface Props {
  onClose: () => void;
  // The modal mutates server state AccountPanel's own display (avatar
  // thumbnail, points balance) needs to reflect once it's gone -- unlike
  // SignInNudge's simpler {onClose}, which never mutates anything the
  // parent shows.
  onProfileChange?: () => void;
}

export default function MascotShopModal({ onClose, onProfileChange }: Props) {
  const [avatarId, setAvatarIdState] = useState('dachshund');
  const [equippedId, setEquippedIdState] = useState<string | null>(null);
  const [ownedIds, setOwnedIds] = useState<string[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile().then(profile => {
      if (profile) {
        setAvatarIdState(profile.avatarId);
        setEquippedIdState(profile.equippedAccessoryId);
        setOwnedIds(profile.ownedAccessoryIds);
        setBalance(profile.balance);
      }
      setLoading(false);
    });
  }, []);

  const close = () => { onProfileChange?.(); onClose(); };

  const pickAvatar = async (id: string) => {
    setAvatarIdState(id);
    await saveAvatarId(id);
  };

  const equip = async (id: string | null) => {
    setEquippedIdState(id);
    await setEquippedAccessory(id);
  };

  const buy = async (id: string) => {
    setBuyError(null);
    setBuyingId(id);
    const result = await buyAccessory(id);
    setBuyingId(null);
    if (result.ok) {
      setOwnedIds(prev => [...prev, id]);
      if (result.balance !== undefined) setBalance(result.balance);
    } else {
      setBuyError(result.error ?? 'Purchase failed');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Mascot &amp; Shop</h2>
          <button
            type="button"
            onClick={close}
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
            <div className="flex items-center justify-between bg-paper-dim border border-gold rounded-xl px-4 py-3">
              <span className="text-ink-soft text-sm font-semibold">🏅 Points</span>
              <span className="font-mono text-lg font-bold text-label">{balance.toLocaleString()}</span>
            </div>

            <div>
              <div className="text-ink-soft text-xs font-semibold uppercase tracking-wide mb-2">Choose your mascot</div>
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
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${a.image}`}
                        alt={a.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-paper-dim text-ink-soft text-xs">?</div>
                    )}
                    {a.comingSoon && (
                      <span className="absolute bottom-0 right-0 text-[10px]">🔒</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-ink-soft text-xs font-semibold uppercase tracking-wide mb-2">Accessories</div>
              <div className="grid grid-cols-3 gap-2">
                {ACCESSORY_CATALOG.map(acc => {
                  const owned = ownedIds.includes(acc.id);
                  const equipped = equippedId === acc.id;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      disabled={buyingId === acc.id}
                      onClick={() => {
                        if (equipped) equip(null);
                        else if (owned) equip(acc.id);
                        else buy(acc.id);
                      }}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition-colors ${
                        equipped ? 'border-accent bg-accent/10' : owned ? 'border-good bg-good/10' : 'border-paper-line bg-paper-dim'
                      }`}
                    >
                      <span className="text-sm font-semibold text-ink">{acc.name}</span>
                      <span className={`text-xs font-mono ${equipped ? 'text-accent-deep' : owned ? 'text-good-deep' : 'text-label'}`}>
                        {equipped ? 'Equipped' : owned ? 'Owned' : buyingId === acc.id ? '…' : `🏅 ${acc.cost}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {buyError && <p className="text-clay text-xs mt-2">{buyError}</p>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
