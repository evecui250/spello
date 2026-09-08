'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AVATAR_CATALOG, ACCESSORY_CATALOG, AccessorySlot, EquippedAccessories, NO_ACCESSORIES,
  avatarImageFor, getMyProfile, buyAccessory, setAvatarId as saveAvatarId, setEquippedAccessory,
} from '../lib/shop';
import { PointsIcon } from './icons';

interface Props {
  onClose: () => void;
  // The modal mutates server state AccountPanel's own display (avatar
  // thumbnail, points balance) needs to reflect once it's gone -- unlike
  // SignInNudge's simpler {onClose}, which never mutates anything the
  // parent shows.
  onProfileChange?: () => void;
}

const SLOT_LABEL: Record<AccessorySlot, string> = {
  collar: 'Collar',
  headwear: 'Head-wear',
  sidewear: 'Side-wear',
};
const SLOT_ORDER: AccessorySlot[] = ['collar', 'headwear', 'sidewear'];

export default function MascotShopModal({ onClose, onProfileChange }: Props) {
  const [avatarId, setAvatarIdState] = useState('dachshund');
  const [equipped, setEquippedState] = useState<EquippedAccessories>(NO_ACCESSORIES);
  const [ownedIds, setOwnedIds] = useState<string[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  // Set when an unowned item is tapped, before the actual purchase — see
  // the accessory grid below. Spending points is irreversible (no
  // sell-back mechanic), so buying happens in two taps: select, then
  // confirm, rather than firing on the first tap.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile().then(profile => {
      if (profile) {
        setAvatarIdState(profile.avatarId);
        setEquippedState(profile.equipped);
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

  // Equips (or, with id=null, unequips) one slot at a time -- setting the
  // headwear slot never touches whatever's equipped in collar/sidewear,
  // so a learner can mix items across slots freely.
  const equip = async (slot: AccessorySlot, id: string | null) => {
    setEquippedState(prev => ({ ...prev, [slot]: id }));
    await setEquippedAccessory(slot, id);
  };

  const buy = async (id: string) => {
    setConfirmingId(null);
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
          <h2 className="font-bold text-ink">Pet &amp; Shop</h2>
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
            <div className="flex justify-center">
              <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-paper-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${avatarImageFor(avatarId, equipped)}`}
                  alt="Your mascot"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-paper-dim border border-gold rounded-xl px-4 py-3">
              <span className="flex items-center gap-1.5 text-ink-soft text-sm font-semibold"><PointsIcon className="w-4 h-4" /> Points</span>
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

            {/* One section per slot that actually has items -- each slot's
                items only ever compete with EACH OTHER (equipping a second
                hat replaces the first), never with items in a different
                slot, so grouping by slot is what makes that mixable-across-
                slots model legible rather than one flat grid where it'd be
                unclear which items are mutually exclusive. */}
            {SLOT_ORDER.filter(slot => ACCESSORY_CATALOG.some(acc => acc.slot === slot)).map(slot => (
              <div key={slot}>
                <div className="text-ink-soft text-xs font-semibold uppercase tracking-wide mb-2">{SLOT_LABEL[slot]}</div>
                <div className="grid grid-cols-3 gap-2">
                  {ACCESSORY_CATALOG.filter(acc => acc.slot === slot).map(acc => {
                    const owned = ownedIds.includes(acc.id);
                    const isEquipped = equipped[acc.slot] === acc.id;
                    if (!owned && confirmingId === acc.id) {
                      return (
                        <div key={acc.id} className="col-span-3 flex flex-col items-center gap-2 rounded-xl border border-accent bg-accent/10 px-3 py-3 text-center">
                          <span className="flex items-center gap-1 text-sm font-semibold text-ink">
                            Spend <PointsIcon className="w-4 h-4" /> {acc.cost} on {acc.name}? This can&apos;t be undone.
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={buyingId === acc.id}
                              onClick={() => buy(acc.id)}
                              className="bg-accent text-white px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-accent-deep transition-colors disabled:opacity-50"
                            >
                              {buyingId === acc.id ? 'Buying…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              className="text-ink-soft hover:text-ink px-4 py-1.5 rounded-full text-sm font-semibold transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          if (isEquipped) equip(acc.slot, null);
                          else if (owned) equip(acc.slot, acc.id);
                          else if (balance < acc.cost) { setBuyError(`Not enough points — need ${acc.cost - balance} more.`); setConfirmingId(null); }
                          else { setBuyError(null); setConfirmingId(acc.id); }
                        }}
                        className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition-colors ${
                          isEquipped ? 'border-accent bg-accent/10' : owned ? 'border-good bg-good/10' : 'border-paper-line bg-paper-dim'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-paper-line bg-paper flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${acc.icon}`}
                            alt=""
                            className="w-[85%] h-[85%] object-contain"
                          />
                        </div>
                        <span className="text-sm font-semibold text-ink">{acc.name}</span>
                        <span className={`flex items-center gap-1 text-xs font-mono ${isEquipped ? 'text-accent-deep' : owned ? 'text-good-deep' : 'text-label'}`}>
                          {isEquipped ? 'Equipped' : owned ? 'Tap to equip' : <><PointsIcon className="w-3.5 h-3.5" /> {acc.cost}</>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {buyError && <p className="text-clay text-xs -mt-2">{buyError}</p>}

            {/* Every pick/equip/purchase above already saves the instant
                you tap it (see equip/pickAvatar/buy) — there was nothing
                left to lose by closing via × or tapping outside. This
                button doesn't save anything new; it exists because a
                modal with no bottom action reads as unfinished, leaving a
                learner unsure whether their choice actually stuck. */}
            <button
              type="button"
              onClick={close}
              className="bg-accent text-white text-sm px-4 py-2.5 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
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
