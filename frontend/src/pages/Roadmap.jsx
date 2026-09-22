import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CalendarRange,
  CheckCircle2,
  Circle,
  Timer,
  RefreshCw,
  BookOpen,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { roadmapApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  ProgressBar,
  PageHeader,
  EmptyState,
  Skeleton,
} from '../components/ui/index.jsx';

const FILTERS = [
  { key: 'all', label: 'All days' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'pending', label: 'Missed' },
  { key: 'done', label: 'Completed' },
];

export default function Roadmap() {
  const navigate = useNavigate();
  const { activeExamId, user } = useAuth();

  const [filter, setFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [days, setDays] = useState(60);

  const { data, loading, error, run } = useAsync(
    () => (activeExamId ? roadmapApi.get({ examId: activeExamId }) : Promise.resolve(null)),
    [activeExamId],
  );

  const roadmap = data?.data?.roadmap;
  const currentDay = data?.data?.currentDay || 1;

  const visible = useMemo(() => {
    const all = roadmap?.days || [];
    if (filter === 'upcoming') return all.filter((d) => d.day >= currentDay && !d.completed);
    if (filter === 'pending') return all.filter((d) => d.day < currentDay && !d.completed);
    if (filter === 'done') return all.filter((d) => d.completed);
    return all;
  }, [roadmap, filter, currentDay]);

  const generate = async (regenerate = false) => {
    setGenerating(true);
    const toastId = toast.loading(
      regenerate ? 'Rebuilding your plan around your weak topics…' : 'Building your study plan…',
    );
    try {
      await roadmapApi.generate({
        examId: activeExamId,
        days,
        dailyMinutes: user?.preferences?.dailyStudyMinutes || 120,
        regenerate,
      });
      toast.success('Roadmap ready.', { id: toastId });
      run();
    } catch (err) {
      toast.error(err.message, { id: toastId });
    } finally {
      setGenerating(false);
    }
  };

  const toggleDay = async (day) => {
    try {
      await roadmapApi.markDay(roadmap._id, day.day, {
        completed: !day.completed,
        actualMinutes: day.targetMinutes,
      });
      run();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!activeExamId) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="No active exam"
        description="A roadmap is built from your exam's syllabus."
        action={<Button onClick={() => navigate('/upload')}>Upload a PDF</Button>}
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !roadmap) {
    return (
      <>
        <PageHeader title="Roadmap" subtitle="A day-by-day plan to cover the whole syllabus." />
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={CalendarRange}
              title="No roadmap yet"
              description="Generate a day-wise plan covering every topic, with revisions and mock tests spaced through it."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <select
                    className="input w-auto"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[30, 45, 60, 90].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                  <Button loading={generating} icon={Sparkles} onClick={() => generate(false)}>
                    Generate plan
                  </Button>
                </div>
              }
            />
          </div>
        </Card>
      </>
    );
  }

  const completed = roadmap.days.filter((d) => d.completed).length;

  return (
    <>
      <PageHeader
        title="Roadmap"
        subtitle={roadmap.title}
        actions={
          <Button variant="secondary" icon={RefreshCw} loading={generating} onClick={() => generate(true)}>
            Rebuild around weak topics
          </Button>
        }
      />

      <Card className="mb-6">
        <div className="card-pad">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-ink-500">Progress</p>
              <p className="text-2xl font-bold text-ink-900">
                Day {currentDay} <span className="text-base font-medium text-ink-400">of {roadmap.totalDays}</span>
              </p>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-ink-500">Completed</p>
                <p className="text-lg font-bold text-emerald-600">{completed}</p>
              </div>
              <div>
                <p className="text-ink-500">Daily target</p>
                <p className="text-lg font-bold text-ink-900">{roadmap.dailyMinutes} min</p>
              </div>
              <div>
                <p className="text-ink-500">Mocks planned</p>
                <p className="text-lg font-bold text-violet-600">
                  {roadmap.days.filter((d) => d.mockTest).length}
                </p>
              </div>
            </div>
          </div>

          <ProgressBar
            value={(completed / roadmap.totalDays) * 100}
            tone="brand"
            className="mt-4"
          />

          {roadmap.strategy ? (
            <p className="mt-4 rounded-xl bg-brand-50 p-3.5 text-sm leading-relaxed text-brand-900">
              {roadmap.strategy}
            </p>
          ) : null}

          {roadmap.phases?.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {roadmap.phases.map((p, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-3 ${
                    currentDay >= p.fromDay && currentDay <= p.toDay
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-ink-200'
                  }`}
                >
                  <p className="text-xs font-semibold text-ink-900">{p.name}</p>
                  <p className="text-[11px] text-ink-500">
                    Day {p.fromDay}–{p.toDay}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">{p.goal}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              filter === f.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((day) => {
          const isToday = day.day === currentDay;
          const isPast = day.day < currentDay;

          return (
            <Card
              key={day.day}
              className={`${isToday ? 'border-brand-400 ring-2 ring-brand-100' : ''} ${
                isPast && !day.completed ? 'border-rose-200' : ''
              }`}
            >
              <div className="card-pad">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleDay(day)}
                      className="mt-0.5 shrink-0"
                      title={day.completed ? 'Mark incomplete' : 'Mark complete'}
                    >
                      {day.completed ? (
                        <CheckCircle2 size={22} className="text-emerald-600" />
                      ) : (
                        <Circle size={22} className="text-ink-300 hover:text-brand-500" />
                      )}
                    </button>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-ink-900">Day {day.day}</h3>
                        {isToday ? <Badge tone="brand">Today</Badge> : null}
                        {day.phase ? <Badge tone="slate">{day.phase}</Badge> : null}
                        {day.mockTest ? <Badge tone="violet">Mock test</Badge> : null}
                        {isPast && !day.completed ? <Badge tone="red">Missed</Badge> : null}
                      </div>
                      {day.date ? (
                        <p className="mt-0.5 text-xs text-ink-400">
                          {new Date(day.date).toLocaleDateString('en-IN', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <Timer size={14} /> {day.targetMinutes} min · {day.quizCount} questions
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {day.studyTopics?.length ? (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                        <BookOpen size={13} /> Study
                      </p>
                      <ul className="space-y-1">
                        {day.studyTopics.map((t, i) => (
                          <li key={i} className="text-sm text-ink-700">
                            {t.topic}
                            <span className="text-ink-400"> · {t.minutes}m</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {day.revisionTopics?.length ? (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                        <RotateCcw size={13} /> Revise
                      </p>
                      <ul className="space-y-1">
                        {day.revisionTopics.map((t, i) => (
                          <li key={i} className="text-sm text-ink-700">
                            {t.topic}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {day.notes ? <p className="mt-3 text-xs italic text-ink-500">{day.notes}</p> : null}

                {isToday ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                    {day.studyTopics?.[0] ? (
                      <Button
                        variant="secondary"
                        icon={BookOpen}
                        onClick={() =>
                          navigate(
                            `/learn/${activeExamId}/lesson?subject=${encodeURIComponent(
                              day.studyTopics[0].subject,
                            )}&topic=${encodeURIComponent(day.studyTopics[0].topic)}`,
                          )
                        }
                      >
                        Start today's topic
                      </Button>
                    ) : null}
                    {day.mockTest ? (
                      <Button icon={Timer} onClick={() => navigate('/mock')}>
                        Take the mock
                      </Button>
                    ) : (
                      <Button onClick={() => navigate('/practice')}>Practise {day.quizCount} questions</Button>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}

        {!visible.length ? (
          <EmptyState title="Nothing in this view" description="Switch the filter to see other days." />
        ) : null}
      </div>
    </>
  );
}
