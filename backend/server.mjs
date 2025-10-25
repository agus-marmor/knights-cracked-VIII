import http from "http";
import express from "express";
import { initSocket } from "./socket.js";

const app = express();
const server = http.createServer(app);
initSocket(server, process.env.CORS_ORIGIN);

server.listen(5000, () => console.log("Server running on :5000"));
