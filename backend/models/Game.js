// --- 1. IMPORTS (ES Module Syntax) ---
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './User.js'; // <-- IMPORTED YOUR USER MODEL

// --- 2. CONFIGURATION & SETUP ---
dotenv.config(); // Load variables from .env file

const app = express();
// Configure CORS for your specific frontend URL
app.use(cors({
    origin: "http://localhost:3002", // Adjust to your frontend port if different
    credentials: true
}));
app.use(express.json()); // Allow app to parse JSON bodies

const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3002", // Match frontend URL
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/typingGame";

// --- 3. DATABASE (MongoDB with Mongoose) ---

// --- UserScoreSchema and UserScore model REMOVED ---
// We will now use the imported 'User' model

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log("Successfully connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// --- 4. REST API for LEADERBOARD ---
// This endpoint is updated to use the 'User' model
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Find top 20 users, sorted by PEAK WPM descending
    const users = await User.find()
      .sort({ "stats.peakWPM": -1 }) // -1 means descending
      .limit(20);
      
    // Map the full User object to the simple format the frontend expects
    const leaderboard = users.map(user => ({
        id: user._id, // Use MongoDB's _id
        name: user.username,
        matches: user.stats.totalMatches,
        wpm: user.stats.peakWPM, // Show peak WPM on leaderboard
        winRate: user.stats.winRate // Use the virtual property
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
});

// This endpoint is updated to use the 'User' model and 'applyMatchResult'
// This is now ONLY for the AI mode. Multiplayer scores are handled by Socket.IO.
app.post('/api/score', async (req, res) => {
    try {
        const { wpm, winRate } = req.body; // Frontend sends wpm and winRate
        const didWin = winRate > 0;

        // Since the frontend is in AI mode (no login), we'll find or create
        // a single "Anonymous" user to track these stats.
        const anonymousUser = await User.findOneAndUpdate(
            { username: 'anonymous' }, // Find this user
            { 
                // If they don't exist, create them with dummy data
                $setOnInsert: {
                    username: 'anonymous',
                    email: 'anon@typinggame.com',
                    password: 'dummyPassword123!', // Required by schema
                    stats: { avgWPM: 0, peakWPM: 0, totalMatches: 0, wins: 0, losses: 0 }
                }
            },
            { 
                upsert: true, // Create if it doesn't exist
                new: true, // Return the new or updated document
                setDefaultsOnInsert: true
            }
        );

        // Now, apply the match result using your custom method
        anonymousUser.applyMatchResult({ wpm, didWin });
        
        // Save the updated user
        await anonymousUser.save();
        
        res.status(201).json({ message: "Score updated for anonymous user" });
    } catch (error) {
        console.error("Error saving score:", error);
        res.status(500).json({ message: "Error saving score" });
    }
});


// --- 5. REAL-TIME GAME LOGIC (Socket.IO) ---

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

const GAME_TIME_LIMIT_MS = 60 * 1000; // 60 seconds

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

  // This logic is for real user auth.
  // We need the userId to save stats.
  const userId = socket.handshake.auth.userId;
  if (!userId) {
    console.log("Player connected without auth (userId). Disconnecting.");
    // In a real app, you'd force this. For testing, we'll let it slide,
    // but stats won't save.
    // return socket.disconnect(); 
  }

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
      player1_userId: player1.handshake.auth.userId, // Store user ID
      player2_userId: player2.handshake.auth.userId, // Store user ID
      text: gameText
    };

    console.log(`Game starting in room ${roomId}`);
    io.to(roomId).emit('game_start', { 
        text: gameText, 
        startTime: Date.now(),
        roomId: roomId 
    });

    // --- SERVER-AUTHORITATIVE TIMER ---
    // This timer is the *official* end of the game.
    setTimeout(async () => {
        const room = gameRooms[roomId];
        if (!room) return; // Room already cleaned up (e.g., disconnect)

        // Determine winner based on word count
        let winnerId = null;
        let isTie = false;
        
        if (room.player1.words > room.player2.words) {
            winnerId = room.player1.id;
        } else if (room.player2.words > room.player1.words) {
            winnerId = room.player2.id;
        } else {
            // It's a tie
            isTie = true;
        }

        // Announce results to clients
        io.to(roomId).emit('game_over', { winnerId, isTie });

        // --- Save results for BOTH players ---
        try {
            const player1User = await User.findById(room.player1_userId);
            const player2User = await User.findById(room.player2_userId);

            // Calculate WPM for both (words / 1 minute)
            const player1WPM = room.player1.words; 
            const player2WPM = room.player2.words;

            if (isTie) {
                // On a tie, both players get a match, but no win.
                if (player1User) {
                    player1User.applyMatchResult({ wpm: player1WPM, didWin: false });
                    await player1User.save();
                }
                if (player2User) {
                    player2User.applyMatchResult({ wpm: player2WPM, didWin: false });
                    await player2User.save();
                }
                console.log(`Game TIE in room ${roomId}.`);
            } else {
                // Determine winner and loser
                const winnerDoc = (winnerId === room.player1.id) ? player1User : player2User;
                const loserDoc = (winnerId === room.player1.id) ? player2User : player1User;
                const winnerWPM = (winnerId === room.player1.id) ? player1WPM : player2WPM;
                const loserWPM = (winnerId === room.player1.id) ? player2WPM : player1WPM;

                if (winnerDoc) {
                    winnerDoc.applyMatchResult({ wpm: winnerWPM, didWin: true });
                    await winnerDoc.save();
                }
                if (loserDoc) {
                    loserDoc.applyMatchResult({ wpm: loserWPM, didWin: false });
                    await loserDoc.save();
                }
                console.log(`Game results saved for room ${roomId}. Winner: ${winnerId}`);
            }
        } catch (error) {
            console.error("Error saving match results:", error);
        }
        
        // Clean up
        delete gameRooms[roomId];
        io.sockets.in(roomId).socketsLeave(roomId);

    }, GAME_TIME_LIMIT_MS); // End game after 60 seconds

  } else {
    console.log(`Player ${socket.id} is waiting...`);
    waitingPlayerSocket = socket;
    socket.emit('waiting_for_opponent');
  }

  socket.on('word_typed', (data) => {
    const { roomId, words } = data;
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

  // --- Client-authoritative 'game_finished' listener REMOVED ---
  // The server now decides when the game ends.

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    if (waitingPlayerSocket && waitingPlayerSocket.id === socket.id) {
      waitingPlayerSocket = null;
    }
    
    const roomId = Object.keys(gameRooms).find(id => 
        gameRooms[id].player1.id === socket.id || gameRooms[id].player2.id === socket.id
    );

    if (roomId) {
        console.log(`Player ${socket.id} left room ${roomId}`);
        const room = gameRooms[roomId];
        const opponentKey = (room.player1.id === socket.id) ? 'player2' : 'player1';
        const opponentSocket = io.sockets.sockets.get(room[opponentKey].id);

        if (opponentSocket) {
            // Tell the opponent they won
            opponentSocket.emit('game_over', { winnerId: room[opponentKey].id, isTie: false });
            // In a real app, you'd also save this result (e.g., opponent wins by forfeit)
        }
        
        delete gameRooms[roomId];
    }
  });
});

// --- 6. START SERVER ---
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

