import { Link, useNavigate } from 'react-router-dom';
import {
  Target,
  Flame,
  CheckCircle2,
  TrendingUp,
  FileUp,
  BookOpen,
  ListChecks,
  Timer,
  CalendarCheck,
  AlertTriangle,
  Trophy,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { analyticsApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  StatCard,
  Badge,
  ProgressBar,
  EmptyState,
  ErrorState,
  Skeleton,
  Button,
  PageHeader,
  masteryTone,
} from '../components/ui/index.jsx';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => analyticsApi.dashboard(), []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={run} />;

  const d = data?.data;

  if (!d?.hasExam) {
    return (
      <>
        <PageHeader
          title={`Hello, ${user?.name?.split(' ')[0] || 'there'}`}
          subtitle="Let us set up your preparation."
        />
        <EmptyState
          icon={FileUp}
          title="Upload a recruitment notification"
          description="Drop in the official PDF. The AI reads it, extracts the syllabus and exam pattern, and builds your 60-day plan automatically."
          action={
            <Button onClick={() => navigate('/upload')} icon={FileUp}>
              Upload notification PDF
            </Button>
          }
        />
      </>
    );
  }

  const { exam, overview, readiness, weakTopics, strongTopics, scoreTrend, today, recentSessions } = d;

  return (
    <>
      <PageHeader
        title={`Hello, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle={`${exam.examName}${exam.organization ? ` · ${exam.organization}` : ''}`}
        actions={[
          <Button key="q" variant="secondary" icon={ListChecks} onClick={() => navigate('/practice')}>
            Practice
          </Button>,
          <Button key="m" icon={Timer} onClick={() => navigate('/mock')}>
            Take a mock
          </Button>,
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Exam readiness"
          value={`${readiness.readiness}%`}
          hint={`Coverage ${readiness.components.syllabusCoverage}% · Mastery ${readiness.components.avgMastery}%`}
          icon={Target}
          tone={readiness.readiness >= 70 ? 'green' : readiness.readiness >= 45 ? 'amber' : 'red'}
        />
        <StatCard
          label="Questions attempted"
          value={overview.totalQuestionsAttempted}
          hint={`${overview.accuracy}% accuracy · ${overview.totalTests} tests`}
          icon={CheckCircle2}
          tone="brand"
        />
        <StatCard
          label="Learning streak"
          value={`${d.streak?.current || 0} days`}
          hint={`Longest ${d.streak?.longest || 0} days`}
          icon={Flame}
          tone="amber"
        />
        <StatCard
          label="Syllabus covered"
          value={`${overview.topicsTouched}/${overview.topicsTotal}`}
          hint={`${overview.syllabusCoverage}% of topics touched`}
          icon={TrendingUp}
          tone="violet"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Score trend"
            subtitle="Accuracy across your recent tests"
            icon={TrendingUp}
          />
          <div className="card-pad">
            {scoreTrend?.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={scoreTrend} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="acc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3563fb" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#3563fb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    labelFormatter={(v) => new Date(v).toLocaleString('en-IN')}
                    formatter={(v, k) => [k === 'accuracy' ? `${v}%` : v, k]}
                  />
                  <Area
                    type="monotone"
                    dataKey="accuracy"
                    stroke="#3563fb"
                    strokeWidth={2.5}
                    fill="url(#acc)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={ListChecks}
                title="No tests yet"
                description="Attempt your first quiz and your trend line will appear here."
                action={
                  <Button onClick={() => navigate('/practice')} icon={ListChecks}>
                    Start a quiz
                  </Button>
                }
              />
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Today's plan" icon={CalendarCheck} />
            <div className="card-pad">
              {today?.plan ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-ink-900">
                      Day {today.day} of {today.totalDays}
                    </span>
                    <Badge tone="brand">{today.plan.phase || 'Study'}</Badge>
                  </div>
                  <ProgressBar value={today.completionRate} tone="brand" className="mt-3" />
                  <p className="mt-1.5 text-xs text-ink-500">
                    {today.completedDays} of {today.totalDays} days completed
                  </p>

                  <ul className="mt-4 space-y-2">
                    {today.plan.studyTopics?.slice(0, 4).map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink-700">
                        <BookOpen size={15} className="mt-0.5 shrink-0 text-brand-500" />
                        <span>
                          {t.topic}
                          <span className="text-ink-400"> · {t.minutes}m</span>
                        </span>
                      </li>
                    ))}
                    {today.plan.mockTest ? (
                      <li className="flex items-center gap-2 text-sm font-medium text-violet-700">
                        <Timer size={15} /> Full mock test scheduled
                      </li>
                    ) : null}
                  </ul>

                  <Link to="/roadmap" className="btn-secondary mt-4 w-full">
                    Open roadmap
                  </Link>
                </>
              ) : (
                <EmptyState
                  icon={CalendarCheck}
                  title="No roadmap yet"
                  description="Generate a 60-day plan from your syllabus."
                  action={
                    <Button onClick={() => navigate('/roadmap')}>Generate roadmap</Button>
                  }
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Key dates" />
            <ul className="divide-y divide-ink-100">
              {(exam.importantDates || []).slice(0, 5).map((dt, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="text-ink-700">{dt.event}</span>
                  <span className="shrink-0 font-medium text-ink-900">{dt.date || '—'}</span>
                </li>
              ))}
              {!exam.importantDates?.length ? (
                <li className="px-5 py-6 text-center text-sm text-ink-500">
                  No dates were listed in the notification.
                </li>
              ) : null}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Weak topics"
            subtitle="Your next quizzes will focus here"
            icon={AlertTriangle}
            action={
              <Button variant="ghost" onClick={() => navigate('/practice')}>
                Drill these
              </Button>
            }
          />
          <div className="card-pad space-y-3">
            {weakTopics?.length ? (
              weakTopics.map((t, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate pr-3 font-medium text-ink-800">{t.topic}</span>
                    <span className="shrink-0 text-ink-500">{t.mastery}%</span>
                  </div>
                  <ProgressBar value={t.mastery} className="mt-1.5" />
                  <p className="mt-1 text-xs text-ink-400">
                    {t.subject} · {t.mistakeCount} mistakes
                  </p>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-ink-500">
                Attempt a few quizzes and your weak topics will surface here.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Strong topics" subtitle="Keep them warm with revision" icon={Trophy} />
          <div className="card-pad space-y-3">
            {strongTopics?.length ? (
              strongTopics.map((t, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{t.topic}</p>
                    <p className="text-xs text-ink-400">{t.subject}</p>
                  </div>
                  <Badge tone={masteryTone(t.mastery)}>{t.mastery}%</Badge>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-ink-500">
                No topic has reached strong mastery yet. Keep going.
              </p>
            )}
          </div>
        </Card>
      </div>

      {recentSessions?.length ? (
        <Card className="mt-6">
          <CardHeader title="Recent tests" />
          <div className="divide-y divide-ink-100">
            {recentSessions.map((s) => (
              <Link
                key={s._id}
                to={`/result/${s._id}`}
                className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-ink-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{s.title}</p>
                  <p className="text-xs text-ink-400">
                    {s.mode} · {fmtDate(s.submittedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={masteryTone(s.accuracy)}>{s.accuracy}%</Badge>
                  <span className="text-sm font-semibold text-ink-700">
                    {s.score}/{s.maxScore}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}
