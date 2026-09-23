const mongoose = require('mongoose');

/**
 * One Gemini API key in the rotation ring.
 *
 * Keys belong to the learner who added them. Each account brings its own key
 * and spends its own quota, so the ring is scoped by `user` everywhere it is
 * read — an unscoped read would let one account spend another's credits.
 *
 * Within an owner's ring, keys are tried in `priority` order. A key that
 * reports a billing or quota failure is parked — permanently for depleted
 * credits, briefly for a rate limit — so the next request starts on a key that
 * can actually serve it.
 */
const apiKeySchema = new mongoose.Schema(
  {
    /**
     * The key's owner. Every learner brings their own key and spends their own
     * quota, so a key is only ever visible to, and only ever spent by, the
     * account that added it.
     */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    label: { type: String, required: true, trim: true, maxlength: 60 },

    // Encrypted at rest; the plaintext never leaves the server.
    cipherText: { type: String, required: true, select: false },
    iv: { type: String, required: true, select: false },
    tag: { type: String, required: true, select: false },
    /** Shown in the UI so a key is recognisable without exposing it. */
    masked: { type: String, required: true },

    priority: { type: Number, default: 0, index: true },
    enabled: { type: Boolean, default: true },

    status: {
      type: String,
      enum: ['ok', 'rate_limited', 'exhausted', 'invalid', 'untested'],
      default: 'untested',
      index: true,
    },
    lastError: { type: String, default: '' },
    /** While in the future, the ring skips this key. */
    cooldownUntil: { type: Date, default: null },

    lastUsedAt: { type: Date, default: null },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

apiKeySchema.index({ user: 1, enabled: 1, priority: 1 });

/** True when this key is worth trying right now. */
apiKeySchema.methods.isAvailable = function isAvailable(now = new Date()) {
  if (!this.enabled) return false;
  if (this.status === 'invalid' || this.status === 'exhausted') return false;
  if (this.cooldownUntil && this.cooldownUntil > now) return false;
  return true;
};

apiKeySchema.methods.toClient = function toClient() {
  return {
    id: this._id,
    label: this.label,
    masked: this.masked,
    priority: this.priority,
    enabled: this.enabled,
    status: this.status,
    lastError: this.lastError,
    cooldownUntil: this.cooldownUntil,
    lastUsedAt: this.lastUsedAt,
    successCount: this.successCount,
    failureCount: this.failureCount,
    available: this.isAvailable(),
  };
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
