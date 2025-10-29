import { io } from "socket.io-client";

const TOKEN =  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZmNmMjY0MDM3YmI0NWZjZTEyN2FjNSIsImVtYWlsIjoiaG9zdGFAZXhhbXBsZS5jb20iLCJ1c2VybmFtZSI6Imhvc3RhIiwiaWF0IjoxNzYxNDE5ODY5LCJleHAiOjE3NjIwMjQ2Njl9.UtBmqgQlU8ya0CxrTJ6GGJQB9d8-9LlB468w0df-_ek";
const CODE  = process.env.CODE  || "ABCDE";
const URL   = process.env.URL   || "http://localhost:5000";

const socket = io(URL, {
  auth: { token: TOKEN },
  // transports: ["websocket"], // keep commented while debugging
  reconnectionAttempts: 3,
  timeout: 10000
});

socket.on("connect", () => {
  console.log("connected", socket.id);
  socket.emit("lobby:subscribe", { code: CODE });
});

socket.on("lobby:presence", (data) => {
  console.log(`[${data.type}] user ${data.userId}`);
});

socket.on("lobby:update", (lobby) => {
  console.log("UPDATE:", lobby.code, lobby.status, "players:", lobby.players);
});

socket.on("connect_error", (err) => {
  console.error("connect_error:", err.message);
});
socket.emit("lobby:subscribe", { code: "3WM2Q" }); // use your real code

