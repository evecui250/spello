'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startPetChat, sendPetChatMessage, getPetChatSummary, decidePetMemory, explainCorrection,
  saveChatReport, PetChatEvent, PetChatSummary, ExplanationResult, AIUnreachableError, DailyLimitReachedError,
} from '../lib/ai';
import { getSettings, getPetChatRecentTopics, savePetChatRecentTopics } from '../lib/storage';
import { buildReviewWords } from '../lib/practice';
import { diffAgainstAttempt } from '../lib/words';
import { getOrCreateDeviceId } from '../lib/telemetry';
import { getDisplayProfile, avatarImageFor, EquippedAccessories } from '../lib/shop';
import SpecialCharButtons from './SpecialCharButtons';
import TextSpeakerButton from './TextSpeakerButton';
import WhyExplanationSheet from './WhyExplanationSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// The 15-topic master pool from the product spec — "Daily life" is always
// offered alongside 3 random picks from the other 14 (see pickTopics).
const ALL_TOPICS = [
  'Daily life', 'Small talk', 'Family', 'Friends & relationships', 'Food & restaurants',
  'Shopping', 'Home & housing', 'Work & study', 'Hobbies & free time', 'Travel & transport',
  'Health', 'Appointments & plans', 'Technology & media', 'Money', 'Goals & decisions',
];
const DAILY_LIFE = 'Daily life';
const ROTATING_TOPICS = ALL_TOPICS.filter(t => t !== DAILY_LIFE);
const NORMAL_SESSION_LENGTH = 7;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Picks 3 random topics, preferring ones NOT in `exclude` (the last couple
// draws' worth) so the same handful doesn't keep resurfacing — but falls
// back to the full pool if exclusion would leave fewer than 3 candidates,
// rather than erroring or repeating just 1-2 forever.
function pickTopics(exclude: string[]): string[] {
  const fresh = ROTATING_TOPICS.filter(t => !exclude.includes(t));
  const pool = fresh.length >= 3 ? fresh : ROTATING_TOPICS;
  return shuffled(pool).slice(0, 3);
}

interface DisplayMessage {
  role: 'user' | 'pet';
  text: string;
  translation?: string;        // pet only
  correctedSentence?: string;  // user only — '' or absent = no correction needed
  events?: PetChatEvent[];     // user only
}

type Phase = 'topics' | 'chat' | 'summary';

export default function PetChatFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('topics');
  const [topicChoices, setTopicChoices] = useState<string[]>([DAILY_LIFE]);
  const [topic, setTopic] = useState<string | null>(null);
  const [startingTopic, setStartingTopic] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [shouldConclude, setShouldConclude] = useState(false);
  const [concludeBannerDismissed, setConcludeBannerDismissed] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<'unreachable' | 'limit-reached' | 'error' | null>(null);
  const [revealedTranslations, setRevealedTranslations] = useState<Set<number>>(new Set());
  const [petAvatar, setPetAvatar] = useState<{ avatarId: string; equipped: EquippedAccessories } | null>(null);

  const [explanations, setExplanations] = useState<Record<number, ExplanationResult>>({});
  const [explanationLoadingIndex, setExplanationLoadingIndex] = useState<number | null>(null);
  const [whySheetIndex, setWhySheetIndex] = useState<number | null>(null);
  const [explanationError, setExplanationError] = useState<'error' | 'unreachable' | 'limit-reached' | null>(null);

  const [summary, setSummary] = useState<PetChatSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [memoryDecisions, setMemoryDecisions] = useState<Record<number, 'confirmed' | 'dismissed'>>({});
  const [reportSaved, setReportSaved] = useState(false);
  const [savingReport, setSavingReport] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const deviceIdRef = useRef<string>('');

  useEffect(() => {
    deviceIdRef.current = getOrCreateDeviceId();
    const initial = pickTopics(getPetChatRecentTopics());
    savePetChatRecentTopics(initial);
    setTopicChoices([DAILY_LIFE, ...initial]);
    getDisplayProfile().then(p => setPetAvatar({ avatarId: p.avatarId, equipped: p.equipped }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, shouldConclude]);

  function redrawTopics() {
    const fresh = pickTopics([...getPetChatRecentTopics(), ...topicChoices]);
    savePetChatRecentTopics(fresh);
    setTopicChoices([DAILY_LIFE, ...fresh]);
  }

  async function handlePickTopic(chosen: string) {
    setStartingTopic(chosen);
    setChatError(null);
    try {
      const settings = getSettings();
      const result = await startPetChat(chosen, settings.level, deviceIdRef.current, settings.nativeLanguage);
      setTopic(chosen);
      setSessionId(result.sessionId);
      setMessages([{ role: 'pet', text: result.petReply, translation: result.petReplyTranslation }]);
      setPhase('chat');
    } catch (e) {
      setChatError(e instanceof AIUnreachableError ? 'unreachable' : e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
    } finally {
      setStartingTopic(null);
    }
  }

  function recentWordsForPrompt() {
    return buildReviewWords(8, new Set(), true).map(w => ({ de: w.de, en: w.en }));
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !sessionId) return;
    setSending(true);
    setChatError(null);
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    try {
      const result = await sendPetChatMessage(sessionId, text, deviceIdRef.current, recentWordsForPrompt());
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], correctedSentence: result.correctedSentence, events: result.events };
        next.push({ role: 'pet', text: result.petReply, translation: result.petReplyTranslation });
        return next;
      });
      setTurnCount(t => t + 1);
      if (result.shouldConclude) { setShouldConclude(true); setConcludeBannerDismissed(false); }
    } catch (e) {
      setChatError(e instanceof AIUnreachableError ? 'unreachable' : e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
      // The user's own message stays visible even though it never got a
      // reply — same "never silently discard what they typed" reasoning
      // as every other AI call in this app; they can just try again.
    } finally {
      setSending(false);
    }
  }

  async function handleExplain(index: number, msg: DisplayMessage) {
    if (explanations[index]) { setWhySheetIndex(index); return; }
    if (!msg.correctedSentence) return;
    setExplanationLoadingIndex(index);
    setExplanationError(null);
    const diff = diffAgainstAttempt(msg.text, msg.correctedSentence);
    const maxPoints = Math.max(1, diff.tokens.filter(t => t.changed).length);
    const settings = getSettings();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await explainCorrection('pet_chat', '', settings.level, msg.text, msg.correctedSentence, settings.nativeLanguage, maxPoints);
        setExplanations(prev => ({ ...prev, [index]: result }));
        setWhySheetIndex(index);
        setExplanationLoadingIndex(null);
        return;
      } catch (e) {
        if (e instanceof DailyLimitReachedError) { setExplanationError('limit-reached'); setExplanationLoadingIndex(null); return; }
        if (attempt === 0) continue;
        setExplanationError(e instanceof AIUnreachableError ? 'unreachable' : 'error');
      }
    }
    setExplanationLoadingIndex(null);
  }

  async function handleSeeSummary() {
    if (!sessionId) return;
    setPhase('summary');
    setSummaryError(false);
    try {
      const result = await getPetChatSummary(sessionId, deviceIdRef.current);
      setSummary(result);
    } catch {
      setSummaryError(true);
    }
  }

  async function handleMemoryDecision(id: number, decision: 'confirmed' | 'dismissed') {
    setMemoryDecisions(prev => ({ ...prev, [id]: decision }));
    try {
      await decidePetMemory(id, deviceIdRef.current, decision);
    } catch {
      // Best-effort, same as every other fire-and-forget preference write
      // in this app — worst case the learner sees it decided locally but
      // it wasn't persisted; not worth blocking the UI over.
    }
  }

  async function handleSaveReport() {
    if (!sessionId || savingReport || reportSaved) return;
    setSavingReport(true);
    try {
      await saveChatReport(sessionId, deviceIdRef.current);
      setReportSaved(true);
    } catch {
      // Best-effort — the button just stays tappable again on failure.
    } finally {
      setSavingReport(false);
    }
  }

  if (phase === 'topics') {
    return (
      <div className="flex flex-col justify-center min-h-[calc(100dvh-11rem)] gap-6">
        <h1 className="text-2xl font-bold text-on-bg text-center" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          What should we talk about?
        </h1>
        <div className="flex flex-col gap-3">
          {topicChoices.map(t => (
            <button
              key={t}
              type="button"
              disabled={!!startingTopic}
              onClick={() => handlePickTopic(t)}
              className="relative flex items-center gap-3 bg-paper/90 backdrop-blur-sm rounded-2xl border-2 border-paper-line shadow-sm p-4 text-left hover:-translate-y-0.5 hover:shadow-md hover:border-accent/60 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              <span className="flex-1 font-bold text-ink text-base">
                {startingTopic === t ? 'Starting…' : t}
              </span>
              <span className="shrink-0 w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-lg">›</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={redrawTopics}
          disabled={!!startingTopic}
          className="text-label text-sm font-semibold text-center hover:text-label/80 transition-colors disabled:opacity-60"
        >
          Show me more
        </button>
        {chatError && (
          <p className="text-clay text-sm text-center">
            {chatError === 'unreachable' ? "Can't reach our AI service right now." :
              chatError === 'limit-reached' ? "Used up today's practice limit — come back tomorrow." :
              "Couldn't start the conversation — try again."}
          </p>
        )}
      </div>
    );
  }

  if (phase === 'summary') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {topic} — session recap
        </h1>
        {!summary && !summaryError && <p className="text-on-bg/70 text-sm text-center py-8">Putting together your recap…</p>}
        {summaryError && (
          <div className="text-center py-8 flex flex-col items-center gap-3">
            <p className="text-on-bg/70 text-sm">Couldn't load the recap right now.</p>
            <button onClick={handleSeeSummary} className="text-label text-sm font-semibold underline">Try again</button>
          </div>
        )}
        {summary && (
          <>
            <div className="bg-paper/90 backdrop-blur-sm rounded-2xl border border-paper-line shadow-sm p-4">
              <p className="text-ink text-sm">{summary.positiveSummary}</p>
            </div>
            {summary.newWords.length > 0 && (
              <SummarySection title="New words">
                <div className="flex flex-col gap-1.5">
                  {summary.newWords.map((w, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="font-semibold text-ink">{w.de}</span>
                      <span className="text-ink-soft">{w.gloss}</span>
                    </div>
                  ))}
                </div>
              </SummarySection>
            )}
            {summary.wordsNeededHelp.length > 0 && (
              <SummarySection title="Words you needed help with">
                <PairList pairs={summary.wordsNeededHelp} />
              </SummarySection>
            )}
            {summary.grammarMistakes.length > 0 && (
              <SummarySection title="Grammar to watch">
                <PairList pairs={summary.grammarMistakes} />
              </SummarySection>
            )}
            {summary.spellingMistakes.length > 0 && (
              <SummarySection title="Spelling slips">
                <PairList pairs={summary.spellingMistakes} />
              </SummarySection>
            )}
            {summary.recentWordsUsedWell.length > 0 && (
              <SummarySection title="Recently learned words you used well">
                <p className="text-sm text-ink">{summary.recentWordsUsedWell.join(', ')}</p>
              </SummarySection>
            )}
            {summary.memoryCandidates.length > 0 && (
              <SummarySection title="Remember for next time?">
                <div className="flex flex-col gap-2">
                  {summary.memoryCandidates.map(m => {
                    const decision = memoryDecisions[m.id];
                    return (
                      <div key={m.id} className="flex items-center justify-between gap-2 bg-paper-dim rounded-lg px-3 py-2">
                        <span className={`text-sm ${decision ? 'text-ink-soft line-through' : 'text-ink'}`}>{m.fact}</span>
                        {!decision && (
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => handleMemoryDecision(m.id, 'confirmed')} className="text-xs font-semibold bg-good/25 text-good-deep rounded-full px-2.5 py-1 hover:bg-good/40 transition-colors">Remember</button>
                            <button onClick={() => handleMemoryDecision(m.id, 'dismissed')} className="text-xs font-semibold text-ink-soft hover:text-ink rounded-full px-2.5 py-1 transition-colors">No thanks</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SummarySection>
            )}
            {/* Separate from the per-fact memory cards above (kept, per its
                own confirm/dismiss purpose) — this persists the WHOLE
                recap so it can be read back later, no AI involved, from My
                Notebook's Conversations tab (see app/mistakes/page.tsx). */}
            <button
              type="button"
              onClick={handleSaveReport}
              disabled={savingReport || reportSaved}
              className="w-full bg-paper/90 backdrop-blur-sm border-2 border-accent/50 text-accent-deep py-3 rounded-xl font-semibold hover:bg-accent/10 active:scale-95 transition-all disabled:opacity-70"
            >
              {reportSaved ? '✓ Saved to My Notebook' : savingReport ? 'Saving…' : 'Save the report'}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => router.push('/')}
          className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
        >
          Done
        </button>
      </div>
    );
  }

  // phase === 'chat'. Fixed-height column (matches GamePicker's own
  // min-h-[calc(100dvh-11rem)] offset for this app's fixed header/nav
  // chrome, but as a hard height here, not a minimum) with an internally
  // scrolling message list between a static header and a static composer —
  // real report: without this, the message list just grew the whole page,
  // and on a short viewport the composer could end up scrolled out of
  // view or overlapping the last message instead of always sitting right
  // below the conversation.
  const mandatoryConclude = turnCount >= NORMAL_SESSION_LENGTH;
  return (
    <div className="flex flex-col h-[calc(100dvh-11rem)] gap-2">
      <div className="flex items-center justify-between shrink-0">
        <button type="button" onClick={() => router.push('/')} className="text-ink-soft hover:text-ink text-sm font-semibold">
          ← Home
        </button>
        <span className="text-xs uppercase tracking-wide text-ink-soft font-semibold">{topic}</span>
      </div>

      {/* The opaque paper backdrop is what gives the correction/vocabulary
          boxes inside ChatBubble their real contrast — real report: those
          boxes used the exact same colors as the (working) sentence-
          correction card elsewhere in the app, but floated directly over
          the animated sky background with no card of their own, unlike
          that card's own bg-paper/75 wrapper — the SAME green/purple tint
          reads fine on paper and poorly on a vivid, varying background. */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-3 flex flex-col gap-3">
        {messages.map((m, i) => (
          <ChatBubble
            key={i}
            msg={m}
            petAvatar={petAvatar}
            revealed={revealedTranslations.has(i)}
            onToggleReveal={() => setRevealedTranslations(prev => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i); else next.add(i);
              return next;
            })}
            onExplain={() => handleExplain(i, m)}
            explanationLoading={explanationLoadingIndex === i}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {whySheetIndex !== null && explanations[whySheetIndex] && (
        <WhyExplanationSheet explanation={explanations[whySheetIndex]} onClose={() => setWhySheetIndex(null)} />
      )}
      {explanationError === 'error' && <p className="text-clay text-xs shrink-0">Couldn't load an explanation — try again.</p>}
      {explanationError === 'unreachable' && <p className="text-clay text-xs shrink-0">Can't reach our AI service right now.</p>}
      {explanationError === 'limit-reached' && <p className="text-label text-xs shrink-0">Used up today's practice limit — come back tomorrow.</p>}

      {shouldConclude && !concludeBannerDismissed && (
        <div className="shrink-0 bg-accent/10 border border-accent/40 rounded-xl p-3 flex flex-col gap-2 text-center">
          <p className="text-sm text-ink">
            {mandatoryConclude ? "That's a wrap for today's chat!" : "That's a nice place to stop — want to see your recap?"}
          </p>
          <div className="flex gap-2">
            <button onClick={handleSeeSummary} className="flex-1 bg-accent text-white py-2 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all">
              See summary
            </button>
            {/* Only offered when the pet itself decided to wrap up early —
                once the session hits its normal 7-turn length, there's no
                "keep chatting" option at all (product requirement: the
                learner should go straight to the summary from here). */}
            {!mandatoryConclude && (
              <button onClick={() => setConcludeBannerDismissed(true)} className="flex-1 text-ink-soft hover:text-ink py-2 rounded-xl font-semibold transition-colors">
                Keep chatting
              </button>
            )}
          </div>
        </div>
      )}

      <div className="shrink-0 flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          disabled={sending}
          rows={2}
          placeholder="Type in German — mix in English/Chinese for any word you don't know"
          className="w-full bg-paper/90 backdrop-blur-sm border-2 border-paper-line rounded-xl px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent/50 resize-none disabled:opacity-60"
        />
        <SpecialCharButtons inputRef={textareaRef} onInsert={val => setInput(prev => prev + val)} />
        {chatError && (
          <p className="text-clay text-sm text-center">
            {chatError === 'unreachable' ? "Can't reach our AI service right now." :
              chatError === 'limit-reached' ? "Used up today's practice limit — come back tomorrow." :
              "Couldn't send that — try again."}
          </p>
        )}
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="w-full bg-accent text-white py-2.5 rounded-xl font-semibold disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper/90 backdrop-blur-sm rounded-2xl border border-paper-line shadow-sm p-4 flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-ink-soft font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function PairList({ pairs }: { pairs: { wrong: string; correct: string }[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((p, i) => (
        <div key={i} className="text-sm text-ink flex items-center gap-2">
          <span className="text-clay line-through">{p.wrong}</span>
          <span className="text-ink-soft">→</span>
          <span className="text-good-deep font-semibold">{p.correct}</span>
        </div>
      ))}
    </div>
  );
}

// Builds the full, natural German version of what the learner typed by
// substituting each vocabulary-gap phrase with its German replacement —
// client-side, from the SAME events the server already returned, so this
// needs no extra call. Falls back gracefully (a gap whose exact phrase
// isn't found as a substring, e.g. the model normalized capitalization,
// just doesn't get replaced) rather than throwing.
function applyVocabGaps(text: string, gaps: PetChatEvent[]): string {
  let result = text;
  for (const g of gaps) {
    if (g.wrong && result.includes(g.wrong)) result = result.replace(g.wrong, g.correct);
  }
  return result;
}

const PET_AVATAR_SIZE = 'w-7 h-7';

function PetAvatarImg({ petAvatar }: { petAvatar: { avatarId: string; equipped: EquippedAccessories } | null }) {
  return (
    <div className={`${PET_AVATAR_SIZE} shrink-0 rounded-full overflow-hidden border border-paper-line bg-paper self-end mb-0.5`}>
      {petAvatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${BASE}/${avatarImageFor(petAvatar.avatarId, petAvatar.equipped)}`}
          alt=""
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}

// A user bubble's correction box is only ever shown when correctedSentence
// is non-empty AND the diff against what they actually typed isn't a
// no-op — same defensive "instruction + code" backstop this codebase uses
// everywhere else, and unlike SentenceExercise, a perfect message shows NO
// box at all here (see this feature's own plan for why: the pet is a
// conversation partner, not a grader, so a clean message should read as
// nothing more than a normal reply). A message whose ONLY issue was a
// vocabulary gap (no real grammar mistake) still gets its own distinctly-
// colored box — real report: showing NOTHING beyond a small chip read as
// "this one didn't get checked" even though it was, just differently.
function ChatBubble({
  msg, petAvatar, revealed, onToggleReveal, onExplain, explanationLoading,
}: {
  msg: DisplayMessage;
  petAvatar: { avatarId: string; equipped: EquippedAccessories } | null;
  revealed: boolean;
  onToggleReveal: () => void;
  onExplain: () => void;
  explanationLoading: boolean;
}) {
  const isPet = msg.role === 'pet';
  const diff = !isPet && msg.correctedSentence ? diffAgainstAttempt(msg.text, msg.correctedSentence) : null;
  const showCorrection = !!diff && !diff.perfect;
  // Shown independently of the grammar correction above -- a turn can
  // have both (a vocabulary gap AND a separate real grammar mistake), and
  // correctedSentence deliberately leaves a vocab gap's foreign fragment
  // untouched (see pet-chat-turn's own comment), so this is the ONLY place
  // that gap ever becomes visible to the learner.
  const vocabGaps = (msg.events ?? []).filter(e => e.type === 'unknownVocabulary');
  const vocabSentence = vocabGaps.length > 0 ? applyVocabGaps(msg.text, vocabGaps) : null;
  const vocabDiff = vocabSentence ? diffAgainstAttempt(msg.text, vocabSentence) : null;

  return (
    <div className={`flex flex-col gap-1.5 ${isPet ? 'items-start' : 'items-end'}`}>
      <div className={`flex items-end gap-1.5 max-w-[85%] ${isPet ? '' : 'flex-row-reverse'}`}>
        {isPet && <PetAvatarImg petAvatar={petAvatar} />}
        <button
          type="button"
          onClick={isPet ? onToggleReveal : undefined}
          className={`rounded-2xl px-4 py-2.5 text-sm text-left ${
            isPet ? 'bg-paper text-ink rounded-tl-sm' : 'bg-accent text-white rounded-tr-sm'
          }`}
        >
          {msg.text}
          {isPet && revealed && msg.translation && (
            <div className="mt-1.5 pt-1.5 border-t border-paper-line/60 text-ink-soft text-xs">{msg.translation}</div>
          )}
        </button>
      </div>

      {vocabSentence && vocabDiff && (
        <div className="max-w-[85%] w-full text-left py-2 px-4 rounded-xl bg-paper-dim border border-label/40">
          <div className="text-[10px] uppercase tracking-wide text-label font-semibold mb-1">Vocabulary</div>
          <div className="text-sm text-ink">
            {vocabDiff.tokens.map(({ text, changed }, i) => (
              <span key={i} className={changed ? 'text-label font-bold' : undefined}>{text}</span>
            ))}
          </div>
        </div>
      )}

      {showCorrection && diff && (
        <div className="relative max-w-[85%] w-full text-left py-2.5 px-4 rounded-xl font-semibold bg-good/25 border border-good">
          <button
            type="button"
            onClick={onExplain}
            disabled={explanationLoading}
            aria-label="Explain the grammar"
            className="absolute top-2 right-2 text-label text-xs font-semibold bg-paper/70 hover:bg-paper hover:text-label rounded-full px-2 py-0.5 transition-colors disabled:opacity-50"
          >
            {explanationLoading ? '…' : 'Why?'}
          </button>
          <div className="text-[10px] uppercase tracking-wide text-good-deep mb-1 font-medium flex items-center gap-1.5">
            Correction
            <TextSpeakerButton text={msg.correctedSentence!} className="text-good hover:text-good-deep transition-colors normal-case" />
          </div>
          <div className="text-sm text-good-deep">
            {diff.tokens.map(({ text, changed }, i) => (
              <span key={i} className={changed ? 'underline decoration-accent decoration-2 underline-offset-2' : undefined}>{text}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
