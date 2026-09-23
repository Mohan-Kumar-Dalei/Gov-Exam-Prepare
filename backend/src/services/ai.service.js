const { generate, generateJson, generateStream, uploadFile, deleteFile } = require('./gemini.service.js');
const P = require('./prompts.js');
const { clampText } = require('../utils/text.js');
const { safeExtractJson } = require('../utils/jsonExtract.js');
const logger = require('../utils/logger.js');
const ApiError = require('../utils/ApiError.js');


const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

/* ------------------------------------------------------------------ */
/* Notification analysis                                               */
/* ------------------------------------------------------------------ */

/** Coerces the model's exam JSON into exactly the shape the Exam model expects. */
function normaliseExam(raw) {
  const syllabus = arr(raw.syllabus)
    .map((s) => ({
      subject: str(s.subject),
      weightage: num(s.weightage),
      fromNotification: s.fromNotification !== false,
      topics: arr(s.topics)
        .map((t) => ({
          name: typeof t === 'string' ? t : str(t.name),
          subtopics: typeof t === 'string' ? [] : arr(t.subtopics).map((x) => str(x)).filter(Boolean),
          importance: ['low', 'medium', 'high'].includes(t?.importance) ? t.importance : 'medium',
          estimatedHours: num(t?.estimatedHours, 2),
          // Absent means the model did not answer the question; assume it read it.
          fromNotification: typeof t === 'string' ? true : t?.fromNotification !== false,
        }))
        .filter((t) => t.name),
    }))
    .filter((s) => s.subject && s.topics.length);

  if (!syllabus.length) {
    throw ApiError.unprocessable(
      raw.examName
        ? `The AI read this notification ("${str(raw.examName)}") but could not derive a syllabus from it. Some notices — apprenticeships, merit-based or interview-only posts — have no written exam. If yours does, try Re-analyse.`
        : 'The AI could not find a syllabus in this PDF. Please upload a recruitment notification that lists an exam syllabus.',
    );
  }

  return {
    examName: str(raw.examName, 'Untitled Exam'),
    organization: str(raw.organization),
    postName: str(raw.postName),
    advertisementNo: str(raw.advertisementNo),
    vacancies: {
      total: num(raw.vacancies?.total),
      raw: str(raw.vacancies?.raw),
      breakdown: arr(raw.vacancies?.breakdown).map((b) => ({
        category: str(b.category),
        count: num(b.count),
      })),
    },
    eligibility: {
      educational: arr(raw.eligibility?.educational).map((x) => str(x)).filter(Boolean),
      ageLimit: {
        min: raw.eligibility?.ageLimit?.min == null ? null : num(raw.eligibility.ageLimit.min),
        max: raw.eligibility?.ageLimit?.max == null ? null : num(raw.eligibility.ageLimit.max),
        relaxation: str(raw.eligibility?.ageLimit?.relaxation),
        asOnDate: str(raw.eligibility?.ageLimit?.asOnDate),
      },
      nationality: str(raw.eligibility?.nationality),
      other: arr(raw.eligibility?.other).map((x) => str(x)).filter(Boolean),
    },
    selectionProcess: arr(raw.selectionProcess).map((s) => ({
      stage: str(s.stage || s),
      description: str(s.description),
    })),
    examPattern: {
      mode: str(raw.examPattern?.mode, 'CBT'),
      totalQuestions: num(raw.examPattern?.totalQuestions),
      totalMarks: num(raw.examPattern?.totalMarks),
      durationMinutes: num(raw.examPattern?.durationMinutes),
      negativeMarking: num(raw.examPattern?.negativeMarking),
      sections: arr(raw.examPattern?.sections).map((s) => ({
        section: str(s.section),
        questions: num(s.questions),
        marks: num(s.marks),
        durationMinutes: num(s.durationMinutes),
        negativeMarking: num(s.negativeMarking),
      })),
    },
    syllabus,
    subjects: arr(raw.subjects).map((s) => str(s)).filter(Boolean).length
      ? arr(raw.subjects).map((s) => str(s)).filter(Boolean)
      : syllabus.map((s) => s.subject),
    importantDates: arr(raw.importantDates).map((d) => {
      const parsed = d.date ? new Date(d.date) : null;
      return {
        event: str(d.event),
        date: str(d.date),
        parsedDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      };
    }),
    applicationFee: arr(raw.applicationFee).map((f) => ({
      category: str(f.category),
      amount: str(f.amount),
    })),
    officialLinks: arr(raw.officialLinks).map((l) => str(l)).filter(Boolean),
    syllabusQuote: str(raw.syllabusQuote),
    aiConfidence: Math.min(100, Math.max(0, num(raw.aiConfidence))),
    aiNotes: str(raw.aiNotes),
  };
}

