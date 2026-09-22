import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Lightbulb,
  NotebookPen,
  Sigma,
  AlertTriangle,
  ListChecks,
  Clock,
} from 'lucide-react';
import { learningApi, testApi } from '../api/endpoints.js';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  ErrorState,
  Skeleton,
  Spinner,
} from '../components/ui/index.jsx';
import Markdown from '../components/ui/Markdown.jsx';

const TABS = [
  { key: 'explanation', label: 'Concept' },
  { key: 'notes', label: 'Short notes' },
  { key: 'examples', label: 'Examples' },
  { key: 'tricks', label: 'Tricks' },
];

export default function Lesson() {
  const { examId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const subject = params.get('subject') || '';
  const topic = params.get('topic') || '';

  const [tab, setTab] = useState('explanation');
  const [completing, setCompleting] = useState(false);
  const [startingQuiz, setStartingQuiz] = useState(false);

  const [lesson, setLesson] = useState(null);
  const [prose, setProse] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  // Set when the prose arrived but the revision half did not.
  const [partialError, setPartialError] = useState(null);

  /**
   * The explanation streams in while the notes, tricks and examples are built
   * in parallel, so there is something to read within a second or two instead
   * of a spinner until the whole lesson exists.
   */
  const load = useCallback(
    async ({ refresh = false } = {}) => {
      setLoading(true);
      setError(null);
      setProse('');
      setPartialError(null);
      if (refresh) setLesson(null);

      try {
        await learningApi.lessonStream(
          examId,
          { subject, topic, ...(refresh ? { refresh: 'true' } : {}) },
          (event, data) => {
            if (event === 'cached') {
              setLesson(data.lesson);
              setProse(data.lesson.explanation || '');
            } else if (event === 'start') {
              setStreaming(true);
              setLoading(false);
            } else if (event === 'prose') {
              setProse((p) => p + data.text);
            } else if (event === 'structure') {
              setLesson(data.lesson);
              if (data.partial) setPartialError(data.error || 'The AI could not produce them.');
            } else if (event === 'error') {
              throw new Error(data.message);
            }
          },
        );
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        setStreaming(false);
      }
    },
    [examId, subject, topic],
  );

  // A ref guard keeps StrictMode's double effect from generating twice.
  const started = useRef('');
  useEffect(() => {
    const key = `${examId}|${subject}|${topic}`;
    if (started.current === key) return;
    started.current = key;
    load();
  }, [examId, subject, topic, load]);

  const regenerate = async () => {
    await load({ refresh: true });
    toast.success('Lesson regenerated.');
  };

  const markComplete = async () => {
    setCompleting(true);
    try {
      await learningApi.complete(examId, { subject, topic });
      toast.success('Lesson marked complete.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCompleting(false);
    }
  };

  // Step 4 of the learning flow: teach, then immediately quiz on the same topic.
  const quizMe = async () => {
    setStartingQuiz(true);
    try {
      const res = await testApi.startQuiz({
        examId,
        count: 10,
        topics: [topic],
        subjects: [subject],
        mode: 'practice',
        difficulty: 'adaptive',
      });
      navigate(`/test/${res.data.session.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStartingQuiz(false);
    }
  };

  if (loading && !prose) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-12 w-96" />
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Spinner /> Writing this lesson — text appears as it is written.
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error && !prose) return <ErrorState error={error} onRetry={() => load()} />;

  return (
    <>
      <Link to="/learn" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Back to topics
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge tone="brand">{subject}</Badge>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{topic}</h1>
          <p className="mt-1.5 flex items-center gap-3 text-sm text-ink-500">
            <span className="flex items-center gap-1">
              <Clock size={14} /> ~{lesson?.estimatedMinutes || 20} min read
            </span>
            {lesson?.completed ? (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 size={14} /> Completed
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={regenerate}>
            Regenerate
          </Button>
          {!lesson?.completed ? (
            <Button variant="secondary" icon={CheckCircle2} loading={completing} onClick={markComplete}>
              Mark complete
            </Button>
          ) : null}
          <Button icon={ListChecks} loading={startingQuiz} onClick={quizMe}>
            Quiz me
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="flex gap-1 overflow-x-auto border-b border-ink-100 px-3 pt-3">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    tab === t.key
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="card-pad">
              {tab === 'explanation' ? (
                <div>
                  <Markdown tone="lesson">{prose || lesson?.explanation || ''}</Markdown>
                  {streaming ? (
                    <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-ink-500 align-text-bottom" />
                  ) : null}
                </div>
              ) : null}

              {tab !== 'explanation' && !lesson && !partialError ? (
                <div className="flex items-center gap-2 py-8 text-sm text-ink-500">
                  <Spinner /> Notes, tricks and examples are still being prepared…
                </div>
              ) : null}

              {/* The revision half can fail on its own; say so instead of spinning forever. */}
              {tab !== 'explanation' && partialError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    The notes, examples and tricks could not be generated.
                  </p>
                  <p className="mt-1 text-sm text-amber-800">{partialError}</p>
                  <Button variant="secondary" className="mt-3" icon={RefreshCw} onClick={regenerate}>
                    Try again
                  </Button>
                </div>
              ) : null}

              {tab === 'notes' && lesson && !partialError ? (
                <ul className="space-y-2.5">
                  {lesson?.shortNotes?.map((n, i) => (
                    <li key={i} className="flex gap-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-800">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-600 text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      {n}
                    </li>
                  ))}
                </ul>
              ) : null}

              {tab === 'examples' && lesson && !partialError ? (
                <div className="space-y-5">
                  {lesson?.examples?.map((ex, i) => (
                    <div key={i} className="rounded-xl border border-ink-200 p-4">
                      <p className="text-sm font-semibold text-ink-900">
                        Example {i + 1}: {ex.problem}
                      </p>
                      <div className="mt-3 whitespace-pre-line rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                        {ex.solution}
                      </div>
                      {ex.takeaway ? (
                        <p className="mt-2.5 text-xs font-medium text-brand-700">↳ {ex.takeaway}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === 'tricks' && lesson && !partialError ? (
                <ul className="space-y-2.5">
                  {lesson?.tricks?.map((t, i) => (
                    <li
                      key={i}
                      className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                    >
                      <Lightbulb size={16} className="mt-0.5 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {lesson?.importantConcepts?.length ? (
            <Card>
              <CardHeader title="Key concepts" icon={NotebookPen} />
              <div className="card-pad space-y-3">
                {lesson.importantConcepts.map((c, i) => (
                  <div key={i}>
                    <p className="text-sm font-semibold text-ink-900">{c.concept}</p>
                    <p className="mt-0.5 text-sm text-ink-600">{c.detail}</p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {lesson?.formulas?.length ? (
            <Card>
              <CardHeader title="Formulas" icon={Sigma} />
              <div className="card-pad space-y-3">
                {lesson.formulas.map((f, i) => (
                  <div key={i} className="rounded-xl bg-ink-900 p-3">
                    <p className="text-xs font-medium text-ink-400">{f.name}</p>
                    <p className="mt-1 font-mono text-sm text-emerald-300">{f.expression}</p>
                    {f.usage ? <p className="mt-1.5 text-xs text-ink-400">{f.usage}</p> : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {lesson?.commonMistakes?.length ? (
            <Card>
              <CardHeader title="Common mistakes" icon={AlertTriangle} />
              <ul className="card-pad space-y-2">
                {lesson.commonMistakes.map((m, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                    {m}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
