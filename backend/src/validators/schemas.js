const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const language = z.enum(['en', 'hinglish', 'od']);

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password is too long')
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token is required'),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatarUrl: z.string().url().or(z.literal('')).optional(),
  activeExam: objectId.nullable().optional(),
  preferences: z
    .object({
      dailyStudyMinutes: z.coerce.number().int().min(15).max(960).optional(),
      dailyQuizTarget: z.coerce.number().int().min(5).max(200).optional(),
      language: language.optional(),
      notifications: z.boolean().optional(),
    })
    .optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});

const lessonParamsSchema = z.object({
  examId: objectId,
});

/** Query strings arrive as text, and Boolean('false') is true — parse explicitly. */
const booleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

const lessonQuerySchema = z.object({
  subject: z.string().trim().min(1, 'subject is required'),
  topic: z.string().trim().min(1, 'topic is required'),
  refresh: booleanish,
  language: language.optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional().default('beginner'),
});

const startQuizSchema = z.object({
  examId: objectId,
  count: z.coerce.number().int().min(1).max(50).default(10),
  subjects: z.array(z.string()).optional().default([]),
  topics: z.array(z.string()).optional().default([]),
  difficulty: z.enum(['easy', 'medium', 'hard', 'adaptive']).default('adaptive'),
  mode: z.enum(['practice', 'quiz', 'adaptive']).default('quiz'),
  language: language.optional(),
  durationMinutes: z.coerce.number().int().min(0).max(300).optional(),
});

const startMockSchema = z.object({
  examId: objectId,
  /** Cap generation cost — full-length papers can be very large. */
  maxQuestions: z.coerce.number().int().min(10).max(200).optional(),
  language: language.optional(),
});

const submitSessionSchema = z.object({
  responses: z
    .array(
      z.object({
        questionId: objectId,
        selectedIndex: z.coerce.number().int().min(0).max(5).nullable().optional(),
        timeSpentSec: z.coerce.number().min(0).max(7200).optional().default(0),
      }),
    )
    .min(1, 'Submit at least one response'),
  timeTakenSec: z.coerce.number().min(0).max(86400).optional().default(0),
  requestAiFeedback: z.boolean().optional().default(true),
});

const roadmapSchema = z.object({
  examId: objectId,
  days: z.coerce.number().int().min(7).max(180).default(60),
  dailyMinutes: z.coerce.number().int().min(30).max(960).default(120),
  startDate: z.coerce.date().optional(),
  regenerate: z.boolean().optional().default(false),
});

const roadmapDaySchema = z.object({
  completed: z.boolean(),
  actualMinutes: z.coerce.number().int().min(0).max(1440).optional().default(0),
});

const mentorSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(2000),
  examId: objectId.optional(),
  conversationId: z.string().trim().max(64).optional(),
  language: language.optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.string().optional(),
  mode: z.string().optional(),
  examId: objectId.optional(),
});

const idParamSchema = z.object({ id: objectId });

module.exports = {
  signupSchema,
  loginSchema,
  refreshSchema,
  updateProfileSchema,
  changePasswordSchema,
  lessonParamsSchema,
  lessonQuerySchema,
  startQuizSchema,
  startMockSchema,
  submitSessionSchema,
  roadmapSchema,
  roadmapDaySchema,
  mentorSchema,
  listQuerySchema,
  idParamSchema,
};
Object.assign(module.exports, { signupSchema, loginSchema, refreshSchema, updateProfileSchema, changePasswordSchema, lessonParamsSchema, lessonQuerySchema, startQuizSchema, startMockSchema, submitSessionSchema, roadmapSchema, roadmapDaySchema, mentorSchema, listQuerySchema, idParamSchema });
