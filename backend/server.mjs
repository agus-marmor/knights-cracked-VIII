import http from "http";
import express from "express";
import { initSocket } from "./socket.js";
import promptRoutes from "./routes/prompt.routes.js";


const app = express();
const server = http.createServer(app);
initSocket(server, process.env.CORS_ORIGIN);
app.use("/api", promptRoutes);

server.listen(5000, () => console.log("Server running on :5000"));

