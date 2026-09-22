import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Timer, Layers, AlertTriangle, History, Play } from 'lucide-react';
import { examApi, testApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  PageHeader,
  EmptyState,
  Skeleton,
  masteryTone,
} from '../components/ui/index.jsx';

const SIZES = [25, 50, 100];

export default function Mock() {
  const navigate = useNavigate();
  const { activeExamId } = useAuth();
  const [size, setSize] = useState(50);
  const [starting, setStarting] = useState(false);

  const exam = useAsync(
    () => (activeExamId ? examApi.get(activeExamId) : Promise.resolve(null)),
    [activeExamId],
  );
  const history = useAsync(
    () =>
      activeExamId
        ? testApi.list({ examId: activeExamId, mode: 'mock', limit: 10 })
        : Promise.resolve(null),
    [activeExamId],
  );

  const start = async () => {
    setStarting(true);
    const toastId = toast.loading('Building your mock paper — this can take a minute…');
    try {
      const res = await testApi.startMock({ examId: activeExamId, maxQuestions: size });
      toast.success('Mock ready. Good luck.', { id: toastId });
      navigate(`/test/${res.data.session.id}`);
    } catch (err) {
      toast.error(err.message, { id: toastId });
    } finally {
      setStarting(false);
    }
  };

  if (!activeExamId) {
    return (
      <EmptyState
        icon={Timer}
        title="No active exam"
        description="Mock tests are built from your exam's official pattern — upload a notification first."
        action={<Button onClick={() => navigate('/upload')}>Upload a PDF</Button>}
      />
    );
  }

  const pattern = exam.data?.data?.exam?.examPattern;

  return (
    <>
      <PageHeader
        title="Mock Tests"
        subtitle="Full computer-based tests generated from the real exam pattern."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader title="Official pattern" icon={Layers} />
            <div className="card-pad">
              {exam.loading ? (
                <Skeleton className="h-32" />
              ) : pattern ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      ['Mode', pattern.mode || 'CBT'],
                      ['Questions', pattern.totalQuestions || '—'],
                      ['Marks', pattern.totalMarks || '—'],
                      ['Duration', pattern.durationMinutes ? `${pattern.durationMinutes} min` : '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-ink-200 p-3.5">
                        <p className="text-xs font-medium text-ink-500">{label}</p>
                        <p className="mt-1 text-lg font-bold text-ink-900">{value}</p>
                      </div>
                    ))}
                  </div>

                  {pattern.negativeMarking ? (
                    <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                      <AlertTriangle size={16} />
                      Negative marking: {pattern.negativeMarking} mark deducted per wrong answer.
                    </p>
                  ) : null}

                  {pattern.sections?.length ? (
                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                            <th className="pb-2 pr-4 font-semibold">Section</th>
                            <th className="pb-2 pr-4 font-semibold">Questions</th>
                            <th className="pb-2 pr-4 font-semibold">Marks</th>
                            <th className="pb-2 font-semibold">Duration</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {pattern.sections.map((s, i) => (
                            <tr key={i}>
                              <td className="py-2.5 pr-4 font-medium text-ink-800">{s.section}</td>
                              <td className="py-2.5 pr-4 text-ink-600">{s.questions || '—'}</td>
                              <td className="py-2.5 pr-4 text-ink-600">{s.marks || '—'}</td>
                              <td className="py-2.5 text-ink-600">
                                {s.durationMinutes ? `${s.durationMinutes} min` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-ink-500">
                  The notification did not specify a pattern. A standard pattern will be used.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Start a mock" icon={Play} />
            <div className="card-pad">
              <p className="label">Paper length</p>
              <div className="flex flex-wrap gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`rounded-xl border px-5 py-3 text-left transition-colors ${
                      size === s ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:bg-ink-50'
                    }`}
                  >
                    <p className="text-sm font-bold text-ink-900">{s} questions</p>
                    <p className="text-xs text-ink-500">
                      {s === 25 ? 'Quick sectional' : s === 50 ? 'Half length' : 'Full length'}
                    </p>
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-ink-200 bg-ink-50 p-4 text-sm text-ink-600">
                <p className="font-semibold text-ink-900">Before you begin</p>
                <ul className="mt-2 space-y-1">
                  <li>· The timer starts immediately and auto-submits when it ends.</li>
                  <li>· Questions you have already attempted will not reappear.</li>
                  <li>· Generation takes 30–90 seconds for a full paper.</li>
                </ul>
              </div>

              <Button className="mt-5" loading={starting} icon={Timer} onClick={start}>
                Start {size}-question mock
              </Button>
            </div>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Past mocks" icon={History} />
          <div className="divide-y divide-ink-100">
            {history.loading ? (
              <div className="p-5">
                <Skeleton className="h-24" />
              </div>
            ) : history.data?.data?.length ? (
              history.data.data.map((s) => (
                <button
                  key={s._id}
                  onClick={() => navigate(s.status === 'submitted' ? `/result/${s._id}` : `/test/${s._id}`)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-ink-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{s.title}</p>
                    <p className="text-xs text-ink-400">
                      {s.submittedAt
                        ? new Date(s.submittedAt).toLocaleDateString('en-IN')
                        : 'In progress'}
                      {' · '}
                      {s.totalQuestions} Q
                    </p>
                  </div>
                  {s.status === 'submitted' ? (
                    <Badge tone={masteryTone(s.accuracy)}>{s.accuracy}%</Badge>
                  ) : (
                    <Badge tone="amber">resume</Badge>
                  )}
                </button>
              ))
            ) : (
              <p className="px-5 py-8 text-center text-sm text-ink-500">
                No mocks attempted yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
