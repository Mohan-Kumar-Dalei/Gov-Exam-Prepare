import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Trophy,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  Sparkles,
  ArrowRight,
  BookOpen,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { testApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import Markdown from '../components/ui/Markdown.jsx';
import {
  Card,
  CardHeader,
  Badge,
  Button,
  StatCard,
  ErrorState,
  Skeleton,
  ProgressBar,
  masteryTone,
} from '../components/ui/index.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'wrong', label: 'Wrong' },
  { key: 'correct', label: 'Correct' },
  { key: 'skipped', label: 'Skipped' },
];

export default function Result() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');

  const { data, loading, error, run } = useAsync(() => testApi.get(sessionId), [sessionId]);

  const session = data?.data?.session;
  const questions = useMemo(() => data?.data?.questions || [], [data]);

  const review = useMemo(() => {
    if (!session?.responses) return [];
    const byId = new Map(questions.map((q) => [String(q.id), q]));
    return session.responses.map((r) => ({ ...r, q: byId.get(String(r.question)) }));
  }, [session, questions]);

  const filtered = review.filter((r) => {
    if (filter === 'wrong') return !r.isCorrect && !r.isSkipped;
    if (filter === 'correct') return r.isCorrect;
    if (filter === 'skipped') return r.isSkipped;
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={run} />;
  if (session?.status !== 'submitted') {
    return (
      <ErrorState
        error={{ message: 'This test has not been submitted yet.' }}
        onRetry={() => navigate(`/test/${sessionId}`)}
      />
    );
  }

  const accuracy = session.accuracy || 0;
  const feedback = session.aiFeedback;

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Badge tone="brand">{session.mode}</Badge>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            {session.title}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Submitted {new Date(session.submittedAt).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/practice')}>
            Practise again
          </Button>
          <Button onClick={() => navigate('/analytics')}>
            View analytics <ArrowRight size={16} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Score"
          value={`${session.score}/${session.maxScore}`}
          hint={`${accuracy}% accuracy`}
          icon={Trophy}
          tone={accuracy >= 70 ? 'green' : accuracy >= 45 ? 'amber' : 'red'}
        />
        <StatCard label="Correct" value={session.correct} icon={CheckCircle2} tone="green" />
        <StatCard label="Wrong" value={session.wrong} icon={XCircle} tone="red" />
        <StatCard
          label="Time taken"
          value={`${Math.round((session.timeTakenSec || 0) / 60)} min`}
          hint={`${session.skipped} skipped`}
          icon={Clock}
          tone="violet"
        />
      </div>

      {feedback?.summary ? (
        <Card className="mt-6 border-brand-200 bg-gradient-to-br from-brand-50 to-white">
          <CardHeader title="Coach's read on this attempt" icon={Sparkles} />
          <div className="card-pad">
            <div className="text-ink-800">
              <Markdown tone="chat">{feedback.summary}</Markdown>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
              {feedback.strongTopics?.length ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Strong
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {feedback.strongTopics.map((t) => (
                      <Badge key={t} tone="green">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {feedback.weakTopics?.length ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                    Needs work
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {feedback.weakTopics.map((t) => (
                      <Badge key={t} tone="red">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {feedback.nextSteps?.length ? (
              <ol className="mt-5 space-y-2">
                {feedback.nextSteps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-ink-700">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-600 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </Card>
      ) : null}

      {session.topicPerformance?.length ? (
        <Card className="mt-6">
          <CardHeader title="Topic-wise performance" />
          <div className="card-pad">
            <ResponsiveContainer width="100%" height={Math.max(220, session.topicPerformance.length * 38)}>
              <BarChart
                data={session.topicPerformance}
                layout="vertical"
                margin={{ left: 12, right: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="topic"
                  width={150}
                  tick={{ fontSize: 11, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v, _k, p) => [`${v}% (${p.payload.correct}/${p.payload.total})`, 'Accuracy']}
                />
                <Bar dataKey="accuracy" radius={[0, 6, 6, 0]} barSize={16}>
                  {session.topicPerformance.map((t, i) => (
                    <Cell
                      key={i}
                      fill={t.accuracy >= 70 ? '#10b981' : t.accuracy >= 45 ? '#f59e0b' : '#f43f5e'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader
          title="Answer review"
          subtitle="Read the explanation for everything you got wrong"
          action={
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filter === f.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        />
        <div className="divide-y divide-ink-100">
          {filtered.map((r, idx) => (
            <div key={idx} className="px-5 py-5 sm:px-6">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                    r.isSkipped
                      ? 'bg-ink-200 text-ink-600'
                      : r.isCorrect
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {r.isSkipped ? <MinusCircle size={14} /> : r.isCorrect ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{r.q?.question}</p>

                  <div className="mt-3 space-y-1.5">
                    {r.q?.options?.map((opt, i) => {
                      const isAnswer = i === r.correctIndex;
                      const isPicked = i === r.selectedIndex;
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm ${
                            isAnswer
                              ? 'bg-emerald-50 text-emerald-900'
                              : isPicked
                                ? 'bg-rose-50 text-rose-900'
                                : 'text-ink-600'
                          }`}
                        >
                          <span className="font-bold">{LETTERS[i]}</span>
                          <span className="flex-1">{opt}</span>
                          {isAnswer ? <span className="text-xs font-semibold">correct</span> : null}
                          {isPicked && !isAnswer ? (
                            <span className="text-xs font-semibold">your answer</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {r.q?.explanation ? (
                    <div className="mt-3 rounded-xl bg-ink-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        Explanation
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-700">{r.q.explanation}</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone="slate">{r.topic}</Badge>
                    <Badge tone={r.difficulty === 'hard' ? 'red' : r.difficulty === 'easy' ? 'green' : 'amber'}>
                      {r.difficulty}
                    </Badge>
                    <span className="text-xs text-ink-400">{r.timeSpentSec}s</span>
                    {r.q?.sourceBasis ? (
                      <span
                        className="text-xs text-ink-400"
                        title="The real exam pattern this question was modelled on"
                      >
                        · {r.q.sourceBasis}
                      </span>
                    ) : null}
                    <Link
                      to={`/learn/${session.exam || ''}/lesson?subject=${encodeURIComponent(
                        r.subject,
                      )}&topic=${encodeURIComponent(r.topic)}`}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                    >
                      <BookOpen size={13} /> Revise this topic
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!filtered.length ? (
            <p className="px-5 py-10 text-center text-sm text-ink-500">Nothing in this filter.</p>
          ) : null}
        </div>
      </Card>

      <Card className="mt-6">
        <div className="card-pad">
          <p className="text-sm font-semibold text-ink-900">Overall accuracy</p>
          <ProgressBar value={accuracy} tone={masteryTone(accuracy)} className="mt-3" />
          <p className="mt-1.5 text-xs text-ink-500">
            {session.correct} correct out of {session.attempted} attempted ({session.skipped} skipped)
          </p>
        </div>
      </Card>
    </>
  );
}
