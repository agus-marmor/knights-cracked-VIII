// --- 1. IMPORTS (ES Module Syntax) ---
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// --- 2. CONFIGURATION & SETUP ---
dotenv.config(); // Load variables from .env file

const app = express();
app.use(cors()); // Allow requests from your frontend (for API)
app.use(express.json()); // Allow app to parse JSON bodies

const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*", // In production, change to your frontend's URL
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/typingGame";

// --- 3. DATABASE (MongoDB with Mongoose) ---

// Define a schema for user scores
// This matches the data your frontend expects
const UserScoreSchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'Anonymous' },
  matches: { type: Number, default: 0 },
  wpm: { type: Number, default: 0, index: true }, // Add index for sorting
  winRate: { type: Number, default: 0 },
  // You would associate this with a user ID in a real app
  // userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const UserScore = mongoose.model('UserScore', UserScoreSchema);

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log("Successfully connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// --- 4. REST API for LEADERBOARD ---
// This is the endpoint your frontend is already fetching
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Find top 20 users, sorted by WPM descending
    const leaderboard = await UserScore.find()
      .sort({ wpm: -1 }) // -1 means descending
      .limit(20);
      
    res.json(leaderboard);
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
});

// Example: API endpoint to *add* a score (you'd call this from the frontend)
app.post('/api/score', async (req, res) => {
    try {
        const { name, matches, wpm, winRate } = req.body;
        
        // In a real app, you'd find the user and update their stats
        // For now, we just create a new entry for demonstration
        const newScore = new UserScore({
            name,
            matches,
            wpm,
            winRate,
        });
        await newScore.save();
        res.status(201).json(newScore);
    } catch (error) {
        res.status(500).json({ message: "Error saving score" });
    }
});


// --- 5. REAL-TIME GAME LOGIC (Socket.IO) ---

// Renamed to avoid declaration conflicts
const GAME_WORD_LIST = [
    'able', 'about', 'above', 'across', 'again', 'against', 'always', 'among', 'animal', 'another',
    'answer', 'around', 'because', 'before', 'began', 'being', 'below', 'between', 'black', 'bring',
    'build', 'called', 'carry', 'cause', 'certain', 'change', 'children', 'clear', 'close', 'color',
    'common', 'country', 'course', 'cover', 'different', 'during', 'early', 'earth', 'either', 'enough',
    'every', 'example', 'family', 'father', 'figure', 'follow', 'friend', 'front', 'general', 'group',
    'happen', 'heard', 'heart', 'heavy', 'however', 'include', 'interest', 'island', 'just', 'know',
    'large', 'learn', 'leave', 'letter', 'light', 'little', 'living', 'long', 'machine', 'many',
    'matter', 'measure', 'might', 'money', 'morning', 'mother', 'mountain', 'music', 'never', 'number',
    'often', 'order', 'other', 'paper', 'party', 'people', 'place', 'plant', 'point', 'power',
    'problem', 'product', 'public', 'question', 'quick', 'reach', 'ready', 'really', 'right', 'young'
];

let waitingPlayerSocket = null;
let gameRooms = {};

function generateGameText() {
    let words = [];
    for (let i = 0; i < 150; i++) {
        words.push(GAME_WORD_LIST[Math.floor(Math.random() * GAME_WORD_LIST.length)]);
    }
    return words.join(' ') + ' ';
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  if (waitingPlayerSocket) {
    const player1 = waitingPlayerSocket;
    const player2 = socket;
    const roomId = `${player1.id}-${player2.id}`;

    player1.join(roomId);
    player2.join(roomId);
    waitingPlayerSocket = null;

    const gameText = generateGameText();
    gameRooms[roomId] = {
      player1: { id: player1.id, words: 0 },
      player2: { id: player2.id, words: 0 },
      text: gameText
    };

    console.log(`Game starting in room ${roomId}`);
    // We must pass the roomId to the clients
    io.to(roomId).emit('game_start', { 
        text: gameText, 
        startTime: Date.now(),
        roomId: roomId // <-- Add this
    });

  } else {
    console.log(`Player ${socket.id} is waiting...`);
    waitingPlayerSocket = socket;
    socket.emit('waiting_for_opponent');
  }

  socket.on('word_typed', (data) => {
    const { roomId, words } = data; // Client must send roomId
    const room = gameRooms[roomId];
    if (!room) return;

    let playerKey = (room.player1.id === socket.id) ? 'player1' : 'player2';
    let opponentKey = (playerKey === 'player1') ? 'player2' : 'player1';

    room[playerKey].words = words;

    const opponentSocket = io.sockets.sockets.get(room[opponentKey].id);
    if (opponentSocket) {
      opponentSocket.emit('opponent_progress', { words: room[playerKey].words });
    }
  });

  socket.on('game_finished', (data) => {
    const { roomId, wpm } = data;
    const room = gameRooms[roomId];
    if (!room) return;

    // TODO: Save game results to MongoDB
    // You'd get the user's name/ID (via auth) and update their stats
    console.log(`Game finished in room ${roomId}. Winner: ${socket.id} with ${wpm} WPM.`);
    
    // Announce winner
    io.to(roomId).emit('game_over', { winnerId: socket.id });
    
    // Clean up
    delete gameRooms[roomId];
    // Manually disconnect sockets in room
    io.sockets.in(roomId).socketsLeave(roomId);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    if (waitingPlayerSocket && waitingPlayerSocket.id === socket.id) {
      waitingPlayerSocket = null;
    }
    
    // Find if the player was in a room
    const roomId = Object.keys(gameRooms).find(id => 
        gameRooms[id].player1.id === socket.id || gameRooms[id].player2.id === socket.id
    );

    if (roomId) {
        console.log(`Player ${socket.id} left room ${roomId}`);
        const room = gameRooms[roomId];
        const opponentKey = (room.player1.id === socket.id) ? 'player2' : 'player1';
        const opponentSocket = io.sockets.sockets.get(room[opponentKey].id);

        if (opponentSocket) {
            opponentSocket.emit('opponent_left');
        }
        
        delete gameRooms[roomId];
    }
  });
});

// --- 6. START SERVER ---
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

