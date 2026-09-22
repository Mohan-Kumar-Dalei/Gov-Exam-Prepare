import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Clock, ChevronLeft, ChevronRight, Flag, Send, Grid3x3, X } from 'lucide-react';
import { testApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Badge, ErrorState, Skeleton, Modal } from '../components/ui/index.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const formatClock = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r]
    .slice(h ? 0 : 1)
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
};

export default function TestRunner() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const { data, loading, error, run } = useAsync(() => testApi.get(sessionId), [sessionId]);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [flagged, setFlagged] = useState(new Set());
  const [remaining, setRemaining] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Per-question time accounting.
  const timeSpent = useRef({});
  const enteredAt = useRef(Date.now());
  const startedAt = useRef(Date.now());
  const submitted = useRef(false);

  const session = data?.data?.session;
  const questions = useMemo(() => data?.data?.questions || [], [data]);

  useEffect(() => {
    if (!session) return;
    if (session.status === 'submitted') navigate(`/result/${sessionId}`, { replace: true });
  }, [session, sessionId, navigate]);

  useEffect(() => {
    if (!session?.durationMinutes) return undefined;
    const endsAt = new Date(session.startedAt).getTime() + session.durationMinutes * 60000;
    const tick = () => setRemaining(Math.round((endsAt - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  const recordTime = useCallback(
    (index) => {
      const q = questions[index];
      if (!q) return;
      const delta = Math.round((Date.now() - enteredAt.current) / 1000);
      timeSpent.current[q.id] = (timeSpent.current[q.id] || 0) + delta;
      enteredAt.current = Date.now();
    },
    [questions],
  );

  const goTo = useCallback(
    (index) => {
      if (index < 0 || index >= questions.length) return;
      recordTime(current);
      setCurrent(index);
      setPaletteOpen(false);
    },
    [current, questions.length, recordTime],
  );

  const submit = useCallback(
    async (auto = false) => {
      if (submitted.current) return;
      submitted.current = true;
      setSubmitting(true);
      recordTime(current);

      try {
        const payload = {
          responses: questions.map((q) => ({
            questionId: q.id,
            selectedIndex: answers[q.id] ?? null,
            timeSpentSec: timeSpent.current[q.id] || 0,
          })),
          timeTakenSec: Math.round((Date.now() - startedAt.current) / 1000),
          requestAiFeedback: true,
        };
        await testApi.submit(sessionId, payload);
        toast.success(auto ? 'Time up — test submitted.' : 'Test submitted.');
        navigate(`/result/${sessionId}`, { replace: true });
      } catch (err) {
        submitted.current = false;
        toast.error(err.message);
        setSubmitting(false);
      }
    },
    [answers, current, navigate, questions, recordTime, sessionId],
  );

  // Auto-submit when the clock runs out.
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !submitted.current && questions.length) submit(true);
  }, [remaining, questions.length, submit]);

  // Keyboard shortcuts: 1-4 to answer, arrows to navigate, F to flag.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const q = questions[current];
      if (!q) return;

      if (/^[1-6]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < q.options.length) setAnswers((a) => ({ ...a, [q.id]: idx }));
      } else if (e.key === 'ArrowRight') goTo(current + 1);
      else if (e.key === 'ArrowLeft') goTo(current - 1);
      else if (e.key.toLowerCase() === 'f') {
        setFlagged((prev) => {
          const next = new Set(prev);
          next.has(q.id) ? next.delete(q.id) : next.add(q.id);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, questions, goTo]);

  // Warn before a refresh or tab close loses an in-progress attempt.
  useEffect(() => {
    const beforeUnload = (e) => {
      if (submitted.current) return undefined;
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={run} />;
  if (!questions.length) return <ErrorState error={{ message: 'This test has no questions.' }} />;

  const q = questions[current];
  const answeredCount = Object.keys(answers).length;
  const lowTime = remaining !== null && remaining < 120;

  const statusOf = (question, index) => {
    if (flagged.has(question.id)) return 'flagged';
    if (answers[question.id] !== undefined) return 'answered';
    if (index === current) return 'current';
    return 'unseen';
  };

  const paletteClass = {
    answered: 'bg-emerald-500 text-white',
    flagged: 'bg-amber-500 text-white',
    current: 'bg-brand-600 text-white ring-2 ring-brand-300',
    unseen: 'bg-ink-100 text-ink-600 hover:bg-ink-200',
  };

  const Palette = (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
      {questions.map((question, i) => (
        <button
          key={question.id}
          onClick={() => goTo(i)}
          className={`h-9 rounded-lg text-xs font-bold transition-all ${paletteClass[statusOf(question, i)]}`}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* Sticky exam bar */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">{session.title}</p>
            <p className="text-xs text-ink-500">
              {answeredCount}/{questions.length} answered · {flagged.size} flagged
            </p>
          </div>

          <div className="flex items-center gap-2">
            {remaining !== null ? (
              <div
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold tabular-nums ${
                  lowTime ? 'animate-pulse bg-rose-50 text-rose-700' : 'bg-ink-100 text-ink-800'
                }`}
              >
                <Clock size={15} /> {formatClock(remaining)}
              </div>
            ) : null}
            <Button variant="secondary" icon={Grid3x3} className="lg:hidden" onClick={() => setPaletteOpen(true)}>
              Palette
            </Button>
            <Button icon={Send} onClick={() => setConfirmOpen(true)}>
              Submit
            </Button>
          </div>
        </div>

        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${(answeredCount / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
        <Card className="animate-fade-up">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-900">Question {current + 1}</span>
              <Badge tone="slate">{q.topic}</Badge>
              <Badge
                tone={q.difficulty === 'hard' ? 'red' : q.difficulty === 'easy' ? 'green' : 'amber'}
              >
                {q.difficulty}
              </Badge>
            </div>
            <button
              onClick={() =>
                setFlagged((prev) => {
                  const next = new Set(prev);
                  next.has(q.id) ? next.delete(q.id) : next.add(q.id);
                  return next;
                })
              }
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                flagged.has(q.id) ? 'bg-amber-100 text-amber-700' : 'text-ink-500 hover:bg-ink-100'
              }`}
            >
              <Flag size={14} /> {flagged.has(q.id) ? 'Flagged' : 'Flag'}
            </button>
          </div>

          <div className="card-pad">
            <p className="text-base leading-relaxed text-ink-900">{q.question}</p>

            <div className="mt-5 space-y-2.5">
              {q.options.map((opt, i) => {
                const selected = answers[q.id] === i;
                return (
                  <button
                    key={i}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      selected
                        ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200'
                        : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
                    }`}
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                        selected ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600'
                      }`}
                    >
                      {LETTERS[i]}
                    </span>
                    <span className="text-sm text-ink-800">{opt}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-ink-100 pt-5">
              <Button variant="secondary" icon={ChevronLeft} disabled={current === 0} onClick={() => goTo(current - 1)}>
                Previous
              </Button>

              <button
                onClick={() => {
                  setAnswers((a) => {
                    const next = { ...a };
                    delete next[q.id];
                    return next;
                  });
                }}
                className="text-xs font-medium text-ink-500 hover:text-rose-600"
              >
                Clear response
              </button>

              {current === questions.length - 1 ? (
                <Button icon={Send} onClick={() => setConfirmOpen(true)}>
                  Submit test
                </Button>
              ) : (
                <Button onClick={() => goTo(current + 1)}>
                  Next <ChevronRight size={16} />
                </Button>
              )}
            </div>

            <p className="mt-4 text-center text-[11px] text-ink-400">
              Shortcuts: 1–4 to answer · ← → to move · F to flag
            </p>
          </div>
        </Card>

        <aside className="hidden lg:block">
          <Card className="sticky top-28">
            <div className="border-b border-ink-100 px-4 py-3">
              <p className="text-sm font-semibold text-ink-900">Question palette</p>
            </div>
            <div className="p-4">{Palette}</div>
            <div className="space-y-1.5 border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
              {[
                ['bg-emerald-500', `Answered (${answeredCount})`],
                ['bg-amber-500', `Flagged (${flagged.size})`],
                ['bg-ink-200', `Not answered (${questions.length - answeredCount})`],
              ].map(([color, label]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded ${color}`} /> {label}
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>

      {paletteOpen ? (
        <div className="fixed inset-0 z-40 flex items-end bg-ink-900/40 lg:hidden">
          <div className="w-full rounded-t-2xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">Question palette</p>
              <button onClick={() => setPaletteOpen(false)} className="rounded-lg p-1.5 hover:bg-ink-100">
                <X size={18} />
              </button>
            </div>
            {Palette}
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Submit this test?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep working
            </Button>
            <Button loading={submitting} onClick={() => submit(false)}>
              Submit now
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-700">
          <p>Once submitted you cannot change your answers.</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Answered', answeredCount, 'text-emerald-600'],
              ['Flagged', flagged.size, 'text-amber-600'],
              ['Unanswered', questions.length - answeredCount, 'text-rose-600'],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-xl bg-ink-50 p-3">
                <p className={`text-xl font-bold ${tone}`}>{value}</p>
                <p className="text-xs text-ink-500">{label}</p>
              </div>
            ))}
          </div>
          {session.negativeMarking ? (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              Negative marking is {session.negativeMarking} per wrong answer.
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
