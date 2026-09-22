import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ListChecks, Zap, Target, Sparkles, History } from 'lucide-react';
import { examApi, testApi, analyticsApi } from '../api/endpoints.js';
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

const COUNTS = [5, 10, 15, 20, 30];
const DIFFICULTIES = [
  { key: 'adaptive', label: 'Adaptive', hint: 'Matches your current level per topic' },
  { key: 'easy', label: 'Easy', hint: 'Direct recall' },
  { key: 'medium', label: 'Medium', hint: 'One-step application' },
  { key: 'hard', label: 'Hard', hint: 'Multi-step and traps' },
];

export default function Practice() {
  const navigate = useNavigate();
  const { activeExamId } = useAuth();

  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('adaptive');
  const [subject, setSubject] = useState('');
  const [topics, setTopics] = useState([]);
  const [starting, setStarting] = useState(false);

  const syllabus = useAsync(
    () => (activeExamId ? examApi.syllabus(activeExamId) : Promise.resolve(null)),
    [activeExamId],
  );
  const weak = useAsync(
    () => (activeExamId ? analyticsApi.weakTopics({ examId: activeExamId }) : Promise.resolve(null)),
    [activeExamId],
  );
  const history = useAsync(
    () => (activeExamId ? testApi.list({ examId: activeExamId, limit: 8 }) : Promise.resolve(null)),
    [activeExamId],
  );

  const subjects = syllabus.data?.data?.syllabus || [];
  const topicOptions = useMemo(
    () => subjects.find((s) => s.subject === subject)?.topics || [],
    [subjects, subject],
  );

  const toggleTopic = (name) =>
    setTopics((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));

  const start = async (overrides = {}) => {
    setStarting(true);
    try {
      const res = await testApi.startQuiz({
        examId: activeExamId,
        count,
        difficulty,
        subjects: subject ? [subject] : [],
        topics,
        mode: 'quiz',
        ...overrides,
      });
      navigate(`/test/${res.data.session.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  };

  if (!activeExamId) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No active exam"
        description="Upload a notification PDF to unlock adaptive practice."
        action={<Button onClick={() => navigate('/upload')}>Upload a PDF</Button>}
      />
    );
  }

  const weakList = weak.data?.data?.weak || [];

  return (
    <>
      <PageHeader
        title="Practice"
        subtitle="Questions are generated fresh and weighted toward your weak topics."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Build your set" icon={Sparkles} />
            <div className="card-pad space-y-6">
              <div>
                <p className="label">Number of questions</p>
                <div className="flex flex-wrap gap-2">
                  {COUNTS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCount(c)}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                        count === c
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="label">Difficulty</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.key}
                      onClick={() => setDifficulty(d.key)}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        difficulty === d.key
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-ink-200 hover:bg-ink-50'
                      }`}
                    >
                      <p className="text-sm font-semibold text-ink-900">{d.label}</p>
                      <p className="mt-0.5 text-xs text-ink-500">{d.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="label">Subject (optional)</p>
                <select
                  className="input"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setTopics([]);
                  }}
                >
                  <option value="">All subjects</option>
                  {subjects.map((s) => (
                    <option key={s.subject} value={s.subject}>
                      {s.subject}
                    </option>
                  ))}
                </select>
              </div>

              {topicOptions.length ? (
                <div>
                  <p className="label">
                    Topics {topics.length ? `(${topics.length} selected)` : '(optional)'}
                  </p>
                  <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-ink-200 p-3">
                    {topicOptions.map((t) => (
                      <button
                        key={t.name}
                        onClick={() => toggleTopic(t.name)}
                        className={`chip border transition-colors ${
                          topics.includes(t.name)
                            ? 'border-brand-500 bg-brand-600 text-white'
                            : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
                        }`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-5">
                <Button loading={starting} icon={ListChecks} onClick={() => start()}>
                  Start {count}-question set
                </Button>
                <Button
                  variant="secondary"
                  icon={Zap}
                  loading={starting}
                  onClick={() => start({ count: 5, topics: [], subjects: [], difficulty: 'adaptive' })}
                >
                  Quick 5
                </Button>
                {weakList.length ? (
                  <Button
                    variant="secondary"
                    icon={Target}
                    loading={starting}
                    onClick={() =>
                      start({
                        topics: weakList.slice(0, 5).map((t) => t.topic),
                        subjects: [],
                        difficulty: 'adaptive',
                      })
                    }
                  >
                    Drill weak topics
                  </Button>
                ) : null}
              </div>

              <p className="text-xs text-ink-500">
                Generating a fresh set takes 10–30 seconds. Questions you have already seen are never
                repeated.
              </p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Weak topics" subtitle="Where the engine will focus" icon={Target} />
            <div className="card-pad space-y-2.5">
              {weak.loading ? (
                <Skeleton className="h-32" />
              ) : weakList.length ? (
                weakList.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-800">{t.topic}</p>
                      <p className="text-xs text-ink-400">{t.subject}</p>
                    </div>
                    <Badge tone={masteryTone(t.mastery)}>{t.mastery}%</Badge>
                  </div>
                ))
              ) : (
                <p className="py-4 text-center text-sm text-ink-500">
                  Nothing flagged yet. Attempt a set to calibrate.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent sets" icon={History} />
            <div className="divide-y divide-ink-100">
              {history.data?.data?.length ? (
                history.data.data.map((s) => (
                  <button
                    key={s._id}
                    onClick={() =>
                      navigate(s.status === 'submitted' ? `/result/${s._id}` : `/test/${s._id}`)
                    }
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-ink-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{s.title}</p>
                      <p className="text-xs text-ink-400">
                        {s.totalQuestions} questions · {s.status.replace('_', ' ')}
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
                <p className="px-5 py-6 text-center text-sm text-ink-500">No sets yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
