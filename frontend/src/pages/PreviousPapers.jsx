import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  FileClock,
  Sparkles,
  Eye,
  EyeOff,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Search,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { paperApi } from '../api/endpoints.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  PageHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Spinner,
} from '../components/ui/index.jsx';
import Markdown from '../components/ui/Markdown.jsx';

const OLDEST_YEAR = 2010;
const COUNTS = [10, 15, 25, 40];

const years = () => {
  const now = new Date().getFullYear();
  return Array.from({ length: now - OLDEST_YEAR + 1 }, (_, i) => now - i);
};

/**
 * How faithful a question is to the real paper.
 *
 * Shown on every question rather than tucked into a footnote. A learner
 * revising these will treat them as the official paper unless told otherwise,
 * and the honest answer is that most are reconstructed from the real pattern.
 */
function ProvenanceBadge({ provenance, confidence }) {
  const recalled = provenance === 'recalled';
  return (
    <span
      title={
        recalled
          ? `The model recognises this from the actual paper. Confidence ${confidence}%.`
          : `Written to match the real paper's pattern on the same syllabus point. Confidence ${confidence}%.`
      }
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        recalled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {recalled ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
      {recalled ? 'From the paper' : 'Reconstructed'}
    </span>
  );
}

/** One revisable question: read it, try it, then reveal the answer. */
function PaperQuestion({ q, revealAll }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const shown = open || revealAll;

  const choose = (i) => {
    setPicked(i);
    setOpen(true);
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-100 text-xs font-bold text-ink-600">
          {q.questionNumber}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-[15px] font-medium leading-relaxed text-ink-900">{q.question}</p>
            <ProvenanceBadge provenance={q.provenance} confidence={q.factualConfidence} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {q.options.map((opt, i) => {
              const isAnswer = i === q.answerIndex;
              const isPicked = picked === i;

              // Before revealing, a pick is just a selection — marking it right
              // or wrong here would give the answer away before the learner
              // has committed to it.
              let tone = 'border-ink-200 bg-white hover:border-brand-300 hover:bg-brand-50/40';
              if (shown && isAnswer) tone = 'border-emerald-300 bg-emerald-50';
              else if (shown && isPicked) tone = 'border-rose-300 bg-rose-50';
              else if (isPicked) tone = 'border-brand-400 bg-brand-50';

              return (
                <button
                  key={i}
                  onClick={() => choose(i)}
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${tone}`}
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white/70 text-[11px] font-bold text-ink-500">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="min-w-0 flex-1 text-ink-800">{opt}</span>
                  {shown && isAnswer ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
            >
              {shown ? <EyeOff size={13} /> : <Eye size={13} />}
              {shown ? 'Hide answer' : 'Show answer'}
            </button>
            {q.subject ? <Badge tone="slate">{q.subject}</Badge> : null}
            {q.topic ? <Badge tone="slate">{q.topic}</Badge> : null}
          </div>

          {shown && q.explanation ? (
            <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
              <Markdown tone="chat">{q.explanation}</Markdown>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** The open paper: its honesty banner, filters, and the questions. */
function PaperReader({ paper, onBack, onDelete }) {
  const [revealAll, setRevealAll] = useState(false);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');

  const subjects = useMemo(
    () => [...new Set((paper.questions || []).map((q) => q.subject).filter(Boolean))],
    [paper],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (paper.questions || []).filter((q) => {
      if (subject && q.subject !== subject) return false;
      if (!needle) return true;
      return (
        q.question.toLowerCase().includes(needle) ||
        q.options.some((o) => o.toLowerCase().includes(needle))
      );
    });
  }, [paper, query, subject]);

  const recalled = (paper.questions || []).filter((q) => q.provenance === 'recalled').length;
  const total = paper.questions?.length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          All papers
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" icon={revealAll ? EyeOff : Eye} onClick={() => setRevealAll((v) => !v)}>
            {revealAll ? 'Hide all answers' : 'Show all answers'}
          </Button>
          <Button variant="secondary" icon={Trash2} onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      {/*
        The honesty banner. This is the most important element on the page:
        without it a learner reasonably assumes every question below is the
        official paper, and revises a reconstruction as if it were fact.
      */}
      <Card
        className={`border-l-4 p-4 ${recalled ? 'border-l-emerald-400' : 'border-l-amber-400'}`}
      >
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold text-ink-900">
              How faithful is this paper?
            </p>
            <p className="text-sm leading-relaxed text-ink-600">
              Of {total} questions, <strong className="text-emerald-700">{recalled}</strong>{' '}
              {recalled === 1 ? 'is one the model' : 'are ones the model'} recognises from the
              actual {paper.year} paper, and{' '}
              <strong className="text-amber-700">{total - recalled}</strong>{' '}
              {total - recalled === 1 ? 'was' : 'were'} written to match that paper&apos;s pattern
              on the same syllabus points. Revise the reconstructed ones for the{' '}
              <em>type</em> of question, not as the official key.
            </p>
            {paper.sourceBasis ? (
              <p className="text-xs leading-relaxed text-ink-500">{paper.sourceBasis}</p>
            ) : null}
            <p className="text-xs text-ink-500">
              {paper.grounded
                ? 'Backed by a web search of the real paper.'
                : 'Written from the model’s own knowledge — no web search backed this one.'}
            </p>
            {paper.groundingSources?.length ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {paper.groundingSources.map((src) => (
                  <a
                    key={src}
                    href={src}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="max-w-[220px] truncate rounded-md bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 hover:bg-ink-200"
                  >
                    {src.replace(/^https?:\/\//, '')}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search these questions…"
            className="w-full rounded-xl border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        {subjects.length > 1 ? (
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-56"
          >
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {visible.length ? (
        <div className="space-y-3">
          {visible.map((q) => (
            <PaperQuestion key={q.questionNumber} q={q} revealAll={revealAll} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="Nothing matches"
          description="No question in this paper matches your search."
        />
      )}
    </div>
  );
}

export default function PreviousPapers() {
  const { activeExamId } = useAuth();

  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [paperName, setPaperName] = useState('');
  const [count, setCount] = useState(25);
  const [building, setBuilding] = useState(false);
  const [openPaper, setOpenPaper] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const list = useAsync(
    () => (activeExamId ? paperApi.list(activeExamId) : Promise.resolve(null)),
    [activeExamId],
  );

  const papers = list.data?.data?.papers || [];
  const exam = list.data?.data?.exam;

  const build = async (regenerate = false) => {
    setBuilding(true);
    try {
      const res = await paperApi.build(activeExamId, { year, paperName, count, regenerate });
      toast.success(res.message || 'Paper ready.');
      await list.run();
      setOpenPaper(res.data.paper);
      setFormOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBuilding(false);
    }
  };

  const open = async (paper) => {
    try {
      const res = await paperApi.get(activeExamId, paper._id);
      setOpenPaper(res.data.paper);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (paper) => {
    try {
      await paperApi.remove(activeExamId, paper._id);
      toast.success('Paper deleted.');
      setOpenPaper(null);
      await list.run();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!activeExamId) {
    return (
      <EmptyState
        icon={FileClock}
        title="No active exam"
        description="Upload a recruitment notification first — past papers are built around that exam's pattern and syllabus."
      />
    );
  }

  if (openPaper) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 animate-fade-up">
        <PageHeader
          title={`${openPaper.year} ${openPaper.paperName || 'paper'}`}
          subtitle={exam?.examName}
        />
        <PaperReader
          paper={openPaper}
          onBack={() => setOpenPaper(null)}
          onDelete={() => remove(openPaper)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Previous papers"
        subtitle="Revise past-year questions with their answers and explanations."
        actions={
          <Button icon={Sparkles} onClick={() => setFormOpen((v) => !v)}>
            Build a paper
          </Button>
        }
      />

      {formOpen ? (
        <Card className="p-4 sm:p-5">
          <CardHeader
            title="Build a past paper"
            subtitle="Pick a year. The closer to the present, the more reliable the result."
            icon={FileClock}
          />

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-600">Year</span>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              >
                {years().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-600">
                Paper or shift <span className="font-normal text-ink-400">(optional)</span>
              </span>
              <input
                value={paperName}
                onChange={(e) => setPaperName(e.target.value)}
                placeholder="e.g. Paper I, Shift 2"
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-ink-600">Questions</span>
              <div className="flex flex-wrap gap-2">
                {COUNTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCount(c)}
                    className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                      count === c
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button icon={Sparkles} onClick={() => build(false)} disabled={building}>
              {building ? 'Building…' : 'Build paper'}
            </Button>
            {building ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink-500">
                <Spinner size={15} />
                Searching for the real paper — this takes a minute.
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {list.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.run} />
      ) : papers.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {papers.map((p) => (
            <Card key={p._id} className="flex flex-col p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-ink-900">{p.year}</p>
                  <p className="truncate text-sm text-ink-500">{p.paperName || 'Full paper'}</p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <FileClock size={19} />
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="slate">{p.questionCount} questions</Badge>
                {p.recalledCount ? (
                  <Badge tone="green">{p.recalledCount} from the paper</Badge>
                ) : null}
                {p.grounded ? <Badge tone="brand">Web-checked</Badge> : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                <Button onClick={() => open(p)}>Revise</Button>
                <Button
                  variant="secondary"
                  icon={Trash2}
                  onClick={() => remove(p)}
                  className="ml-auto"
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileClock}
          title="No past papers yet"
          description="Build one for any year and revise its questions with full answers and explanations."
          action={
            <Button icon={Sparkles} onClick={() => setFormOpen(true)}>
              Build your first paper
            </Button>
          }
        />
      )}
    </div>
  );
}
