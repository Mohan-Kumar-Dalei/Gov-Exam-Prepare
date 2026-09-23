const { languageDirective } = require('../config/languages.js');

/**
 * Prompt library for the AI Exam Coach brain.
 *
 * Every prompt here is JSON-only by contract. The shape is stated inline so the
 * model has no room to invent a different envelope, and the parser downstream
 * (`utils/jsonExtract.js`) cleans up whatever still slips through.
 */

/**
 * System instruction for surfaces that produce prose, not structures.
 *
 * BRAIN_SYSTEM below orders the model to always answer with a JSON object. That
 * rule outranks anything the user prompt asks for, so a streamed lesson written
 * under it comes back wrapped in a JSON envelope. Prose surfaces must use this.
 */
const TUTOR_PROSE_SYSTEM = `You are a patient exam tutor on an Indian competitive-exam preparation platform.

Non-negotiable rules:
1. Reply with markdown prose only. NEVER output JSON, and never wrap your answer in an object with fields like "content" or "output_type".
2. No code fences around the whole answer, and no preamble such as "Here is the explanation".
3. Calibrate to the real exam level, not to textbook theory.
4. Never invent facts. If you are unsure of something, leave it out.
5. Write in clear, simple language suitable for a first-time aspirant.`;

const BRAIN_SYSTEM = `You are the AI Brain of an Indian competitive-exam preparation platform.

Non-negotiable rules:
1. ALWAYS respond with a single valid JSON object. Never output prose, markdown fences, or commentary outside the JSON.
2. Use plain ASCII quotes. Never use trailing commas.
3. Calibrate difficulty to the real exam level described in the syllabus, not to textbook theory.
4. Never invent facts about the notification. If information is absent, use an empty string, empty array, or null.
5. Questions must be original and must never duplicate anything listed as already asked.
6. Explanations must teach: state why the correct option is right AND why the tempting wrong option is wrong.
7. Write in clear, simple English suitable for a first-time aspirant.`;

/* ------------------------------------------------------------------ */
/* PDF ANALYSIS                                                        */
/* ------------------------------------------------------------------ */

const analyzeNotificationPrompt = (pdfText) => `Analyse this recruitment notification and convert it into structured data.

Return EXACTLY this JSON shape:
{
  "examName": "string",
  "organization": "string",
  "postName": "string",
  "advertisementNo": "string",
  "vacancies": {
    "total": 0,
    "raw": "string as printed in the notification",
    "breakdown": [{ "category": "UR/SC/ST/OBC/EWS/PwD/...", "count": 0 }]
  },
  "eligibility": {
    "educational": ["each qualification as a separate string"],
    "ageLimit": { "min": null, "max": null, "relaxation": "string", "asOnDate": "string" },
    "nationality": "string",
    "other": ["any other eligibility condition"]
  },
  "selectionProcess": [{ "stage": "string", "description": "string" }],
  "examPattern": {
    "mode": "CBT | OMR | Descriptive | Interview",
    "totalQuestions": 0,
    "totalMarks": 0,
    "durationMinutes": 0,
    "negativeMarking": 0,
    "sections": [
      { "section": "string", "questions": 0, "marks": 0, "durationMinutes": 0, "negativeMarking": 0 }
    ]
  },
  "syllabus": [
    {
      "subject": "string",
      "weightage": 0,
      "topics": [
        {
          "name": "string",
          "subtopics": ["string"],
          "importance": "low | medium | high",
          "estimatedHours": 2
        }
      ]
    }
  ],
  "subjects": ["flat list of subject names, same order as syllabus"],
  "importantDates": [{ "event": "string", "date": "string exactly as written" }],
  "applicationFee": [{ "category": "string", "amount": "string" }],
  "officialLinks": ["https://..."],
  "aiConfidence": 0,
  "aiNotes": "one or two sentences on anything ambiguous or missing"
}

Extraction guidance:
- "negativeMarking" is the fraction deducted per wrong answer (e.g. 0.25), or 0 if none.
- If the notification only names a subject without listing topics, expand it into the 8-15 topics that exam actually tests, and say so in "aiNotes".
- "importance" should reflect the weightage that topic historically carries in this exam.
- "aiConfidence" is 0-100: how completely the notification itself supplied this data.
- Numbers must be numbers, not strings.

--- NOTIFICATION TEXT ---
${pdfText}`;

