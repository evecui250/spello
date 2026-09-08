'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  startPetChat, sendPetChatMessage, getPetChatSummary, decidePetMemory, explainCorrection,
  PetChatEvent, PetChatSummary, ExplanationResult, AIUnreachableError, DailyLimitReachedError,
} from '../lib/ai';
import { getSettings, getPetChatRecentTopics, savePetChatRecentTopics } from '../lib/storage';
import { buildReviewWords } from '../lib/practice';
import { diffAgainstAttempt } from '../lib/words';
import { getOrCreateDeviceId } from '../lib/telemetry';
import SpecialCharButtons from './SpecialCharButtons';
import TextSpeakerButton from './TextSpeakerButton';
import WhyExplanationSheet from './WhyExplanationSheet';

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

  const [explanations, setExplanations] = useState<Record<number, ExplanationResult>>({});
  const [explanationLoadingIndex, setExplanationLoadingIndex] = useState<number | null>(null);
  const [whySheetIndex, setWhySheetIndex] = useState<number | null>(null);
  const [explanationError, setExplanationError] = useState<'error' | 'unreachable' | 'limit-reached' | null>(null);

  const [summary, setSummary] = useState<PetChatSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [memoryDecisions, setMemoryDecisions] = useState<Record<number, 'confirmed' | 'dismissed'>>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const deviceIdRef = useRef<string>('');

  useEffect(() => {
    deviceIdRef.current = getOrCreateDeviceId();
    const initial = pickTopics(getPetChatRecentTopics());
    savePetChatRecentTopics(initial);
    setTopicChoices([DAILY_LIFE, ...initial]);
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
          </>
        )}
        <button
          type="button"
          onClick={() => router.push('/')}
          className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all mt-2"
        >
          Done
        </button>
      </div>
    );
  }

  // phase === 'chat'
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.push('/')} className="text-ink-soft hover:text-ink text-sm font-semibold">
          ← Home
        </button>
        <span className="text-xs uppercase tracking-wide text-ink-soft font-semibold">{topic}</span>
      </div>

      <div className="flex flex-col gap-3">
        {messages.map((m, i) => (
          <ChatBubble
            key={i}
            msg={m}
            revealed={revealedTranslations.has(i)}
            onReveal={() => setRevealedTranslations(prev => new Set(prev).add(i))}
            onExplain={() => handleExplain(i, m)}
            explanationLoading={explanationLoadingIndex === i}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {whySheetIndex !== null && explanations[whySheetIndex] && (
        <WhyExplanationSheet explanation={explanations[whySheetIndex]} onClose={() => setWhySheetIndex(null)} />
      )}
      {explanationError === 'error' && <p className="text-clay text-xs -mt-1">Couldn't load an explanation — try again.</p>}
      {explanationError === 'unreachable' && <p className="text-clay text-xs -mt-1">Can't reach our AI service right now.</p>}
      {explanationError === 'limit-reached' && <p className="text-label text-xs -mt-1">Used up today's practice limit — come back tomorrow.</p>}

      {shouldConclude && !concludeBannerDismissed && (
        <div className="bg-accent/10 border border-accent/40 rounded-xl p-4 flex flex-col gap-2.5 text-center">
          <p className="text-sm text-ink">That's a nice place to stop — want to see your recap?</p>
          <div className="flex gap-2">
            <button onClick={handleSeeSummary} className="flex-1 bg-accent text-white py-2 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all">
              See summary
            </button>
            <button onClick={() => setConcludeBannerDismissed(true)} className="flex-1 text-ink-soft hover:text-ink py-2 rounded-xl font-semibold transition-colors">
              Keep chatting
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sticky bottom-0 bg-transparent pt-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          disabled={sending}
          rows={2}
          placeholder="Type your reply in German…"
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

// A user bubble's correction box is only ever shown when correctedSentence
// is non-empty AND the diff against what they actually typed isn't a
// no-op — same defensive "instruction + code" backstop this codebase uses
// everywhere else, and unlike SentenceExercise, a perfect message shows NO
// box at all here (see this feature's own plan for why: the pet is a
// conversation partner, not a grader, so a clean message should read as
// nothing more than a normal reply).
function ChatBubble({
  msg, revealed, onReveal, onExplain, explanationLoading,
}: {
  msg: DisplayMessage;
  revealed: boolean;
  onReveal: () => void;
  onExplain: () => void;
  explanationLoading: boolean;
}) {
  const isPet = msg.role === 'pet';
  const diff = !isPet && msg.correctedSentence ? diffAgainstAttempt(msg.text, msg.correctedSentence) : null;
  const showCorrection = !!diff && !diff.perfect;
  const vocabGaps = (msg.events ?? []).filter(e => e.type === 'unknownVocabulary');

  return (
    <div className={`flex flex-col gap-1.5 ${isPet ? 'items-start' : 'items-end'}`}>
      <button
        type="button"
        onClick={isPet ? onReveal : undefined}
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm text-left ${
          isPet ? 'bg-paper/90 text-ink rounded-tl-sm' : 'bg-accent text-white rounded-tr-sm'
        }`}
      >
        {msg.text}
        {isPet && revealed && msg.translation && (
          <div className="mt-1.5 pt-1.5 border-t border-paper-line/60 text-ink-soft text-xs">{msg.translation}</div>
        )}
      </button>

      {vocabGaps.length > 0 && (
        <div className="max-w-[85%] flex flex-wrap gap-1.5">
          {vocabGaps.map((e, i) => (
            <span key={i} className="text-xs font-semibold bg-label/15 text-label rounded-full px-2.5 py-1">
              "{e.wrong}" → {e.correct}
            </span>
          ))}
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
