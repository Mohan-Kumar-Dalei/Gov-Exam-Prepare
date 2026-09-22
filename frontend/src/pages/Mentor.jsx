import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageSquare,
  Send,
  Sparkles,
  BookOpen,
  ListChecks,
  Timer,
  CalendarRange,
  RotateCcw,
  Plus,
} from 'lucide-react';
import { mentorApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Button, Badge, EmptyState, Spinner, PageHeader } from '../components/ui/index.jsx';
import Markdown from '../components/ui/Markdown.jsx';

const STARTERS = [
  'What should I study today?',
  'Which topics am I weakest in right now?',
  'Am I on track to clear this exam?',
  'Give me a plan for this week.',
];

const ACTION_ICON = {
  study: BookOpen,
  quiz: ListChecks,
  mock: Timer,
  roadmap: CalendarRange,
  revise: RotateCcw,
};

export default function Mentor() {
  const navigate = useNavigate();
  const { activeExamId, user } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [suggestions, setSuggestions] = useState(STARTERS);

  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || sending) return;

    setInput('');
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setSending(true);

    // The reply streams in, so an empty assistant bubble is appended first and
    // filled as chunks arrive — the learner reads while the model is still writing.
    let replyIndex = -1;
    setMessages((m) => {
      replyIndex = m.length;
      return [...m, { role: 'assistant', content: '', streaming: true }];
    });

    try {
      await mentorApi.stream(
        {
          message: question,
          examId: activeExamId,
          conversationId: conversationId || undefined,
        },
        (event, data) => {
          if (event === 'start') {
            setConversationId(data.conversationId);
            setSuggestions(data.suggestions?.length ? data.suggestions : STARTERS);
            setMessages((m) =>
              m.map((msg, i) =>
                i === replyIndex
                  ? { ...msg, actions: data.actions, focusTopics: data.focusTopics }
                  : msg,
              ),
            );
          } else if (event === 'chunk') {
            setMessages((m) =>
              m.map((msg, i) =>
                i === replyIndex ? { ...msg, content: msg.content + data.text } : msg,
              ),
            );
          } else if (event === 'error') {
            throw new Error(data.message);
          }
        },
      );

      setMessages((m) => m.map((msg, i) => (i === replyIndex ? { ...msg, streaming: false } : msg)));
    } catch (err) {
      toast.error(err.message);
      setMessages((m) =>
        m.map((msg, i) =>
          i === replyIndex
            ? { role: 'assistant', content: `I could not answer that: ${err.message}`, error: true }
            : msg,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const runAction = (action) => {
    if (action.type === 'mock') navigate('/mock');
    else if (action.type === 'roadmap') navigate('/roadmap');
    else if (action.type === 'quiz') navigate('/practice');
    else if (action.topic && action.subject) {
      navigate(
        `/learn/${activeExamId}/lesson?subject=${encodeURIComponent(
          action.subject,
        )}&topic=${encodeURIComponent(action.topic)}`,
      );
    } else navigate('/learn');
  };

  if (!activeExamId) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No active exam"
        description="Your mentor answers using your syllabus and your scores — upload a notification first."
        action={<Button onClick={() => navigate('/upload')}>Upload a PDF</Button>}
      />
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col">
      <PageHeader
        title="AI Mentor"
        subtitle="Grounded in your syllabus, your mastery and your test history."
        actions={
          messages.length ? (
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => {
                setMessages([]);
                setConversationId(null);
                setSuggestions(STARTERS);
              }}
            >
              New chat
            </Button>
          ) : null
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {!messages.length ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white">
                <Sparkles size={24} />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ink-900">
                Hi {user?.name?.split(' ')[0]}, what do you want to work on?
              </h3>
              <p className="mt-1 max-w-sm text-sm text-ink-500">
                I know your syllabus, your weak topics and every test you have taken.
              </p>
            </div>
          ) : null}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] animate-fade-up rounded-2xl px-4 py-3.5 shadow-sm ${
                  m.role === 'user'
                    ? 'bg-brand-600 text-white'
                    : m.error
                      ? 'bg-rose-50 text-rose-900'
                      : 'bg-ink-100 text-ink-800'
                }`}
              >
                {m.role === 'user' ? (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                ) : (
                  <div className="text-ink-800">
                    <Markdown tone="chat">{m.content}</Markdown>
                    {m.streaming ? (
                      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-ink-500 align-text-bottom" />
                    ) : null}
                  </div>
                )}

                {m.focusTopics?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {m.focusTopics.map((t) => (
                      <Badge key={t} tone="brand">
                        {t}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {m.actions?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.actions.map((a, idx) => {
                      const Icon = ACTION_ICON[a.type] || BookOpen;
                      return (
                        <button
                          key={idx}
                          onClick={() => runAction(a)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 shadow-sm transition-colors hover:bg-brand-50 hover:text-brand-700"
                        >
                          <Icon size={13} /> {a.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {sending && !messages.some((m) => m.streaming && m.content) ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-ink-100 px-4 py-3 text-sm text-ink-500">
                <Spinner size={15} /> Coach is thinking…
              </div>
            </div>
          ) : null}
        </div>

        {suggestions.length ? (
          <div className="flex flex-wrap gap-2 border-t border-ink-100 px-5 py-3">
            {suggestions.slice(0, 4).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={sending}
                className="rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2 border-t border-ink-100 p-4"
        >
          <input
            className="input flex-1"
            placeholder="Ask your mentor anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
          />
          <Button type="submit" loading={sending} disabled={!input.trim()}>
            <Send size={16} />
          </Button>
        </form>
      </Card>
    </div>
  );
}