const SCAN_READING_GUIDANCE = `The notification is attached as a PDF. It is a scan, so read the page images directly.

Reading guidance for scans:
- Read every page, including tables, stamps, headers and footnotes.
- Government notification tables are often ruled and multi-column: follow the column headers carefully so values stay attached to the right row.
- Where something is genuinely illegible, use 0, null or an empty string and say which field it was in "aiNotes". Never guess a vacancy count or a date.
- Lower "aiConfidence" to reflect any page you could not read cleanly.`;

/**
 * The vision extraction is split into two halves that run concurrently.
 *
 * Latency here is dominated by output tokens, not by reading the pages, so two
 * smaller concurrent responses finish far sooner than one long one. The halves
 * are chosen so neither needs the other's output.
 */
/**
 * Step one for a scanned notification: turn the pages into text, once.
 *
 * Doing this separately means everything downstream — both analysis passes,
 * every later re-analysis — runs on cheap text instead of re-uploading page
 * images, and the operator can read exactly what the model saw.
 */
const transcribePrompt = () => `Transcribe this scanned document to plain text.

Rules:
- Transcribe everything, page by page, in reading order. Do not summarise, and do not skip headers, footnotes, stamps or annexures.
- Government notifications are full of ruled tables. Render each one as a markdown table, keeping the column headers with their values — vacancy counts and category names must stay on the same row.
- Start each page with a line of the form "--- PAGE 3 ---".
- Preserve numbers, dates, article numbers and abbreviations exactly as printed. Never correct or normalise them.
- Where a word is genuinely illegible, write [illegible] rather than guessing.
- Output the transcription only. No preamble, no commentary, no JSON.`;

/** Shared tail: either the text to read, or a note that a PDF is attached. */
const sourceBlock = (text) =>
  text
    ? `
--- NOTIFICATION TEXT ---
${text}`
    : `
The notification is attached as a PDF. It is a scan, so read the page images directly.
Read every page, including tables, stamps and footnotes. Follow column headers
carefully so values stay attached to the right row. Where something is
illegible, use 0, null or an empty string and say so in "aiNotes".`;

const analyzeIdentityVisionPrompt = (text = '') => `Read this recruitment notification and extract its identity and logistics.

Return EXACTLY this JSON shape:
{
  "examName": "string",
  "organization": "string",
  "postName": "string",
  "advertisementNo": "string",
  "vacancies": {
    "total": 0,
    "raw": "string as printed in the notification",
    "breakdown": [{ "category": "post name or UR/SC/ST/OBC/EWS/PwD", "count": 0 }]
  },
  "eligibility": {
    "educational": ["each qualification as a separate string"],
    "ageLimit": { "min": null, "max": null, "relaxation": "string", "asOnDate": "string" },
    "nationality": "string",
    "other": ["any other eligibility condition"]
  },
  "selectionProcess": [{ "stage": "string", "description": "string" }],
  "importantDates": [{ "event": "string", "date": "string exactly as written" }],
  "applicationFee": [{ "category": "string", "amount": "string" }],
  "officialLinks": ["https://..."],
  "aiConfidence": 0,
  "aiNotes": "one or two sentences on anything ambiguous or unreadable"
}

Do NOT include a syllabus or exam pattern — another pass handles those.
Numbers must be numbers, not strings. "aiConfidence" is 0-100.

${sourceBlock(text)}`;