/** Above this, uploading once beats re-sending the bytes on every retry. */
const INLINE_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * Turns a scanned PDF into plain text, once.
 *
 * Analysis then runs on that text rather than on page images, which is cheaper,
 * faster and repeatable: a later re-analysis needs no vision call at all, and
 * the transcript can be read back to see exactly what the model saw.
 *
 * @returns {Promise<{ text: string, usage: object }>}
 */
async function transcribePdf({ buffer, mimeType = 'application/pdf', displayName = 'notification.pdf' }) {
  const large = buffer.length > INLINE_LIMIT_BYTES;
  let uploaded = null;
  const startedAt = Date.now();

  try {
    if (large) uploaded = await uploadFile({ buffer, mimeType, displayName });

    const attachment = uploaded
      ? { fileUris: [{ mimeType: uploaded.mimeType, uri: uploaded.uri }] }
      : { files: [{ mimeType, data: buffer.toString('base64') }] };

    const res = await generate({
      system: P.TUTOR_PROSE_SYSTEM,
      prompt: P.transcribePrompt(),
      ...attachment,
      temperature: 0.1, // transcription is not a creative task
      maxOutputTokens: 65536,
    });

    const text = (res.text || '').trim();
    logger.info(
      `Transcribed ${(buffer.length / 1048576).toFixed(1)}MB to ${text.length} chars in ${(
        (Date.now() - startedAt) / 1000
      ).toFixed(1)}s`,
      { tokens: res.usage?.totalTokens || 0 },
    );

    return { text, usage: res.usage };
  } finally {
    if (uploaded) await deleteFile(uploaded.name);
  }
}

/** Runs the two analysis passes concurrently over whatever source is available. */
async function runAnalysisPasses({ text, attachment }) {
  const [identity, syllabus] = await Promise.all([
    generateJson({
      system: P.BRAIN_SYSTEM,
      prompt: P.analyzeIdentityVisionPrompt(text),
      ...attachment,
      temperature: 0.2,
      maxOutputTokens: 16384,
    }),
    generateJson({
      system: P.BRAIN_SYSTEM,
      prompt: P.analyzeSyllabusVisionPrompt(text),
      ...attachment,
      temperature: 0.2,
      maxOutputTokens: 24576,
    }),
  ]);

  return {
    merged: {
      ...(identity.data || {}),
      ...(syllabus.data || {}),
      // Both halves may comment; keep whatever each one noticed.
      aiNotes: [identity.data?.aiNotes, syllabus.data?.aiNotes].filter(Boolean).join(' '),
      aiConfidence: identity.data?.aiConfidence ?? syllabus.data?.aiConfidence ?? 0,
    },
    tokens: (identity.usage?.totalTokens || 0) + (syllabus.usage?.totalTokens || 0),
  };
}

/**
 * Turns a notification into structured exam data.
 *
 * Pass `{ text }` when the PDF had a usable text layer. Pass `{ buffer }` for a
 * scan: it is transcribed to text first, and that text drives the analysis.
 * Direct vision remains as a fallback if transcription fails.
 *
 * @param {string|{ text?: string, buffer?: Buffer|null, mimeType?: string, displayName?: string, onTranscript?: Function }} input
 */
