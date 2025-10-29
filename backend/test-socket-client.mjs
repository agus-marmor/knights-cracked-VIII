import { io } from "socket.io-client";
const TOKEN = "<paste tokenA or tokenB>";
const CODE  = "<paste your code>"; // e.g. ZJ5U5

const socket = io("http://localhost:5000", { auth: { token: TOKEN } });
socket.on("connect", () => {
  console.log("connected", socket.id);
  socket.emit("lobby:subscribe", { code: CODE });
});
<<<<<<< HEAD
socket.on("lobby:update", (lobby) => {
  console.log("UPDATE:", lobby.code, lobby.status, "players:", lobby.players.length);
});
socket.on("connect_error", (e) => console.error("connect_error:", e.message));
=======

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

>>>>>>> refs/remotes/origin/main