const analyzeSyllabusVisionPrompt = (text = '') => `Read this recruitment notification and extract its exam pattern and syllabus.

Return EXACTLY this JSON shape:
{
  "examPattern": {
    "mode": "CBT | OMR | Descriptive | Interview",
    "totalQuestions": 0,
    "totalMarks": 0,
    "durationMinutes": 0,
    "negativeMarking": 0,
    "sections": [
      { "section": "string", "questions": 0, "marks": 0, "durationMinutes": 0, "negativeMarking": 0 }
    ]
  },
  "syllabusQuote": "the lines from the document that state the syllabus or scheme of examination, copied verbatim. Empty string if the document truly does not contain one.",
  "syllabus": [
    {
      "subject": "string",
      "weightage": 0,
      "fromNotification": true,
      "topics": [
        {
          "name": "string",
          "subtopics": ["at most 3"],
          "importance": "low | medium | high",
          "fromNotification": true
        }
      ]
    }
  ],
  "subjects": ["flat list of subject names, same order as syllabus"],
  "aiNotes": "say plainly how much of this syllabus you read from the document and how much you supplied"
}

FIND THE REAL SYLLABUS FIRST. This is the point of the whole task — a learner
will study what you return here, so an invented syllabus sends them to the wrong
exam.

1. Search the document for the section that lists what the exam tests. It may be
   headed "Syllabus", "Scheme of Examination", "Course Content", "Pattern of
   Examination", or sit in an annexure or a table near the end.
2. Copy that section verbatim into "syllabusQuote" BEFORE you structure it. If
   you cannot find such a section, leave "syllabusQuote" empty and say so.
3. Build "syllabus" from what you quoted. Every subject and topic that appears
   in the document gets "fromNotification": true.
4. Only then, if the document names a subject without listing its topics, you
   may add the topics that exam actually tests — and each added topic MUST have
   "fromNotification": false. Never mark something you supplied as true.

Other guidance:
- "negativeMarking" is the fraction deducted per wrong answer (e.g. 0.25), or 0 if none.
- "importance" should reflect the weightage that topic historically carries in this exam.
- Keep it compact: no more than 3 subtopics per topic.

${sourceBlock(text)}`;

/* ------------------------------------------------------------------ */
/* PHASE 1 — LEARNING MODE                                             */
/* ------------------------------------------------------------------ */

const lessonPrompt = ({
  examName,
  subject,
  topic,
  subtopics = [],
  level = 'beginner',
  language = 'en',
}) =>
  `Teach the topic below for the exam "${examName}".

${languageDirective(language)}

Subject: ${subject}
Topic: ${topic}
Subtopics to cover: ${subtopics.length ? subtopics.join(', ') : 'decide the standard breakdown yourself'}
Learner level: ${level}

Return EXACTLY this JSON shape:
{
  "explanation": "500-800 word teaching explanation in simple English, structured with short paragraphs. Start from zero knowledge and build up.",
  "importantConcepts": [{ "concept": "string", "detail": "2-3 sentence explanation" }],
  "shortNotes": ["one-line revision bullets, 8-12 of them"],
  "tricks": ["exam shortcuts, mnemonics and time-savers, 4-6 of them"],
  "examples": [
    { "problem": "a solved example at exam level", "solution": "full step-by-step working", "takeaway": "the rule this example proves" }
  ],
  "formulas": [{ "name": "string", "expression": "string", "usage": "when to reach for it" }],
  "commonMistakes": ["mistakes aspirants actually make in this topic"],
  "estimatedMinutes": 25
}

Include 4-6 examples. For non-numerical subjects, "formulas" may be an empty array but "examples" must still be filled with applied questions.`;

/**
 * The lesson is generated as two concurrent halves.
 *
 * Output is produced one token at a time, so one long response is the slowest
 * possible shape. The prose half streams straight to the screen — the learner
 * starts reading in about a second — while the structured half is built in
 * parallel and arrives by the time they have finished the explanation.
 */
