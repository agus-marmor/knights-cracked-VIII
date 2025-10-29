import mongoose from "mongoose";

const statsSchema = new mongoose.Schema(
  {
    avgWPM:       { type: Number, default: 0, min: 0 },
    peakWPM:      { type: Number, default: 0, min: 0 },
    totalMatches: { type: Number, default: 0, min: 0 },
    wins:         { type: Number, default: 0, min: 0 },
    losses:       { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// Virtual: compute winRate (%) on the fly to avoid drift
statsSchema.virtual("winRate").get(function () {
  const t = this.totalMatches || 0;
  if (!t) return 0;
  return Number(((this.wins / t) * 100).toFixed(2));
});

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9._-]+$/i,
      index: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    password: { type: String, required: true, minlength: 6 },

    // GridFS file ID for avatar image
    avatarFileId: { type: mongoose.Schema.Types.ObjectId, default: null },

    
    stats: { type: statsSchema, default: () => ({}) }
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Useful indexes for leaderboards
userSchema.index({ "stats.peakWPM": -1 });
userSchema.index({ "stats.avgWPM": -1 });
userSchema.index({ "stats.wins": -1 });

// Helper: apply a match result to stats (atomic-ish)
userSchema.methods.applyMatchResult = function ({ wpm, didWin }) {
  // Update peak
  if (typeof wpm === "number" && wpm > (this.stats.peakWPM || 0)) {
    this.stats.peakWPM = Math.floor(wpm);
  }

  // Update totals
  this.stats.totalMatches = (this.stats.totalMatches || 0) + 1;
  if (didWin) this.stats.wins = (this.stats.wins || 0) + 1;
  else this.stats.losses = (this.stats.losses || 0) + 1;

  // Update average WPM with a simple running average
  // avg_n+1 = (avg_n * n + wpm) / (n + 1)
  if (typeof wpm === "number") {
    const n = this.stats.totalMatches;
    const prevAvg = this.stats.avgWPM || 0;
    this.stats.avgWPM = Number((((prevAvg * (n - 1)) + wpm) / n).toFixed(2));
  }
};

export default mongoose.model("User", userSchema);
