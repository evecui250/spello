'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SYNCED_EVENT } from '../lib/sync';
import { getAiUsageStats, AiUsageStats } from '../lib/ai';
import { avatarImageFor, getMyProfile, setNickname as saveNickname, setLeaderboardOptOut } from '../lib/shop';
import MascotShopModal from './MascotShopModal';
import { PointsIcon, PencilIcon } from './icons';

interface Props {
  // Called after remote data has been pulled and merged in, so the caller
  // can refresh anything it's already displaying (e.g. settings sliders).
  onSync?: () => void;
}

// Purely a UI throttle so a tester can't spam the button faster than the
// email actually arrives — Supabase/Resend enforce their own real rate
// limit server-side regardless (see handleSendLink's error path below).
const RESEND_COOLDOWN_SECONDS = 60;

export default function AccountPanel({ onSync }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [inputEmail, setInputEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // The same email also carries a code (this project's Magic Link
  // template was updated to render {{ .Token }} alongside the link) —
  // typing it in is the fix for a real reported gap: the link opens
  // whatever the OS considers the DEFAULT browser, which silently signs
  // in a browser the learner may not even be the one actually using
  // Spello in. The code has no such problem — it's typed directly into
  // THIS tab, so it always signs in the right one.
  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [aiStats, setAiStats] = useState<AiUsageStats | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [avatarId, setAvatarId] = useState('dachshund');
  const [equippedAccessoryId, setEquippedAccessoryId] = useState<string | null>(null);
  const [nickname, setNicknameState] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [optOut, setOptOut] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    // The actual pull+merge runs once, globally (see SyncGate) — this just
    // refreshes whatever this page is already showing once that lands.
    const onSynced = () => onSync?.();
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener(SYNCED_EVENT, onSynced);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!email) { setAiStats(null); return; }
    getAiUsageStats().then(setAiStats);
  }, [email]);

  const loadProfile = () => {
    if (!email) return;
    getMyProfile().then(profile => {
      if (!profile) return;
      setAvatarId(profile.avatarId);
      setEquippedAccessoryId(profile.equippedAccessoryId);
      setNicknameState(profile.nickname ?? '');
      setBalance(profile.balance);
      setOptOut(profile.leaderboardOptOut);
    });
  };

  useEffect(() => {
    if (!email) return;
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const handleNicknameSave = async () => {
    await saveNickname(nickname);
    setEditingNickname(false);
  };

  const handleOptOutToggle = async () => {
    const next = !optOut;
    setOptOut(next);
    await setLeaderboardOptOut(next);
  };

  // Ticks the resend cooldown down to 0 once a second while it's active.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendLink = async () => {
    if (!inputEmail.trim() || resendCooldown > 0) return;
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: inputEmail.trim(),
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    if (error) {
      console.error('Spello sign-in link failed:', error.message);
      setErrorMessage(error.message);
      setStatus('error');
    } else {
      setStatus('sent');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim() || verifying) return;
    setVerifying(true);
    setVerifyError('');
    const { error } = await supabase.auth.verifyOtp({
      email: inputEmail.trim(),
      token: otpCode.trim(),
      type: 'email',
    });
    setVerifying(false);
    if (error) {
      setVerifyError(error.message);
    } else {
      // onAuthStateChange (see the effect above) picks up the new
      // session and flips this component into the signed-in view — no
      // manual state reset needed beyond clearing this form's own inputs.
      setOtpCode('');
      setStatus('idle');
      setInputEmail('');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setStatus('idle');
    setInputEmail('');
  };

  if (email) {
    return (
      <div className="flex flex-col gap-4">
        {/* Resume-style header: photo on the left, name on the right */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShopOpen(true)}
            className="w-24 h-24 rounded-full overflow-hidden border-4 border-paper-line hover:border-accent transition-colors shrink-0"
            title="Choose mascot & shop"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${avatarImageFor(avatarId, equippedAccessoryId)}`}
              alt="Your mascot"
              className="w-full h-full object-cover"
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              {editingNickname ? (
                <div className="flex gap-2 flex-1 min-w-0">
                  <input
                    type="text"
                    value={nickname}
                    onChange={e => setNicknameState(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleNicknameSave()}
                    maxLength={24}
                    placeholder="Shown on the leaderboard"
                    className="flex-1 min-w-0 border-2 border-accent/70 rounded-lg px-3 py-1.5 text-lg font-bold text-ink placeholder:text-ink-soft placeholder:text-sm placeholder:font-normal focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button onClick={handleNicknameSave} className="text-sm font-semibold text-label hover:text-ink transition-colors shrink-0">
                    Save
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingNickname(true)}
                  className="flex items-center gap-1.5 text-xl font-bold text-ink hover:text-label transition-colors text-left truncate min-w-0"
                >
                  <span className="truncate">
                    {nickname || <span className="text-ink-soft italic text-base font-normal">Set a nickname…</span>}
                  </span>
                  <PencilIcon className="w-3.5 h-3.5 text-ink-soft shrink-0" />
                </button>
              )}
              {balance !== null && !editingNickname && (
                <span className="flex items-center gap-1 font-mono font-bold text-label shrink-0">
                  <PointsIcon className="w-4 h-4" /> {balance.toLocaleString()}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShopOpen(true)}
              className="mt-1.5 bg-accent/15 text-label px-3 py-1 rounded-full text-xs font-semibold hover:bg-accent/25 transition-colors"
            >
              My pet
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-ink">Signed in</div>
            <p className="text-ink-soft text-sm">{email} — progress syncs automatically.</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-sm font-semibold text-clay/75 hover:text-clay transition-colors shrink-0"
          >
            Sign out
          </button>
        </div>

        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-ink-soft text-sm">Appear on the weekly/monthly leaderboard</span>
          <button
            type="button"
            role="switch"
            aria-checked={!optOut}
            onClick={handleOptOutToggle}
            className={`relative inline-block w-9 h-5 rounded-full transition-colors ${!optOut ? 'bg-accent' : 'bg-paper-dim'}`}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              style={{ transform: !optOut ? 'translateX(1rem)' : 'translateX(0)' }}
            />
          </button>
        </label>

        {aiStats && aiStats.calls > 0 && (
          <p className="text-ink-soft text-xs">
            AI sentence corrections used: {aiStats.calls} ({(aiStats.inputTokens + aiStats.outputTokens).toLocaleString()} tokens)
          </p>
        )}

        {shopOpen && (
          <MascotShopModal onClose={() => setShopOpen(false)} onProfileChange={loadProfile} />
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="block font-semibold text-ink mb-1">Sign in</label>
      <p className="text-ink-soft text-sm mb-1">
        Sign in with a magic link — this keeps your progress synced across devices and unlocks
        the AI sentence-writing exercises.
      </p>
      {/* Real reported gap: school/work emails (.edu and similar) often
          never deliver the sign-in email at all — strict institutional
          spam filtering blocks it outright, not a bug on Spello's end
          (see the OTP-code fallback below, which doesn't help if the
          email never arrives in the first place). Cheaper to warn up
          front than to have someone wait on an email that's never coming. */}
      <p className="text-ink-soft text-xs mb-3">
        Avoid school/work email addresses (e.g. .edu) if you can — their spam filters often block this kind of email entirely.
      </p>
      {status === 'sent' ? (
        <div className="bg-good/25 border border-good rounded-lg px-3 py-2 flex flex-col gap-2">
          <p className="text-good-deep text-sm">✓ Check {inputEmail} for a sign-in link.</p>
          <p className="text-ink-soft text-xs">
            Don&apos;t see it? Check your spam/junk folder — it can take a minute to arrive.
          </p>
          {/* The link opens whatever the device considers the DEFAULT
              browser, which may not be the one this tab is actually in —
              a real reported gap ("I'm using a different browser and it
              stays signed out"). The same email also has a code (this
              project's auth.email.otp_length is 8, not the 6 Supabase
              quotes as its own default); typing it in here always signs
              in THIS tab, regardless of which browser opened the link. */}
          <div className="pt-1 border-t border-good/40 flex flex-col gap-1.5">
            <p className="text-ink-soft text-xs">Using a different browser than the link opens? Enter the code from the email instead:</p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter code from email"
                value={otpCode}
                onChange={e => setOtpCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                // No maxLength -- this project's actual OTP length turned
                // out to be 8 digits, not Supabase's commonly-quoted
                // 6-digit default (confirmed live: a hardcoded 6 here
                // silently truncated every real code, always rejected as
                // "invalid or expired" no matter what was typed). Left
                // unbounded rather than hardcoding 8 either, in case this
                // project's own otp_length setting ever changes again.
                className="flex-1 min-w-0 border-2 border-accent/70 rounded-lg px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent font-mono tracking-widest"
              />
              <button
                onClick={handleVerifyOtp}
                disabled={!otpCode.trim() || verifying}
                className="bg-accent text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all shrink-0"
              >
                {verifying ? 'Verifying…' : 'Verify'}
              </button>
            </div>
            {verifyError && <p className="text-clay text-xs">{verifyError}</p>}
          </div>
          <button
            onClick={handleSendLink}
            disabled={resendCooldown > 0}
            className="self-start text-xs font-semibold text-label hover:text-ink disabled:text-ink-soft disabled:cursor-default transition-colors"
          >
            {resendCooldown > 0 ? `Resend link (${resendCooldown}s)` : 'Resend link'}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="you@example.com"
            value={inputEmail}
            onChange={e => setInputEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendLink()}
            className="flex-1 border-2 border-accent/70 rounded-lg px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSendLink}
            disabled={!inputEmail.trim() || status === 'sending'}
            className="bg-accent text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all"
          >
            {status === 'sending' ? 'Sending…' : 'Send link'}
          </button>
        </div>
      )}
      {status === 'error' && (
        <p className="text-clay text-sm mt-2">
          Couldn't send the link{errorMessage ? `: ${errorMessage}` : ''} — try again in a bit.
        </p>
      )}
    </div>
  );
}
