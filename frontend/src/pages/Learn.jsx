import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, Search, Sparkles, CheckCircle2, Compass } from 'lucide-react';
import { examApi, learningApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  Badge,
  ProgressBar,
  Button,
  PageHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  masteryTone,
} from '../components/ui/index.jsx';

export default function Learn() {
  const navigate = useNavigate();
  const { activeExamId } = useAuth();
  const [query, setQuery] = useState('');
  const [openSubject, setOpenSubject] = useState(null);

  const syllabus = useAsync(
    () => (activeExamId ? examApi.syllabus(activeExamId) : Promise.resolve(null)),
    [activeExamId],
  );
  const next = useAsync(
    () => (activeExamId ? learningApi.next(activeExamId) : Promise.resolve(null)),
    [activeExamId],
  );

  const subjects = syllabus.data?.data?.syllabus || [];

  const filtered = useMemo(() => {
    if (!query.trim()) return subjects;
    const q = query.toLowerCase();
    return subjects
      .map((s) => ({ ...s, topics: s.topics.filter((t) => t.name.toLowerCase().includes(q)) }))
      .filter((s) => s.topics.length || s.subject.toLowerCase().includes(q));
  }, [subjects, query]);

  const openTopic = (subject, topic) =>
    navigate(
      `/learn/${activeExamId}/lesson?subject=${encodeURIComponent(subject)}&topic=${encodeURIComponent(topic)}`,
    );

  if (!activeExamId) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No active exam"
        description="Upload a notification PDF first — lessons are generated from its syllabus."
        action={<Button onClick={() => navigate('/upload')}>Upload a PDF</Button>}
      />
    );
  }

  if (syllabus.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (syllabus.error) return <ErrorState error={syllabus.error} onRetry={syllabus.run} />;

  const recommendation = next.data?.data?.recommendation;
  const coverage = next.data?.data?.coverage;

  return (
    <>
      <PageHeader
        title="Learn"
        subtitle={syllabus.data?.data?.examName}
        actions={
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input w-full pl-9 sm:w-72"
              placeholder="Search topics…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      />

      {recommendation ? (
        <Card className="mb-6 border-brand-200 bg-gradient-to-br from-brand-50 to-white">
          <div className="card-pad flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
                <Compass size={19} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  Study next: {recommendation.topic}
                </p>
                <p className="mt-0.5 text-sm text-ink-600">{recommendation.reason}</p>
                {coverage ? (
                  <p className="mt-1 text-xs text-ink-500">
                    {coverage.lessonsCompleted} lessons done · {coverage.touched}/{coverage.total} topics
                    practised
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              icon={Sparkles}
              className="shrink-0"
              onClick={() => openTopic(recommendation.subject, recommendation.topic)}
            >
              Teach me this
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="space-y-4">
        {filtered.map((s) => {
          const open = openSubject === s.subject || Boolean(query.trim());
          const avg = s.topics.length
            ? Math.round(s.topics.reduce((sum, t) => sum + (t.mastery || 0), 0) / s.topics.length)
            : 0;

          return (
            <Card key={s.subject}>
              <button
                onClick={() => setOpenSubject(open && !query ? null : s.subject)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink-900">{s.subject}</h3>
                    <Badge tone="slate">{s.topics.length} topics</Badge>
                    <Badge tone={masteryTone(avg)}>{avg}% mastery</Badge>
                  </div>
                  <ProgressBar value={avg} className="mt-2.5 max-w-md" />
                </div>
                <ChevronRight
                  size={18}
                  className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`}
                />
              </button>

              {open ? (
                <div className="grid gap-2 border-t border-ink-100 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
                  {s.topics.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => openTopic(s.subject, t.name)}
                      className="group flex items-start justify-between gap-3 rounded-xl border border-ink-200 p-3.5 text-left transition-all hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-ink-900">{t.name}</p>
                          {t.lessonCompleted ? (
                            <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                          ) : null}
                        </div>
                        {t.subtopics?.length ? (
                          <p className="mt-0.5 truncate text-xs text-ink-500">
                            {t.subtopics.slice(0, 3).join(' · ')}
                          </p>
                        ) : null}
                        <div className="mt-2 flex items-center gap-2">
                          <ProgressBar value={t.mastery} className="max-w-[120px]" />
                          <span className="text-[11px] text-ink-500">{t.mastery}%</span>
                          {t.importance === 'high' ? (
                            <Badge tone="red" className="text-[10px]">
                              high weight
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <BookOpen
                        size={16}
                        className="mt-0.5 shrink-0 text-ink-300 transition-colors group-hover:text-brand-600"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </Card>
          );
        })}

        {!filtered.length ? (
          <EmptyState title="No topics match that search" description="Try a different keyword." />
        ) : null}
      </div>
    </>
  );
}
