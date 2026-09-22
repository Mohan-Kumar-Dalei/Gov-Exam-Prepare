import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BarChart3,
  Target,
  Sparkles,
  TrendingUp,
  Activity,
  AlertTriangle,
  Trophy,
} from 'lucide-react';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { analyticsApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  Badge,
  Button,
  StatCard,
  PageHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  ProgressBar,
  masteryTone,
} from '../components/ui/index.jsx';

const LEVEL_TONE = {
  mastered: 'green',
  strong: 'green',
  average: 'amber',
  weak: 'red',
  untouched: 'slate',
};

export default function Analytics() {
  const navigate = useNavigate();
  const { activeExamId } = useAuth();
  const [aiLoading, setAiLoading] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [sort, setSort] = useState('mastery');

  const dash = useAsync(() => analyticsApi.dashboard(), []);
  const topics = useAsync(
    () => (activeExamId ? analyticsApi.topics({ examId: activeExamId }) : Promise.resolve(null)),
    [activeExamId],
  );
  const activity = useAsync(() => analyticsApi.activity({ days: 60 }), []);

  const runPrediction = async () => {
    setAiLoading(true);
    try {
      const res = await analyticsApi.readiness({ examId: activeExamId, ai: true });
      setPrediction(res.data.ai);
      toast.success('Prediction updated.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  if (!activeExamId) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No active exam"
        description="Analytics appear once you have an exam and some attempts."
        action={<Button onClick={() => navigate('/upload')}>Upload a PDF</Button>}
      />
    );
  }

  if (dash.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.run} />;

  const d = dash.data?.data;
  if (!d?.hasExam) {
    return <EmptyState icon={BarChart3} title="Nothing to analyse yet" />;
  }

  const { overview, readiness, subjectPerformance, scoreTrend } = d;
  const allTopics = topics.data?.data?.all || [];

  const sortedTopics = [...allTopics].sort((a, b) => {
    if (sort === 'mastery') return a.mastery - b.mastery;
    if (sort === 'mistakes') return b.mistakeCount - a.mistakeCount;
    return a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic);
  });

  const radarData = subjectPerformance?.map((s) => ({
    subject: s.subject.length > 14 ? `${s.subject.slice(0, 13)}…` : s.subject,
    mastery: s.mastery,
    accuracy: s.accuracy,
  }));

  // A radar whose values are all zero collapses to a point: the axes draw but
  // the shape is invisible, which reads as a broken chart rather than an empty
  // one. Rows existing is not the same as those rows carrying a signal.
  const hasMasterySignal = radarData?.some((s) => s.mastery > 0 || s.accuracy > 0);
  const activityDays = activity.data?.data?.days || [];
  const hasActivitySignal = activityDays.some((d) => d.questions > 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Where you stand, topic by topic."
        actions={
          <Button icon={Sparkles} loading={aiLoading} onClick={runPrediction}>
            AI readiness report
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Readiness"
          value={`${readiness.readiness}%`}
          hint="Mastery 50% · Coverage 30% · Recent 20%"
          icon={Target}
          tone={readiness.readiness >= 70 ? 'green' : readiness.readiness >= 45 ? 'amber' : 'red'}
        />
        <StatCard
          label="Accuracy"
          value={`${overview.accuracy}%`}
          hint={`${overview.totalCorrect}/${overview.totalQuestionsAttempted} correct`}
          icon={TrendingUp}
          tone="brand"
        />
        <StatCard
          label="Avg time / question"
          value={`${overview.avgTimePerQuestionSec}s`}
          hint={`${overview.totalStudyMinutes} minutes practised`}
          icon={Activity}
          tone="violet"
        />
        <StatCard
          label="Question bank"
          value={overview.questionBankSize}
          hint={`${overview.lessonsCompleted} lessons completed`}
          icon={Trophy}
          tone="green"
        />
      </div>

      {prediction ? (
        <Card className="mt-6 animate-fade-up border-violet-200 bg-gradient-to-br from-violet-50 to-white">
          <CardHeader title="AI readiness report" icon={Sparkles} />
          <div className="card-pad">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-4xl font-bold text-violet-700">{prediction.readinessPercent}%</p>
                <p className="text-xs text-ink-500">ready today</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-ink-900">
                  {prediction.projectedReadinessIn30Days}%
                </p>
                <p className="text-xs text-ink-500">projected in 30 days</p>
              </div>
              <p className="flex-1 text-sm text-ink-700">{prediction.verdict}</p>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {prediction.improvementAreas?.length ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Improvement areas
                  </p>
                  <div className="space-y-2.5">
                    {prediction.improvementAreas.map((a, i) => (
                      <div key={i} className="rounded-xl border border-ink-200 bg-white p-3">
                        <p className="text-sm font-semibold text-ink-900">{a.area}</p>
                        <p className="mt-0.5 text-xs text-ink-600">{a.why}</p>
                        <p className="mt-1.5 text-xs font-medium text-brand-700">→ {a.action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-5">
                {prediction.strengths?.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Strengths
                    </p>
                    <ul className="space-y-1.5">
                      {prediction.strengths.map((s, i) => (
                        <li key={i} className="text-sm text-ink-700">
                          · {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {prediction.riskFactors?.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Risks
                    </p>
                    <ul className="space-y-1.5">
                      {prediction.riskFactors.map((s, i) => (
                        <li key={i} className="text-sm text-ink-700">
                          · {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Subject mastery" subtitle="Averaged across each subject's topics" />
          <div className="card-pad">
            {hasMasterySignal ? (
              <ResponsiveContainer width="100%" height={290}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#475569' }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Radar name="Mastery" dataKey="mastery" stroke="#3563fb" fill="#3563fb" fillOpacity={0.3} />
                  <Radar name="Accuracy" dataKey="accuracy" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm text-ink-500">No mastery recorded yet.</p>
                <Button variant="secondary" className="mt-4" onClick={() => navigate('/practice')}>
                  Attempt a quiz to fill this in
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Accuracy over time" />
          <div className="card-pad">
            {scoreTrend?.length ? (
              <ResponsiveContainer width="100%" height={290}>
                <LineChart data={scoreTrend} margin={{ left: -22, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                    }
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Line type="monotone" dataKey="accuracy" stroke="#3563fb" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-ink-500">Attempt a test to see the trend.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Daily activity" subtitle="Questions attempted per day" icon={Activity} />
        <div className="card-pad">
          {hasActivitySignal ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={activityDays} margin={{ left: -24, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="questions" fill="#3563fb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-sm text-ink-500">
              No questions attempted yet — this fills in as you practise.
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Topic-wise progress"
          subtitle={`${allTopics.length} topics tracked`}
          action={
            <select className="input w-auto py-2 text-xs" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="mastery">Weakest first</option>
              <option value="mistakes">Most mistakes</option>
              <option value="subject">By subject</option>
            </select>
          }
        />
        <div className="overflow-x-auto">
          {topics.loading ? (
            <div className="p-5">
              <Skeleton className="h-48" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Topic</th>
                  <th className="px-3 py-3 font-semibold">Subject</th>
                  <th className="px-3 py-3 font-semibold">Attempted</th>
                  <th className="px-3 py-3 font-semibold">Accuracy</th>
                  <th className="px-3 py-3 font-semibold">Mistakes</th>
                  <th className="px-5 py-3 font-semibold">Mastery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {sortedTopics.map((t, i) => (
                  <tr key={i} className="hover:bg-ink-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink-900">{t.topic}</span>
                        <Badge tone={LEVEL_TONE[t.level]} className="text-[10px]">
                          {t.level}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-ink-600">{t.subject}</td>
                    <td className="px-3 py-3 text-ink-600">{t.attempted}</td>
                    <td className="px-3 py-3 text-ink-600">{t.accuracy}%</td>
                    <td className="px-3 py-3">
                      {t.mistakeCount ? (
                        <span className="flex items-center gap-1 text-rose-600">
                          <AlertTriangle size={13} /> {t.mistakeCount}
                        </span>
                      ) : (
                        <span className="text-ink-400">0</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={t.mastery} className="w-24" />
                        <span className="w-10 text-xs text-ink-500">{t.mastery}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {[
          { key: 'weak', title: 'Focus list', icon: AlertTriangle, tone: 'red' },
          { key: 'strong', title: 'Secured topics', icon: Trophy, tone: 'green' },
        ].map(({ key, title, icon: Icon }) => (
          <Card key={key}>
            <CardHeader title={title} icon={Icon} />
            <div className="card-pad space-y-2.5">
              {(topics.data?.data?.[key] || []).map((t, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{t.topic}</p>
                    <p className="text-xs text-ink-400">{t.subject}</p>
                  </div>
                  <Badge tone={masteryTone(t.mastery)}>{t.mastery}%</Badge>
                </div>
              ))}
              {!(topics.data?.data?.[key] || []).length ? (
                <p className="py-4 text-center text-sm text-ink-500">Nothing here yet.</p>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
