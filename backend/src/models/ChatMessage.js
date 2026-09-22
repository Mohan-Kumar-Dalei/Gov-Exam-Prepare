const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null, index: true },
    conversationId: { type: String, required: true, index: true },

    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },

    /** Structured payload when the mentor returns actions/plans alongside prose. */
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    tokensUsed: { type: Number, default: 0 },
  },
  { timestamps: true },
);

chatMessageSchema.index({ user: 1, conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
