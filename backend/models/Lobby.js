// models/Lobby.js
import mongoose from "mongoose";

const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  character: { type: String, enum: ["mech", "kaiju"], required: true },
  ready: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now }
});

const lobbySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // 5-char code, uppercase
    hostUserId: { type: String, required: true, index: true },
    status: { type: String, enum: ["open", "in_progress", "finished"], default: "open", index: true },
    maxPlayers: { type: Number, default: 2, min: 2, max: 8 },
    players: { type: [playerSchema], default: [] },
    currentMatchId: { type: mongoose.Schema.Types.ObjectId, ref: "Match" },
    // TTL cleanup: Mongo will delete after expiresAt passes
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }
  },
  { timestamps: true }
);

export default mongoose.model("Lobby", lobbySchema);
