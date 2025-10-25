import mongoose from "mongoose";

const lobbySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    hostUserId: { type: String, required: true },
    players: [
      {
        userId: String,
        name: String,
        joinedAt: Date,
        ready: { type: Boolean, default: false }
      }
    ],
    status: { type: String, enum: ["open", "in_progress", "finished"], default: "open" }
  },
  { timestamps: true }
);

export default mongoose.model("Lobby", lobbySchema);