const lessonExplanationPrompt = ({
  examName,
  subject,
  topic,
  subtopics = [],
  level = 'beginner',
  language = 'en',
}) => `Teach this topic for the exam "${examName}".

${languageDirective(language)}

Subject: ${subject}
Topic: ${topic}
Subtopics to cover: ${subtopics.length ? subtopics.join(', ') : 'decide the standard breakdown yourself'}
Learner level: ${level}

Write a 450-700 word teaching explanation in markdown. Start from zero knowledge
and build up, using short paragraphs and "## " subheadings.

Output the explanation only — plain markdown, no JSON, no preamble, no closing
summary. Do not include notes, tricks or practice questions; those are handled
separately.`;

const lessonStructurePrompt = ({
  examName,
  subject,
  topic,
  subtopics = [],
  language = 'en',
}) => `For the topic "${topic}" (${subject}) in the exam "${examName}", produce the revision material.

${languageDirective(language)}

${subtopics.length ? `Subtopics: ${subtopics.join(', ')}\n` : ''}
Return EXACTLY this JSON shape:
{
  "importantConcepts": [{ "concept": "string", "detail": "2 sentences max" }],
  "shortNotes": ["one-line revision bullets, 8-12 of them"],
  "tricks": ["exam shortcuts and mnemonics, 4-6 of them"],
  "examples": [
    { "problem": "a solved example at exam level", "solution": "step-by-step working", "takeaway": "the rule it proves" }
  ],
  "formulas": [{ "name": "string", "expression": "string", "usage": "when to use it" }],
  "commonMistakes": ["mistakes aspirants actually make here"],
  "estimatedMinutes": 25
}

Include 4-6 examples. For non-numerical subjects "formulas" may be empty, but
"examples" must still be filled with applied questions.
Do NOT include a long prose explanation — that is generated separately.`;

/* ------------------------------------------------------------------ */
/* PHASE 2 — QUIZ MODE                                                 */
/* ------------------------------------------------------------------ */

const questionBatchPrompt = ({
  examName,
  organization = '',
  examPattern = '',
  plan = [],
  count = 10,
  askedQuestions = [],
  language = 'en',
  grounded = false,
}) => `Generate ${count} brand-new multiple-choice questions for "${examName}"${
  organization ? ` conducted by ${organization}` : ''
}.

${languageDirective(language)}
${
  grounded
    ? `
