// index.js (or server.js)
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
// index.js
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import lobbyRoutes from "./routes/lobby.routes.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN, // e.g. http://localhost:3000
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));
app.options(/.*/, cors());             // handle preflight
app.use(express.json());               // body parser BEFORE routes


// routes
app.use("/api/auth", authRoutes);
app.use("/api/lobbies", lobbyRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
