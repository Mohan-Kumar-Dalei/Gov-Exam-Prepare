const mongoose = require('mongoose');

const daySchema = new mongoose.Schema(
  {
    day: { type: Number, required: true },
    date: { type: Date, default: null },
    phase: { type: String, default: '' },
    focusSubject: { type: String, default: '' },
    studyTopics: [{ _id: false, subject: String, topic: String, minutes: Number }],
    revisionTopics: [{ _id: false, subject: String, topic: String }],
    quizCount: { type: Number, default: 20 },
    mockTest: { type: Boolean, default: false },
    targetMinutes: { type: Number, default: 120 },
    notes: { type: String, default: '' },

    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    actualMinutes: { type: Number, default: 0 },
  },
  { _id: false },
);

const roadmapSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },

    title: { type: String, default: '60-Day Study Roadmap' },
    totalDays: { type: Number, default: 60 },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    dailyMinutes: { type: Number, default: 120 },
    strategy: { type: String, default: '' },
    phases: [{ _id: false, name: String, fromDay: Number, toDay: Number, goal: String }],
    days: [daySchema],

    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    regeneratedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

roadmapSchema.index({ user: 1, exam: 1, isActive: 1 });

roadmapSchema.virtual('completionRate').get(function completionRate() {
  const total = this.days?.length || 0;
  if (!total) return 0;
  const done = this.days.filter((d) => d.completed).length;
  return Math.round((done / total) * 1000) / 10;
});

roadmapSchema.virtual('currentDay').get(function currentDay() {
  const start = this.startDate ? new Date(this.startDate) : new Date();
  const diff = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
  return Math.min(Math.max(1, diff), this.totalDays || 60);
});

module.exports = mongoose.model('Roadmap', roadmapSchema);