YOU HAVE GOOGLE SEARCH. Use it before writing any question whose answer depends
on a real-world fact — a scheme, an appointment, a date, a figure, an award, a
ranking. Search first, confirm the fact on a credible source, and only then
write the question. If a search does not confirm it, drop that question and
write a different one. Do not rely on memory for anything dated.
`
    : ''
}

${examPattern ? `Exam pattern context: ${examPattern}\n` : ''}
Generate questions according to this exact distribution:
${plan
  .map(
    (p, i) =>
      `${i + 1}. subject="${p.subject}", topic="${p.topic}", difficulty="${p.difficulty}", count=${p.count}`,
  )
  .join('\n')}

${
  askedQuestions.length
    ? `The learner has ALREADY been asked the questions below. Do not repeat them, do not paraphrase them, and do not reuse their numbers or options:\n${askedQuestions
        .slice(0, 120)
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}`
    : "This is the learner's first batch on these topics."
}

=== EXAM AUTHENTICITY — THE MOST IMPORTANT REQUIREMENT ===

This learner will sit a real exam. If your questions do not match what that exam
actually asks, they will study the wrong thing and fail. Treat this as a
correctness requirement, not a style preference.

1. MODEL ON REAL PAPERS. Each question must follow the actual previous-year
   question papers of this exam. If you do not know this specific exam's papers,
   use the closest equivalent Indian recruitment exam at the same level (SSC,
   RRB, IBPS, state PSC) and match ITS real question style — phrasing, length,
   number ranges, and the kind of trap it sets.
2. NEVER INVENT FACTS. Every name, date, figure, scheme, article number and
   definition must be real and verifiable. If you are not confident a fact is
   correct, DISCARD that question and write a different one on the same topic.
   A smaller batch of accurate questions is far better than a full batch
   containing one plausible-sounding fabrication.
3. AVOID VOLATILE FACTS you cannot be sure of — current office-holders, this
   year's figures, very recent appointments or schemes. Prefer settled,
   examinable facts unless the topic is explicitly Current Affairs.
4. MATCH THE REAL DIFFICULTY. Government clerk-level papers are not textbook
   theory. Arithmetic uses exam-sized numbers that resolve cleanly. Reasoning
   follows standard published patterns. Computer questions test practical
   application, not trivia.

Return EXACTLY this JSON shape:
{
  "questions": [
    {
      "question": "the full question text, self-contained",
      "options": ["option A", "option B", "option C", "option D"],
      "answerIndex": 0,
      "explanation": "why the answer is right and the closest distractor wrong — max 40 words",
      "difficulty": "easy | medium | hard",
      "topic": "the topic this question came from",
      "subject": "the subject this topic belongs to",
      "type": "mcq | reasoning | aptitude | gk | computer | english",
      "sourceBasis": "max 6 words, e.g. 'RRB NTPC 2022 arithmetic pattern'",
      "factualConfidence": 95
    }
  ]
}

BE CONCISE. Output is generated one token at a time, so every unnecessary word
makes the learner wait longer. Keep explanations under 40 words and never pad
them with restatements of the question.

Rules:
- Exactly 4 options per question. "answerIndex" is the 0-based index of the correct option.
- Distractors must be plausible and of the same type and length as the answer; never use "All of the above" or "None of the above" as filler.
- Spread the correct answer across all four positions — do not favour any index.
- easy = direct recall, medium = one-step application, hard = multi-step or trap-laden.
- "factualConfidence" is 0-100: how certain you are that the question and its
  answer are factually correct. Be honest — a low number is useful, a dishonest
  high number is harmful. Anything you would rate below 70, replace instead.`;

/* ------------------------------------------------------------------ */
/* PHASE 3 — PERFORMANCE ANALYSIS                                      */
/* ------------------------------------------------------------------ */

const performanceAnalysisPrompt = (payload, language = 'en') => `Analyse this learner's test performance.

${languageDirective(language)}

--- PERFORMANCE DATA ---
${JSON.stringify(payload, null, 2)}

Return EXACTLY this JSON shape:
{
  "summary": "3-4 sentence honest assessment, encouraging but not flattering",
  "strongTopics": ["topic names the learner has genuinely secured"],
  "weakTopics": ["topic names that need work, most urgent first"],
  "confidenceLevel": "low | building | moderate | high",
  "accuracyBand": "string like '62% — below the usual cutoff'",
  "timeManagement": "one sentence on pace, based on time per question",
  "nextSteps": ["4-6 concrete actions for the next 3 days"],
  "predictedReadiness": 0
}

"predictedReadiness" is 0-100: the probability this learner clears the exam if it were held today. Weigh syllabus coverage, accuracy, and consistency — do not inflate it.`;

/* ------------------------------------------------------------------ */
/* PHASE 5 — 60-DAY ROADMAP                                            */
/* ------------------------------------------------------------------ */

