
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import http from "http";
// index.js
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import lobbyRoutes from "./routes/lobby.routes.js";
import { initSocket } from "./socket.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const app = express();
const conn = mongoose.connection;
let gfsBucket;
conn.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'avatars'
  });
  app.locals.gridfsBucket = gridfsBucket;

});
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));
app.options(/.*/, cors());             // handle preflight
app.use(express.json());               // body parser BEFORE routes



// routes
app.use("/api/auth", authRoutes);
app.use("/api/lobby", lobbyRoutes);
app.use("/api/user", userRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/matches", matchRoutes)


// create HTTP server and attach Socket.IO
const server = http.createServer(app);
initSocket(server, process.env.FRONTEND_ORIGIN);



const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));

