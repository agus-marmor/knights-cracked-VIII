import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    lobbyCode: { type: String, required: true, index: true },
    textId: { type: String, required: true },      // which prompt/paragraph
    startedAt: Date,
    finishedAt: Date,
    results: [
      {
        userId: String,
        name: String,
        wpm: Number,
        accuracy: Number,
        finishedAt: Date,
        progress: Number // 0..1
      }
    ]
  },
  { timestamps: true }
);

export default mongoose.model("Match", matchSchema);