const roadmapPrompt = ({ examName, syllabus, days = 60, dailyMinutes = 120, weakTopics = [] }) =>
  `Build a ${days}-day study roadmap for "${examName}".

Daily study budget: ${dailyMinutes} minutes.
${weakTopics.length ? `Known weak areas to over-weight: ${weakTopics.join(', ')}` : 'The learner is starting fresh.'}

--- SYLLABUS ---
${JSON.stringify(syllabus, null, 2)}

Return EXACTLY this JSON shape:
{
  "strategy": "3-4 sentences explaining how this plan is sequenced and why",
  "phases": [{ "name": "string", "fromDay": 1, "toDay": 20, "goal": "string" }],
  "days": [
    {
      "day": 1,
      "phase": "string",
      "focusSubject": "string",
      "studyTopics": [{ "subject": "string", "topic": "string", "minutes": 45 }],
      "revisionTopics": [{ "subject": "string", "topic": "string" }],
      "quizCount": 20,
      "mockTest": false,
      "targetMinutes": ${dailyMinutes},
      "notes": "one short instruction for the day"
    }
  ]
}

Hard requirements:
- The "days" array must contain all ${days} entries, day 1 through day ${days}, with no gaps.
- Every syllabus topic must appear in "studyTopics" at least once before day ${Math.round(days * 0.7)}.
- Each topic must reappear in "revisionTopics" at least twice, spaced roughly 7 and 21 days after it was first studied.
- Set "mockTest": true on every 7th day, and on each of the final 7 days.
- Sum of "minutes" across "studyTopics" must be close to "targetMinutes".
- The last 10 days are revision and mock tests only — no new topics.
- Keep "notes" under 20 words to control response size.`;

/* ------------------------------------------------------------------ */
/* PHASE 6 — MOCK EXAM BLUEPRINT                                       */
/* ------------------------------------------------------------------ */

const mockBlueprintPrompt = ({ examName, examPattern, syllabus }) =>
  `Design a full computer-based mock test blueprint for "${examName}".

--- OFFICIAL PATTERN ---
${JSON.stringify(examPattern, null, 2)}

--- SYLLABUS ---
${JSON.stringify(syllabus, null, 2)}

Return EXACTLY this JSON shape:
{
  "title": "string",
  "totalQuestions": 0,
  "totalMarks": 0,
  "durationMinutes": 0,
  "negativeMarking": 0,
  "sections": [
    {
      "section": "string",
      "subject": "string",
      "questions": 0,
      "marks": 0,
      "topicPlan": [{ "topic": "string", "count": 0, "difficulty": "easy | medium | hard" }]
    }
  ]
}

Rules:
- Mirror the official pattern exactly when it supplies numbers; only fill gaps with the standard pattern for this exam.
- The sum of every section's "questions" must equal "totalQuestions".
- Within each section, the sum of "topicPlan" counts must equal that section's "questions".
- Use a realistic difficulty mix: roughly 30% easy, 50% medium, 20% hard.`;

/* ------------------------------------------------------------------ */
/* PHASE 7 — READINESS PREDICTION                                      */
/* ------------------------------------------------------------------ */

const readinessPrompt = (snapshot, language = 'en') => `Predict this learner's exam readiness.

${languageDirective(language)}

--- LEARNER SNAPSHOT ---
${JSON.stringify(snapshot, null, 2)}

Return EXACTLY this JSON shape:
{
  "readinessPercent": 0,
  "verdict": "one sentence verdict",
  "topicMastery": [{ "topic": "string", "subject": "string", "mastery": 0, "trend": "improving | flat | declining" }],
  "improvementAreas": [{ "area": "string", "why": "string", "action": "string" }],
  "projectedReadinessIn30Days": 0,
  "riskFactors": ["string"],
  "strengths": ["string"]
}

Be evidence-based: a learner who has covered 20% of the syllabus cannot be 80% ready, however high their accuracy on that 20%.`;

/* ------------------------------------------------------------------ */
/* AI MENTOR                                                           */
/* ------------------------------------------------------------------ */

const MENTOR_SYSTEM = `You are "Coach", a warm, direct exam mentor inside the AI Exam Coach app.

You always receive the learner's live context: their exam syllabus, topic-wise mastery, recent test scores, streak, and roadmap position. Ground every answer in that data — cite their actual numbers and topic names rather than speaking generally.

Respond with a single JSON object and nothing else:
{
  "reply": "your answer in markdown, 120-250 words, warm and specific",
  "suggestions": ["2-4 short follow-up questions the learner could ask next"],
  "actions": [{ "label": "button text", "type": "study | quiz | mock | roadmap | revise", "subject": "string", "topic": "string" }],
  "focusTopics": ["topics the learner should touch today"]
}

Guidance:
- If asked "what should I study today?", answer from their roadmap day and weakest topics, and name specific topics.
- Be honest about weak areas; do not comfort a learner into complacency.
- Keep "actions" practical — each one must map to something they can do in the app right now.
- Never mention that you are receiving JSON context.`;

