import mongoose from "mongoose";

const progressSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  wpm: { type: Number, default: 0 },        // live estimate
  accuracy: { type: Number, default: 100 }, // optional
  charsTyped: { type: Number, default: 0 },
  errors: { type: Number, default: 0 },
  finished: { type: Boolean, default: false },
  finishedAt: { type: Date },
}, { _id: false });

const matchSchema = new mongoose.Schema({
  code: { type: String, required: true, index: true },        // lobby code
  lobbyId: { type: mongoose.Schema.Types.ObjectId, ref: "Lobby" },
  status: { type: String, enum: ["countdown","playing","finished"], default: "countdown", index: true },
  promptId: { type: String },                 // id of text prompt
  promptText: { type: String, required: true },
  startedAt: { type: Date },
  endedAt: { type: Date },
  durationMs: { type: Number },               // optional derived
  players: { type: [progressSchema], default: [] },
  winnerUserId: { type: String },
}, { timestamps: true });

matchSchema.index({ code: 1, status: 1, createdAt: -1 });


export default mongoose.model("Match", matchSchema);