async function analyzeNotification(input) {
  const {
    text = '',
    buffer = null,
    mimeType = 'application/pdf',
    displayName = 'notification.pdf',
    onTranscript,
  } = typeof input === 'string' ? { text: input } : input || {};

  let sourceText = text;

  // A scan becomes text first, so everything after this is the cheap path.
  if (!sourceText && buffer?.length) {
    try {
      const transcript = await transcribePdf({ buffer, mimeType, displayName });
      if (transcript.text.length >= 200) {
        sourceText = transcript.text;
        await onTranscript?.(sourceText);
      } else {
        logger.warn(`Transcription returned only ${transcript.text.length} chars; falling back to vision`);
      }
    } catch (err) {
      logger.warn(`Transcription failed (${err.message}); falling back to direct vision analysis`);
    }
  }

  if (sourceText) {
    const startedAt = Date.now();
    const { merged, tokens } = await runAnalysisPasses({
      text: clampText(sourceText, 120000),
      attachment: {},
    });
    const exam = normaliseExam(merged);
    const all = exam.syllabus.flatMap((s) => s.topics);
    const read = all.filter((t) => t.fromNotification).length;
    logger.info(
      `Notification analysed from text in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
        `${read}/${all.length} topics read from the document` +
        `${exam.syllabusQuote ? '' : ' (no syllabus section was found)'}`,
      { tokens },
    );
    return exam;
  }

  if (!buffer?.length) {
    throw ApiError.unprocessable('There was no text and no file to analyse.');
  }

  // Fallback: transcription did not produce usable text, so read the pages
  // directly. Slower and dearer, but better than refusing the document.
  const large = buffer.length > INLINE_LIMIT_BYTES;
  let uploaded = null;
  const startedAt = Date.now();

  try {
    if (large) {
      uploaded = await uploadFile({ buffer, mimeType, displayName });
    }

    const attachment = uploaded
      ? { fileUris: [{ mimeType: uploaded.mimeType, uri: uploaded.uri }] }
      : { files: [{ mimeType, data: buffer.toString('base64') }] };

    const { merged, tokens } = await runAnalysisPasses({ text: '', attachment });

    logger.info(
      `Notification analysed via vision fallback (${large ? 'files api' : 'inline'}) in ${(
        (Date.now() - startedAt) / 1000
      ).toFixed(1)}s`,
      { tokens },
    );
    return normaliseExam(merged);
  } finally {
    // Do not leave the learner's document sitting on Google's servers.
    if (uploaded) await deleteFile(uploaded.name);
  }
}

/* ------------------------------------------------------------------ */
/* Lessons                                                             */
/* ------------------------------------------------------------------ */

/** Fields a model might hide prose behind when it wraps an answer in JSON. */
const PROSE_FIELDS = ['content', 'explanation', 'text', 'markdown', 'answer', 'body'];

/** Recovers the prose from a JSON envelope; returns the input unchanged if it is not one. */
function unwrapProse(raw) {
  const parsed = safeExtractJson(raw);
  if (!parsed || typeof parsed !== 'object') return raw;

  for (const field of PROSE_FIELDS) {
    if (typeof parsed[field] === 'string' && parsed[field].trim()) return parsed[field];
  }
  // Fall back to the longest string value in the object.
  const longest = Object.values(parsed)
    .filter((v) => typeof v === 'string')
    .sort((a, b) => b.length - a.length)[0];
  return longest || raw;
}

/**
 * Streams the teaching prose while the structured revision material is built
 * concurrently.
 *
 * @param {object} opts
 * @param {(chunk: string) => void} opts.onProse called for each streamed chunk
 * @returns {Promise<object>} the full lesson once both halves finish
 */
async function generateLessonStreamed({
  examName,
  subject,
  topic,
  subtopics,
  level,
  language,
  onProse,
}) {
  let explanation = '';

  const prose = (async () => {
    // A model that ignores the prose instruction and returns a JSON envelope
    // must not be streamed verbatim to the page. Buffer just enough of the
    // opening to tell prose from JSON, then either release the stream or hold
    // it back and unwrap at the end.
    let head = '';
    let mode = 'sniffing'; // -> 'streaming' | 'buffering'

    for await (const chunk of generateStream({
      system: P.TUTOR_PROSE_SYSTEM,
      prompt: P.lessonExplanationPrompt({ examName, subject, topic, subtopics, level, language }),
      temperature: 0.55,
      maxOutputTokens: 4096,
    })) {
      explanation += chunk;

      if (mode === 'sniffing') {
        head += chunk;
        const trimmed = head.trimStart();
        if (!trimmed) continue;

        if (trimmed.startsWith('{') || trimmed.startsWith('```json')) {
          mode = 'buffering';
          logger.warn('Lesson prose came back as JSON; unwrapping instead of streaming');
          continue;
        }
        if (head.trimStart().length >= 12) {
          mode = 'streaming';
          onProse?.(head);
        }
        continue;
      }

      if (mode === 'streaming') onProse?.(chunk);
    }

    // Nothing was released yet: either it was JSON, or the whole reply was tiny.
    if (mode === 'buffering') {
      explanation = unwrapProse(explanation);
      onProse?.(explanation);
    } else if (mode === 'sniffing') {
      onProse?.(head);
    }
  })();

  const structure = generateJson({
    system: P.BRAIN_SYSTEM,
    prompt: P.lessonStructurePrompt({ examName, subject, topic, subtopics, language }),
    temperature: 0.55,
    maxOutputTokens: 8192,
  });

  // The halves are independent: prose the learner has already read must not be
  // thrown away because the revision material failed, and vice versa.
  const [proseResult, structureResult] = await Promise.allSettled([prose, structure]);

  if (proseResult.status === 'rejected' && structureResult.status === 'rejected') {
    throw proseResult.reason;
  }

  if (structureResult.status === 'rejected') {
    logger.warn(`Lesson structure failed (${structureResult.reason?.message}); keeping the prose`);
    return {
      explanation,
      importantConcepts: [],
      shortNotes: [],
      tricks: [],
      examples: [],
      formulas: [],
      commonMistakes: [],
      estimatedMinutes: 20,
      structureFailed: true,
      structureError: structureResult.reason?.message || 'Could not generate the revision material.',
    };
  }

  const data = structureResult.value.data || {};

  return {
    explanation,
    importantConcepts: arr(data.importantConcepts).map((c) => ({
      concept: str(c.concept),
      detail: str(c.detail),
    })),
    shortNotes: arr(data.shortNotes).map((n) => str(n)).filter(Boolean),
    tricks: arr(data.tricks).map((t) => str(t)).filter(Boolean),
    examples: arr(data.examples).map((e) => ({
      problem: str(e.problem),
      solution: str(e.solution),
      takeaway: str(e.takeaway),
    })),
    formulas: arr(data.formulas).map((f) => ({
      name: str(f.name),
      expression: str(f.expression),
      usage: str(f.usage),
    })),
    commonMistakes: arr(data.commonMistakes).map((m) => str(m)).filter(Boolean),
    estimatedMinutes: num(data.estimatedMinutes, 25),
  };
}

