const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    path: { type: String, required: true },
    mimeType: { type: String, default: 'application/pdf' },
    sizeBytes: { type: Number, default: 0 },
    /** SHA-256 of the file: re-uploading the same PDF reuses the earlier analysis. */
    contentHash: { type: String, default: '', index: true },

    pageCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    // Large blob: excluded by default so document listings stay cheap.
    extractedText: { type: String, default: '', select: false },
    /** No usable text layer — this one was read by Gemini as page images. */
    isScanned: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['uploaded', 'parsing', 'analyzing', 'completed', 'failed'],
      default: 'uploaded',
      index: true,
    },
    error: { type: String, default: '' },

    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null },
    analyzedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

documentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
