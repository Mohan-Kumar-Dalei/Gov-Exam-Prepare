import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FileUp,
  FileText,
  Trash2,
  CheckCircle2,
  Loader2,
  Sparkles,
  Users,
  CalendarDays,
  ListTree,
} from 'lucide-react';
import { documentApi, examApi } from '../api/endpoints.js';
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
} from '../components/ui/index.jsx';

/** Maps the server's document status onto the visible stage list. */
const STAGES = [
  { key: 'parsing', label: 'Reading the PDF' },
  { key: 'analyzing', label: 'Extracting exam details and syllabus' },
  { key: 'completed', label: 'Building your 60-day roadmap' },
];

const POLL_MS = 3000;
/** Gemini retries and model fallbacks can legitimately take several minutes. */
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

export default function Upload() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const inputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [stage, setStage] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);

  const docs = useAsync(() => documentApi.list({ limit: 10 }), []);
  const busy = stage >= 0;

  const pickFile = useCallback((f) => {
    if (!f) return;
    if (f.type !== 'application/pdf') {
      toast.error('Only PDF files are accepted.');
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('That PDF is larger than 20MB.');
      return;
    }
    setFile(f);
    setResult(null);
  }, []);

  const analyze = async () => {
    if (!file) return;
    setStage(0);
    setUploadPct(0);
    setElapsed(0);

    try {
      // The server returns 202 straight away and processes in the background,
      // because a scanned PDF under upstream load can take several minutes.
      const accepted = await documentApi.upload(file, setUploadPct);
      const { documentId } = accepted.data;
      setFile(null);

      const startedAt = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, POLL_MS));

        const { data } = await documentApi.status(documentId);
        setElapsed(data.elapsedSec || Math.round((Date.now() - startedAt) / 1000));

        const index = STAGES.findIndex((s) => s.key === data.status);
        if (index >= 0) setStage(index);

        if (data.status === 'completed') {
          setStage(-1);
          setResult(data);
          toast.success('PDF analysed successfully.');
          await refreshUser();
          docs.run();
          return;
        }

        if (data.status === 'failed') {
          setStage(-1);
          toast.error(data.error || 'Analysis failed.');
          docs.run();
          return;
        }

        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setStage(-1);
          toast.error(
            'Still processing after 12 minutes. It keeps running on the server — check your uploads list shortly.',
          );
          docs.run();
          return;
        }
      }
    } catch (err) {
      setStage(-1);
      toast.error(err.message);
      docs.run();
    }
  };

  const remove = async (id) => {
    try {
      await documentApi.remove(id);
      toast.success('Document deleted.');
      docs.run();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const activate = async (examId) => {
    try {
      await examApi.activate(examId);
      await refreshUser();
      toast.success('Active exam switched.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader
        title="PDF Analyzer"
        subtitle="Upload an official recruitment notification. Everything else is generated from it."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Upload notification" icon={FileUp} />
            <div className="card-pad">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => !busy && inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                  dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-300 bg-ink-50/50 hover:bg-ink-50'
                } ${busy ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white">
                  <FileUp size={24} />
                </span>
                <p className="mt-4 text-sm font-semibold text-ink-900">
                  {file ? file.name : 'Drop your PDF here, or click to browse'}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  {file
                    ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ready to analyse`
                    : 'PDF up to 20MB. Scanned documents work too — the AI reads the pages.'}
                </p>
              </div>

              {busy ? (
                <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
                  {uploadPct < 100 ? (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs font-medium text-brand-800">
                        <span>Uploading</span>
                        <span>{uploadPct}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-200">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
                          style={{ width: `${uploadPct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  <ul className="space-y-2">
                    {STAGES.map((s, i) => (
                      <li key={s.key} className="flex items-center gap-2.5 text-sm">
                        {i < stage ? (
                          <CheckCircle2 size={16} className="text-emerald-600" />
                        ) : i === stage ? (
                          <Loader2 size={16} className="animate-spin text-brand-600" />
                        ) : (
                          <span className="h-4 w-4 rounded-full border-2 border-ink-300" />
                        )}
                        <span className={i <= stage ? 'text-ink-800' : 'text-ink-400'}>{s.label}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-brand-700">
                    {elapsed > 0 ? `Working for ${elapsed}s. ` : ''}
                    This usually takes a minute or two — longer for a scanned PDF, since every page
                    is read as an image. It keeps running on the server even if you leave this page.
                  </p>
                </div>
              ) : (
                <div className="mt-5 flex gap-2">
                  <Button onClick={analyze} disabled={!file} icon={Sparkles}>
                    Analyse with AI
                  </Button>
                  {file ? (
                    <Button variant="secondary" onClick={() => setFile(null)}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </Card>

          {result ? (
            <Card className="mt-6 animate-fade-up">
              <CardHeader
                title="Extraction complete"
                subtitle={result.exam.examName}
                icon={CheckCircle2}
                action={
                  <Button onClick={() => activate(result.exam._id)}>Make this my exam</Button>
                }
              />
              <div className="card-pad">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    {
                      icon: Users,
                      label: 'Vacancies',
                      value: result.exam.vacancies?.total || result.exam.vacancies?.raw || '—',
                    },
                    {
                      icon: ListTree,
                      label: 'Subjects',
                      value: result.exam.subjects?.length || 0,
                    },
                    {
                      icon: CalendarDays,
                      label: 'Key dates',
                      value: result.exam.importantDates?.length || 0,
                    },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="rounded-xl border border-ink-200 p-4">
                      <div className="flex items-center gap-2 text-ink-500">
                        <Icon size={15} />
                        <span className="text-xs font-medium">{label}</span>
                      </div>
                      <p className="mt-1.5 text-lg font-bold text-ink-900">{value}</p>
                    </div>
                  ))}
                </div>

                {result.isScanned ? (
                  <p className="mt-4 rounded-xl bg-violet-50 p-3 text-xs text-violet-800">
                    This PDF had no text layer, so the AI read all {result.pageCount || ''}{' '}
                    page images directly. Do check the vacancy counts and dates below against the
                    original.
                  </p>
                ) : null}

                <div className="mt-5 space-y-4">
                  {result.exam.syllabus?.map((s) => (
                    <div key={s.subject}>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-ink-900">{s.subject}</h4>
                        <Badge tone="slate">{s.topics.length} topics</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.topics.map((t) => (
                          <span
                            key={t.name}
                            className={`chip ${
                              t.importance === 'high'
                                ? 'bg-rose-50 text-rose-700'
                                : t.importance === 'low'
                                  ? 'bg-ink-100 text-ink-600'
                                  : 'bg-brand-50 text-brand-700'
                            }`}
                          >
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {result.exam.aiNotes ? (
                  <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    <strong>AI note:</strong> {result.exam.aiNotes}
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => navigate('/learn')}>
                    Start learning
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/roadmap')}>
                    {result.roadmapGenerated ? 'View roadmap' : 'Build roadmap'}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader title="Your uploads" icon={FileText} />
          <div className="divide-y divide-ink-100">
            {docs.loading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : docs.data?.data?.length ? (
              docs.data.data.map((doc) => (
                <div key={doc._id} className="flex items-start gap-3 px-5 py-4">
                  <FileText size={18} className="mt-0.5 shrink-0 text-ink-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{doc.originalName}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {doc.exam?.examName || doc.error || 'Not analysed'}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge
                        tone={
                          doc.status === 'completed' ? 'green' : doc.status === 'failed' ? 'red' : 'amber'
                        }
                      >
                        {doc.status}
                      </Badge>
                      <span className="text-[11px] text-ink-400">{doc.pageCount} pages</span>
                    </div>
                    {doc.exam ? (
                      <button
                        onClick={() => activate(doc.exam._id)}
                        className="mt-2 text-xs font-semibold text-brand-600 hover:underline"
                      >
                        Set as active exam
                      </button>
                    ) : null}
                  </div>
                  <button
                    onClick={() => remove(doc._id)}
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            ) : (
              <div className="p-5">
                <EmptyState
                  icon={FileText}
                  title="Nothing uploaded yet"
                  description="Your analysed notifications will appear here."
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
