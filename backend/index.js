import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();
const app = express();
app.use(express.json());

// connect DB
await mongoose.connect(process.env.MONGO_URI);
console.log("✅ Mongo connected");

// mount routes
app.use("/api/auth", authRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