async function generateLesson({ examName, subject, topic, subtopics, level, language }) {
  const { data } = await generateJson({
    system: P.BRAIN_SYSTEM,
    prompt: P.lessonPrompt({ examName, subject, topic, subtopics, level, language }),
    temperature: 0.55,
    maxOutputTokens: 8192,
  });

  return {
    explanation: str(data?.explanation),
    importantConcepts: arr(data?.importantConcepts).map((c) => ({
      concept: str(c.concept),
      detail: str(c.detail),
    })),
    shortNotes: arr(data?.shortNotes).map((n) => str(n)).filter(Boolean),
    tricks: arr(data?.tricks).map((t) => str(t)).filter(Boolean),
    examples: arr(data?.examples).map((e) => ({
      problem: str(e.problem),
      solution: str(e.solution),
      takeaway: str(e.takeaway),
    })),
    formulas: arr(data?.formulas).map((f) => ({
      name: str(f.name),
      expression: str(f.expression),
      usage: str(f.usage),
    })),
    commonMistakes: arr(data?.commonMistakes).map((m) => str(m)).filter(Boolean),
    estimatedMinutes: num(data?.estimatedMinutes, 25),
  };
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

const VALID_TYPES = ['mcq', 'reasoning', 'aptitude', 'gk', 'computer', 'english'];

/**
 * Below this self-reported confidence a question is discarded rather than served.
 * The user's standing requirement is that a smaller accurate batch beats a full
 * batch containing a plausible-sounding fabrication.
 */
const MIN_FACTUAL_CONFIDENCE = Number(process.env.MIN_FACTUAL_CONFIDENCE || 70);
const { shapePaper } = require('./previousPaper.helper.js');

/** Subjects where model memory goes stale fastest, so search grounding pays off. */
const VOLATILE_SUBJECTS = /current affairs|general knowledge|general awareness|gk/i;

async function generateQuestions({
  examName,
  organization,
  examPattern,
  plan,
  count,
  askedQuestions,
  language = 'en',
}) {
  const volatile = plan.some((p) => VOLATILE_SUBJECTS.test(`${p.subject} ${p.topic}`));
  const wantGrounding = String(process.env.GEMINI_GROUNDING) === 'true' && volatile;

  const request = (grounding) =>
    generateJson({
      system: P.BRAIN_SYSTEM,
      prompt: P.questionBatchPrompt({
        examName,
        organization,
        examPattern,
        plan,
        count,
        askedQuestions,
        language,
        grounded: grounding,
      }),
      // Grounded calls cannot also pin the response mime type, so the parser in
      // utils/jsonExtract.js does the work instead.
      grounding,
      // A grounded attempt has a cheap fallback waiting, so it must give up
      // fast. Letting it exhaust the whole model chain would cost the learner
      // most of a minute before we even start the answer we can actually serve.
      ...(grounding ? { retries: 1 } : {}),
      temperature: 0.85, // higher: variety matters more than determinism here
      maxOutputTokens: 32768,
    });

  let result;
  let needsGrounding = wantGrounding;
  let sources = [];

  if (wantGrounding) {
    try {
      result = await request(true);
      sources = result.groundingSources || [];
    } catch (err) {
      // Search grounding draws on its own, smaller quota. Losing it must degrade
      // to model memory, not cost the learner their questions.
      logger.warn(`Grounded generation failed (${err.message}); retrying without search`);
      needsGrounding = false;
    }
  }

  if (!result) result = await request(false);
  const { data } = result;

  const parsed = arr(data?.questions)
    .map((q) => {
      const options = arr(q.options).map((o) => str(o)).filter(Boolean);
      let answerIndex = num(q.answerIndex, -1);

      // Some responses name the answer instead of indexing it.
      if (answerIndex < 0 || answerIndex >= options.length) {
        answerIndex = options.findIndex((o) => o.toLowerCase() === str(q.answer).toLowerCase());
      }
      if (answerIndex < 0 || options.length < 2) return null;

      return {
        question: str(q.question),
        options,
        answerIndex,
        answer: options[answerIndex],
        explanation: str(q.explanation),
        difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
        topic: str(q.topic),
        subject: str(q.subject),
        type: VALID_TYPES.includes(q.type) ? q.type : 'mcq',
        sourceBasis: str(q.sourceBasis),
        factualConfidence: Math.min(100, Math.max(0, num(q.factualConfidence, 100))),
        grounded: needsGrounding,
        groundingSources: sources.slice(0, 5),
        language,
      };
    })
    .filter((q) => q && q.question && q.topic);

  const trusted = parsed.filter((q) => q.factualConfidence >= MIN_FACTUAL_CONFIDENCE);

  if (trusted.length < parsed.length) {
    logger.warn(
      `Dropped ${parsed.length - trusted.length} question(s) below ${MIN_FACTUAL_CONFIDENCE}% factual confidence`,
    );
  }

  return trusted;
}

/**
 * Finds where a past paper is published, and returns the pages it consulted.
 *
 * This exists for its grounding metadata, not its text. Generating a paper is
 * one long call whose sources only arrive with the finished answer, so there
 * is nothing to show while the learner waits — and a progress display that
 * invents sites would be worse than none. A short grounded lookup answers in
 * a couple of seconds with real pages, which is what makes it possible to show
 * the research as it happens rather than assert afterwards that it happened.
 *
 * Best-effort by design: it is a nicety on top of the paper, so a failure here
 * returns nothing and the paper is still generated.
 *
 * @returns {Promise<{ sources: string[], note: string }>}
 */
async function findPaperSources({ examName, organization, year, paperName = '' }) {
  if (String(process.env.GEMINI_GROUNDING) !== 'true') return { sources: [], note: '' };

  try {
    const res = await generate({
      system: P.TUTOR_PROSE_SYSTEM,
      prompt: P.findPaperSourcesPrompt({ examName, organization, year, paperName }),
      grounding: true,
      retries: 1,
      temperature: 0.2,
      // Small: the prose is a by-product, and a long answer only delays the
      // sources this call exists to produce.
      maxOutputTokens: 256,
    });

    return { sources: res.groundingSources || [], note: (res.text || '').trim() };
  } catch (err) {
    logger.warn(`Could not look up sources for the ${year} paper: ${err.message}`);
    return { sources: [], note: '' };
  }
}

/**
 * One previous-year paper, for the revision tab.
 *
 * Grounding is requested unconditionally here, unlike practice questions where
 * it is reserved for volatile topics. A past paper is a real document that
 * exists on the public web; asking the model to recall one from memory when it
 * could look it up is how a plausible fabrication gets made. Grounding may
 * still fail — it draws on its own smaller quota — and the fall back to memory
 * is honest rather than silent, because the paper records whether search
 * actually backed it and the UI shows that to the learner.
 */
async function generatePreviousPaper({
  examName,
  organization,
  examPattern,
  syllabus = [],
  year,
  paperName = '',
  count = 25,
  language = 'en',
}) {
  const request = (grounding) =>
    generateJson({
      system: P.BRAIN_SYSTEM,
      prompt: P.previousPaperPrompt({
        examName,
        organization,
        examPattern,
        syllabus,
        year,
        paperName,
        count,
        language,
        grounded: grounding,
      }),
      grounding,
      ...(grounding ? { retries: 1 } : {}),
      // Low: a past paper is a recall task, not a creative one. Variety here
      // would mean drifting further from whatever the real paper asked.
      temperature: 0.3,
      maxOutputTokens: 32768,
    });

  let result;
  let grounded = String(process.env.GEMINI_GROUNDING) === 'true';
  let sources = [];

  if (grounded) {
    try {
      result = await request(true);
      sources = result.groundingSources || [];
    } catch (err) {
      logger.warn(`Grounded past-paper generation failed (${err.message}); falling back to memory`);
      grounded = false;
    }
  }

  if (!result) result = await request(false);

  const { questions, sourceBasis, dropped } = shapePaper(result.data, { year });

  return {
    year: Number(result.data?.year) || year,
    paperName: str(result.data?.paperName) || paperName,
    questions,
    sourceBasis,
    dropped,
    grounded,
    groundingSources: sources.slice(0, 5),
    language,
  };
}

/* ------------------------------------------------------------------ */
/* Analysis, roadmap, blueprint, readiness                             */
/* ------------------------------------------------------------------ */

async function analyzePerformance(payload, language = 'en') {
  const { data } = await generateJson({
    system: P.BRAIN_SYSTEM,
    prompt: P.performanceAnalysisPrompt(payload, language),
    temperature: 0.35,
    maxOutputTokens: 4096,
  });

  return {
    summary: str(data?.summary),
    strongTopics: arr(data?.strongTopics).map((t) => str(t)).filter(Boolean),
    weakTopics: arr(data?.weakTopics).map((t) => str(t)).filter(Boolean),
    confidenceLevel: str(data?.confidenceLevel, 'building'),
    accuracyBand: str(data?.accuracyBand),
    timeManagement: str(data?.timeManagement),
    nextSteps: arr(data?.nextSteps).map((s) => str(s)).filter(Boolean),
    predictedReadiness: Math.min(100, Math.max(0, num(data?.predictedReadiness))),
  };
}

async function generateRoadmap({ examName, syllabus, days, dailyMinutes, weakTopics }) {
  const { data } = await generateJson({
    system: P.BRAIN_SYSTEM,
    prompt: P.roadmapPrompt({ examName, syllabus, days, dailyMinutes, weakTopics }),
    temperature: 0.4,
    maxOutputTokens: 32768,
  });

  const rawDays = arr(data?.days);
  if (!rawDays.length) throw ApiError.upstream('The AI returned an empty roadmap.');

  return {
    strategy: str(data?.strategy),
    phases: arr(data?.phases).map((p) => ({
      name: str(p.name),
      fromDay: num(p.fromDay, 1),
      toDay: num(p.toDay, 1),
      goal: str(p.goal),
    })),
    days: rawDays
      .map((d) => ({
        day: num(d.day),
        phase: str(d.phase),
        focusSubject: str(d.focusSubject),
        studyTopics: arr(d.studyTopics).map((t) => ({
          subject: str(t.subject),
          topic: str(t.topic),
          minutes: num(t.minutes, 45),
        })),
        revisionTopics: arr(d.revisionTopics).map((t) => ({
          subject: str(t.subject),
          topic: str(t.topic || t),
        })),
        quizCount: num(d.quizCount, 20),
        mockTest: Boolean(d.mockTest),
        targetMinutes: num(d.targetMinutes, dailyMinutes),
        notes: str(d.notes),
      }))
      .filter((d) => d.day > 0)
      .sort((a, b) => a.day - b.day),
  };
}

async function generateMockBlueprint({ examName, examPattern, syllabus }) {
  const { data } = await generateJson({
    system: P.BRAIN_SYSTEM,
    prompt: P.mockBlueprintPrompt({ examName, examPattern, syllabus }),
    temperature: 0.3,
    maxOutputTokens: 8192,
  });

  return {
    title: str(data?.title, `${examName} — Full Mock Test`),
    totalQuestions: num(data?.totalQuestions, 100),
    totalMarks: num(data?.totalMarks, 100),
    durationMinutes: num(data?.durationMinutes, 90),
    negativeMarking: num(data?.negativeMarking),
    sections: arr(data?.sections).map((s) => ({
      section: str(s.section),
      subject: str(s.subject || s.section),
      questions: num(s.questions),
      marks: num(s.marks),
      topicPlan: arr(s.topicPlan).map((t) => ({
        topic: str(t.topic),
        count: num(t.count, 1),
        difficulty: ['easy', 'medium', 'hard'].includes(t.difficulty) ? t.difficulty : 'medium',
      })),
    })),
  };
}

async function predictReadiness(snapshot, language = 'en') {
  const { data } = await generateJson({
    system: P.BRAIN_SYSTEM,
    prompt: P.readinessPrompt(snapshot, language),
    temperature: 0.3,
    maxOutputTokens: 6144,
  });

  return {
    readinessPercent: Math.min(100, Math.max(0, num(data?.readinessPercent))),
    verdict: str(data?.verdict),
    topicMastery: arr(data?.topicMastery).map((t) => ({
      topic: str(t.topic),
      subject: str(t.subject),
      mastery: num(t.mastery),
      trend: ['improving', 'flat', 'declining'].includes(t.trend) ? t.trend : 'flat',
    })),
    improvementAreas: arr(data?.improvementAreas).map((a) => ({
      area: str(a.area),
      why: str(a.why),
      action: str(a.action),
    })),
    projectedReadinessIn30Days: Math.min(100, Math.max(0, num(data?.projectedReadinessIn30Days))),
    riskFactors: arr(data?.riskFactors).map((r) => str(r)).filter(Boolean),
    strengths: arr(data?.strengths).map((s) => str(s)).filter(Boolean),
  };
}

/**
 * Streaming mentor reply. Yields markdown chunks as they are produced.
 * Suggestions and actions are derived by the caller, not requested from the model.
 */
async function* askMentorStream({ context, question, history = [], language = 'en' }) {
  yield* generateStream({
    system: P.MENTOR_STREAM_SYSTEM,
    prompt: P.mentorContextPrompt({ context, question, language }),
    history,
    temperature: 0.7,
    maxOutputTokens: 2048,
  });
}

async function askMentor({ context, question, history = [], language = 'en' }) {
  const { data } = await generateJson({
    system: P.MENTOR_SYSTEM,
    prompt: P.mentorContextPrompt({ context, question, language }),
    history,
    temperature: 0.7,
    maxOutputTokens: 4096,
  });

  return {
    reply: str(data?.reply, 'I could not generate a reply just now. Please try again.'),
    suggestions: arr(data?.suggestions).map((s) => str(s)).filter(Boolean),
    actions: arr(data?.actions).map((a) => ({
      label: str(a.label),
      type: str(a.type, 'study'),
      subject: str(a.subject),
      topic: str(a.topic),
    })),
    focusTopics: arr(data?.focusTopics).map((t) => str(t)).filter(Boolean),
  };
}

module.exports = {
  analyzeNotification,
  transcribePdf,
  generateLessonStreamed,
  askMentorStream,
  generateLesson,
  generateQuestions,
  generatePreviousPaper,
  findPaperSources,
  analyzePerformance,
  generateRoadmap,
  generateMockBlueprint,
  predictReadiness,
  askMentor,
};
Object.assign(module.exports, { analyzeNotification, transcribePdf, unwrapProse, generateLessonStreamed, generateLesson, generateQuestions, generatePreviousPaper, findPaperSources, analyzePerformance, generateRoadmap, generateMockBlueprint, predictReadiness, askMentorStream, askMentor });