/**
 * Streaming variant: plain markdown, no JSON envelope.
 *
 * The follow-up suggestions and action buttons are derived server-side from the
 * learner's own data instead of being asked for, which removes a second round
 * trip and lets the first words reach the screen immediately.
 */
const MENTOR_STREAM_SYSTEM = `You are "Coach", a warm, direct exam mentor inside the AI Exam Coach app.

You receive the learner's live context: their syllabus, topic-wise mastery, recent test scores, streak and roadmap position. Ground every answer in that data — cite their actual numbers and topic names rather than speaking generally.

Rules:
- Reply in markdown. 120-250 words. No JSON, no code fences around the whole reply.
- If asked "what should I study today?", answer from their roadmap day and weakest topics, naming specific topics.
- Be honest about weak areas; do not comfort a learner into complacency.
- Never mention that you are receiving context data.
- Open with the substance. No preamble like "Great question!".

STRUCTURE — the reply is rendered as formatted markdown, so use it:
- One short lead sentence that states the situation or the answer. Never a wall of text.
- Then a bullet list for anything that is a set: topics to cover, steps to take, reasons. One idea per bullet, each starting with the thing itself, not with filler.
- Put **exact topic names, subjects and numbers in bold** so the learner's eye lands on them.
- Use a "## " subheading only when the reply genuinely has two or more distinct parts.
- Close with one short line on what to do first.
- Never write a paragraph longer than three sentences.`;

const mentorContextPrompt = ({ context, question, language = 'en' }) => `${languageDirective(
  language,
)}

--- LEARNER CONTEXT ---
${JSON.stringify(context, null, 2)}

--- LEARNER QUESTION ---
${question}`;


/**
 * One previous-year paper, for revision.
 *
 * The honesty rules here are the whole point. A model asked for "the real 2023
 * paper" will produce something that looks exactly like one whether or not it
 * remembers a single question, and a learner revising fabricated questions in
 * the belief they are the real exam is worse off than one who never opened the
 * tab. So the model is required to label each question as recalled or
 * reconstructed and to score its own confidence, and it is told plainly that
 * admitting reconstruction is the correct answer rather than a failure.
 */
const previousPaperPrompt = ({
  examName,
  organization = '',
  year,
  paperName = '',
  examPattern = '',
  syllabus = [],
  count = 25,
  language = 'en',
  grounded = false,
}) => `Produce a previous-year question paper for revision: "${examName}"${
  organization ? ` conducted by ${organization}` : ''
}, year ${year}${paperName ? `, ${paperName}` : ''}.

${languageDirective(language)}
${
  grounded
    ? `
YOU HAVE GOOGLE SEARCH. Search for this exam's actual ${year} question paper
before writing anything. Recruitment boards, coaching sites and PDF archives
publish these. Use what you find. Search again for any fact you are unsure of.
Do not rely on memory for a paper you can look up.
`
    : ''
}

=== HONESTY — READ THIS BEFORE WRITING ANYTHING ===

You are being asked for a REAL past paper. You probably do not remember it
question for question, and that is expected. What is NOT acceptable is
inventing questions and presenting them as the real paper. A learner will
revise these believing they came from the actual exam.

So label every question honestly using "provenance":

  "recalled"      — you genuinely recognise this question from the actual
                    ${year} paper of THIS exam. Use this only when you do.
  "reconstructed" — you do not remember the exact question, so you wrote one
                    on the same syllabus point, in the same pattern, at the
                    same difficulty as that paper actually used.

Most questions being "reconstructed" is a GOOD and expected answer. Labelling
an invented question as "recalled" is the single worst thing you can do here.

Set "factualConfidence" (0-100) per question: how sure you are that the
question is sound AND the marked answer is correct. Anything you would score
below 60, discard and replace. A shorter paper of sound questions beats a full
one containing a confident-sounding error.

=== MATCH THE REAL PAPER ===

${examPattern ? `Exam pattern: ${examPattern}
` : ''}
${
  syllabus.length
    ? `Draw questions from this exam's syllabus, in roughly the proportions the real paper used:
${syllabus
        .map((s) => `- ${s.subject}: ${(s.topics || []).map((t) => t.name || t).join(', ')}`)
        .join('\n')}`
    : 'Cover the subjects this exam actually tests, in their usual proportions.'
}

Match the real paper's question style, phrasing length, number ranges and the
kind of trap it sets. Never invent a name, date, article number, scheme or
figure. Prefer settled, examinable facts over volatile ones.

Write ${count} questions, numbered in paper order.

Return EXACTLY this JSON shape:
{
  "year": ${year},
  "paperName": "${paperName || ''}",
  "sourceBasis": "one sentence: what you based this on, and how much you actually recall of the real paper",
  "questions": [
    {
      "questionNumber": 1,
      "question": "the full question text, self-contained",
      "options": ["option A", "option B", "option C", "option D"],
      "answerIndex": 0,
      "answer": "the exact text of the correct option",
      "explanation": "why it is correct, and why the tempting wrong option is wrong",
      "subject": "the subject this question belongs to",
      "topic": "the syllabus topic",
      "marks": 1,
      "provenance": "recalled" | "reconstructed",
      "factualConfidence": 0-100
    }
  ]
}`;


/**
 * A short grounded lookup that only finds where a past paper is published.
 *
 * Its real product is the grounding metadata, not the text. Generating the
 * paper is one long call whose sources only arrive with the finished answer,
 * so nothing can be shown while the learner waits. Asking first, briefly,
 * where the paper lives returns real pages in a couple of seconds — which is
 * what makes it possible to show the research happening instead of claiming
 * afterwards that it happened.
 */
const findPaperSourcesPrompt = ({ examName, organization = '', year, paperName = '' }) =>
  `Search the web for the actual question paper of "${examName}"${
    organization ? ` conducted by ${organization}` : ''
  }, year ${year}${paperName ? `, ${paperName}` : ''}.

Use Google Search. Look for the recruitment board's own site, question-paper
archives, and coaching sites that publish past papers for this exam.

Then reply with two or three plain sentences: what you found, and how complete
it looks. No JSON, no lists, no markdown. Keep it under 60 words — the pages
you consulted matter here, not the prose.`;

module.exports = {
  BRAIN_SYSTEM,
  MENTOR_SYSTEM,
  analyzeNotificationPrompt,
  transcribePrompt,
  analyzeIdentityVisionPrompt,
  analyzeSyllabusVisionPrompt,
  lessonPrompt,
  questionBatchPrompt,
  previousPaperPrompt,
  findPaperSourcesPrompt,
  performanceAnalysisPrompt,
  roadmapPrompt,
  mockBlueprintPrompt,
  readinessPrompt,
  mentorContextPrompt,
};
Object.assign(module.exports, { TUTOR_PROSE_SYSTEM, BRAIN_SYSTEM, transcribePrompt, analyzeNotificationPrompt, analyzeIdentityVisionPrompt, analyzeSyllabusVisionPrompt, lessonPrompt, lessonExplanationPrompt, lessonStructurePrompt, questionBatchPrompt, previousPaperPrompt, findPaperSourcesPrompt, performanceAnalysisPrompt, roadmapPrompt, mockBlueprintPrompt, readinessPrompt, MENTOR_SYSTEM, MENTOR_STREAM_SYSTEM, mentorContextPrompt });
