import React, { useState, useEffect, useRef, useCallback } from 'react';
import io, { Socket } from 'socket.io-client'; // Import socket.io-client

// --- 1. WORD DATA ---
// (This list is just for local reference; the server sends the actual text)
const wordList = [
    'able', 'about', 'above', 'across', 'again', 'against', 'always', 'among', 'animal', 'another',
    'answer', 'around', 'because', 'before', 'began', 'being', 'below', 'between', 'black', 'bring',
    'build', 'called', 'carry', 'cause', 'certain', 'change', 'children', 'clear', 'close', 'color',
    'common', 'country', 'course', 'cover', 'different', 'during', 'early', 'earth', 'either', 'enough',
    'every', 'example', 'family', 'father', 'figure', 'follow', 'friend', 'front', 'general', 'group',
    'happen', 'heard', 'heart', 'heavy', 'however', 'include', 'interest', 'island', 'just', 'know',
    'large', 'learn', 'leave', 'letter', 'light', 'little', 'living', 'long', 'machine', 'many',
    'matter', 'measure', 'might', 'money', 'morning', 'mother', 'mountain', 'music', 'never', 'number',
    'often', 'order', 'other', 'paper', 'party', 'people', 'place', 'plant', 'point', 'power',
    'problem', 'product', 'public', 'question', 'quick', 'reach', 'ready', 'really', 'right', 'river',
    'round', 'school', 'second', 'sentence', 'several', 'should', 'show', 'side', 'simple', 'small',
    'something', 'sound', 'space', 'special', 'start', 'state', 'still', 'story', 'study', 'system',
    'table', 'take', 'talk', 'their', 'there', 'these', 'thing', 'think', 'those', 'though', 'thought',
    'through', 'time', 'today', 'together', 'took', 'toward', 'travel', 'under', 'until', 'using',
    'usually', 'various', 'voice', 'want', 'watch', 'water', 'where', 'which', 'while', 'white',
    'whole', 'without', 'world', 'would', 'write', 'young'
];

// --- 2. GAME CONSTANTS ---
// const MATCH_WIN_SCORE = 50; // No longer needed
const GAME_TIME_LIMIT = 60; // 60 seconds
const SERVER_URL = "http://localhost:5000"; // Backend server URL
const API_URL = "http://localhost:5000"; // API URL (same server)

// Type for letter status
type LetterStatus = 'pending' | 'correct' | 'incorrect';

// --- 3. TYPING GAME COMPONENT ---
const TypingGame: React.FC<{ onViewLeaderboard: () => void }> = ({ onViewLeaderboard }) => {
    // --- STATE MANAGEMENT (useState) ---
    const [textToType, setTextToType] = useState<string>("Connecting to server...");
    const [letterStatuses, setLetterStatuses] = useState<LetterStatus[]>([]);
    const [currentLetterIndex, setCurrentLetterIndex] = useState<number>(0);
    
    // Opponent's score
    const [opponentWords, setOpponentWords] = useState<number>(0);
    const [correctWords, setCorrectWords] = useState<number>(0);
    const [correctKeystrokes, setCorrectKeystrokes] = useState<number>(0);
    
    const [timeRemaining, setTimeRemaining] = useState<number>(GAME_TIME_LIMIT);
    const [currentWPM, setCurrentWPM] = useState<number>(0);
    const [gameActive, setGameActive] = useState<boolean>(false);
    const [startTime, setStartTime] = useState<number | null>(null);
    const [gameResult, setGameResult] = useState<'Player' | 'Enemy' | 'Time-Out' | null>(null);

    // New state for multiplayer
    const [isWaiting, setIsWaiting] = useState<boolean>(false);
    
    // --- REFS (useRef) ---
    const gameTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const textDisplayRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // New refs for socket and room ID
    const socketRef = useRef<Socket | null>(null);
    const roomIdRef = useRef<string | null>(null);

    // --- HELPER FUNCTIONS & CALCULATIONS ---

    /**
     * Resets all game states to their initial values.
     */
    const initializeGame = useCallback(() => {
        setTextToType("Waiting for opponent...");
        setLetterStatuses([]);
        
        setOpponentWords(0);
        setTimeRemaining(GAME_TIME_LIMIT);
        setGameActive(false);
        setStartTime(null);
        setCorrectKeystrokes(0);
        setCorrectWords(0);
        setCurrentLetterIndex(0);
        setCurrentWPM(0);
        setGameResult(null);
        setIsWaiting(false); // Not waiting until socket confirms

        if (gameTimerIntervalRef.current) clearInterval(gameTimerIntervalRef.current);
    }, []);

    /**
     * Ends the game, stops timers, and sets the result.
     * This is NOW ONLY CALLED by the server's 'game_over' event.
     */
    const endGame = useCallback((winner: 'Player' | 'Enemy' | 'Time-Out') => {
        // Use functional update to prevent race conditions
        setGameActive(prevGameActive => {
            if (!prevGameActive) return false; // Already ended
            
            setGameResult(winner);
            
            if (gameTimerIntervalRef.current) clearInterval(gameTimerIntervalRef.current);

            // NO LONGER EMIT 'game_finished'. Server is in charge.
            return false; // Set gameActive to false
        });
    }, []); // Removed dependencies

    // --- DERIVED STATE (Calculations) ---
    
    // Game balance is now derived from player vs opponent words
    const gameBalance = correctWords - opponentWords;
    const matchWinScore = Math.max(correctWords, opponentWords, 25) + 5; // Dynamic "win" score for bar visuals

    const finalPlayerWPM = (() => {
        if (gameResult && startTime) {
            // Game is 1 minute (60s)
            return correctWords;
        }
        return 0;
    })();

    const { playerPercent, enemyPercent } = (() => {
        const totalPoints = matchWinScore * 2;
        const playerShare = matchWinScore + gameBalance;
        const pPercent = Math.max(0, Math.min(100, (playerShare / totalPoints) * 100));
        return { playerPercent: pPercent, enemyPercent: 100 - pPercent };
    })();

    const formattedTime = `${Math.floor(timeRemaining / 60)}:${(timeRemaining % 60).toString().padStart(2, '0')}`;
    
    const { winnerText, winnerColor } = (() => {
        switch (gameResult) {
            case 'Player': return { winnerText: 'You Win!', winnerColor: 'text-green-400' };
            case 'Enemy': return { winnerText: 'You Lose!', winnerColor: 'text-red-400' };
            case 'Time-Out': return { winnerText: "It's a Tie!", winnerColor: 'text-yellow-400' };
            default: return { winnerText: '', winnerColor: '' };
        }
    })();


    // --- GAME LOGIC (useEffect Hooks) ---

    // Effect to set initial state on mount
    useEffect(() => {
        initializeGame();
    }, [initializeGame]);

    // --- SOCKET.IO LOGIC ---
    useEffect(() => {
        // --- HACK for testing without auth ---
        // In a real app, you get the logged-in user's ID from an auth context.
        // You MUST have 2 different IDs to test multiplayer.
        // Get two real User _id values from your MongoDB database and paste them here.
        const FAKE_USER_ID_1 = "60f1c1b1b9b1b1b1b1b1b1b1"; // HACK: Get a real ID from your DB
        const FAKE_USER_ID_2 = "60f1c1b1b9b1b1b1b1b1b1b2"; // HACK: Get another real ID
        // This simple hack alternates between two users.
        const userId = (Math.random() > 0.5) ? FAKE_USER_ID_1 : FAKE_USER_ID_2;
        console.log("Connecting as user:", userId);
        // --- END HACK ---

        // Connect to the backend server with auth
        const newSocket = io(SERVER_URL, {
            auth: { userId: userId }
        });
        socketRef.current = newSocket;

        // --- Event Listeners ---
        newSocket.on('waiting_for_opponent', () => {
            console.log("Waiting for opponent...");
            initializeGame(); // Reset state
            setIsWaiting(true);
        });

        newSocket.on('game_start', (data: { text: string, startTime: number, roomId: string }) => {
            console.log("Game starting! Room:", data.roomId);
            setTextToType(data.text);
            setLetterStatuses(Array(data.text.length).fill('pending'));
            setStartTime(data.startTime);
            roomIdRef.current = data.roomId; // Store ref
            
            // Reset scores
            setCurrentLetterIndex(0);
            setCorrectKeystrokes(0);
            setCorrectWords(0);
            setOpponentWords(0);
            setTimeRemaining(GAME_TIME_LIMIT);
            setGameResult(null);
            
            setIsWaiting(false);
            setGameActive(true);
            inputRef.current?.focus();
        });

        newSocket.on('opponent_progress', (data: { words: number }) => {
            setOpponentWords(data.words);
        });
        
        // Updated 'game_over' listener
        newSocket.on('game_over', (data: { winnerId: string | null, isTie: boolean }) => {
            if (data.isTie) {
                endGame('Time-Out'); // Use 'Time-Out' to signify a tie
            } else {
                const winner = data.winnerId === newSocket.id ? 'Player' : 'Enemy';
                endGame(winner);
            }
        });
        
        newSocket.on('opponent_left', () => {
             console.log("Opponent disconnected");
             // Give the player the win if the opponent leaves before game ends
             endGame('Player'); 
        });

        // Cleanup on unmount
        return () => {
            newSocket.disconnect();
        };
    }, [initializeGame, endGame]); // Runs once on mount


    // --- Game Timer and WPM Logic ---
    useEffect(() => {
        if (gameActive) {
            gameTimerIntervalRef.current = setInterval(() => {
                setTimeRemaining(prevTime => {
                    if (prevTime <= 1) {
                        // Time's up on the client.
                        // Stop the timer, but DO NOT end the game.
                        // Wait for the server's 'game_over' event.
                        if (gameTimerIntervalRef.current) clearInterval(gameTimerIntervalRef.current);
                        return 0;
                    }
                    
                    if (startTime) {
                        const elapsedTime = (new Date().getTime() - startTime) / 1000;
                        const wpm = (correctKeystrokes / 5) / (elapsedTime / 60);
                        setCurrentWPM(Math.floor(wpm) || 0);
                    }
                    
                    return prevTime - 1;
                });
            }, 1000);
        }
        
        return () => {
            if (gameTimerIntervalRef.current) clearInterval(gameTimerIntervalRef.current);
        };
    }, [gameActive, startTime, correctKeystrokes]); // Removed dependencies that would restart timer

    // --- Scroll Logic ---
    useEffect(() => {
        if (textDisplayRef.current) {
            const currentLetterSpan = textDisplayRef.current.querySelector(`#letter-${currentLetterIndex}`) as HTMLSpanElement;
            if (currentLetterSpan) {
                const display = textDisplayRef.current;
                if (currentLetterSpan.offsetTop > display.scrollTop + display.clientHeight - 40) {
                    display.scrollTop = currentLetterSpan.offsetTop - display.clientHeight + 40;
                }
            }
        }
    }, [currentLetterIndex]);

    // --- 'savePlayerScore' useEffect REMOVED ---
    // The backend now handles saving scores for multiplayer games.

    // --- EVENT HANDLERS ---

    const handleKeyInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!gameActive || gameResult) {
            return; // Don't allow typing if game isn't active or has ended
        }
        
        const typedKey = e.key;
        
        if (typedKey === 'Backspace') {
            if (currentLetterIndex > 0) {
                setCurrentLetterIndex(prevIndex => prevIndex - 1);
                setLetterStatuses(prevStatuses => {
                    const newStatuses = [...prevStatuses];
                    newStatuses[currentLetterIndex - 1] = 'pending';
                    return newStatuses;
                });
            }
            return; 
        }

        if (typedKey.length > 1) {
            return;
        }

        const expectedKey = textToType[currentLetterIndex];
        if (typedKey === expectedKey) {
            setCorrectKeystrokes(prev => prev + 1);
            setLetterStatuses(prevStatuses => {
                const newStatuses = [...prevStatuses];
                newStatuses[currentLetterIndex] = 'correct';
                return newStatuses;
            });
            
            if (typedKey === ' ') {
                const newWordCount = correctWords + 1;
                setCorrectWords(newWordCount);
                
                // --- EMIT PROGRESS TO SERVER ---
                if (socketRef.current && roomIdRef.current) {
                    socketRef.current.emit('word_typed', { 
                        roomId: roomIdRef.current, 
                        words: newWordCount 
                    });
                }
                
                // --- 'MATCH_WIN_SCORE' check REMOVED ---
                // Client no longer decides the winner.
            }

        } else {
            setLetterStatuses(prevStatuses => {
                const newStatuses = [...prevStatuses];
                newStatuses[currentLetterIndex] = 'incorrect';
                return newStatuses;
            });
        }
        
        if (currentLetterIndex < textToType.length - 1) {
            setCurrentLetterIndex(prevIndex => prevIndex + 1);
        } else {
             // Finished text, but game continues until timer is up.
             // Do nothing, just keep going.
             // Or, we could just loop the text? For now, nothing.
             setCurrentLetterIndex(prevIndex => prevIndex + 1); // Go past end
        }
    };

    const focusInput = () => {
        if (!gameResult) { // Only focus if game is active or ready
            inputRef.current?.focus();
        }
    };
    
    // --- RENDER (JSX) ---
    return (
        <div className="w-full max-w-4xl relative">
            
            {/* Waiting for Opponent Modal */}
            {isWaiting && (
                <div className="absolute inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-40 p-4 rounded-2xl">
                    <div className="bg-gray-800 p-10 rounded-2xl shadow-2xl border border-gray-700 text-center space-y-6">
                        <h2 className="text-3xl font-bold text-white animate-pulse">
                            Waiting for opponent...
                        </h2>
                    </div>
                </div>
            )}

            {/* Game Screen */}
            <div className={`space-y-6 ${isWaiting ? 'blur-sm' : ''}`}>
                
                {/* 1. TUG-OF-WAR BAR */}
                <div className="w-full bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-3">
                    <div className="flex justify-between items-center text-lg font-bold">
                        <span className="text-green-400">Player</span>
                        <span className="text-gray-400 font-mono text-sm">{`${correctWords} / ${opponentWords}`}</span>
                        <span className="text-red-400">Opponent</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-6 flex overflow-hidden border border-gray-900">
                        <div 
                            className="bg-green-500 h-6 transition-all duration-300 ease-linear" 
                            style={{ width: `${playerPercent}%` }}
                        ></div>
                        <div 
                            className="bg-red-500 h-6 transition-all duration-300 ease-linear" 
                            style={{ width: `${enemyPercent}%` }}
                        ></div>
                    </div>
                </div>

                {/* 2. TIMER & WPM */}
                <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <div>
                        <span className="text-sm text-gray-400">Time Left</span>
                        <div className="text-4xl font-mono font-bold text-yellow-400">{formattedTime}</div>
                    </div>
                    <div>
                        <span className="text-sm text-gray-400">Current WPM</span>
                        <div className="text-4xl font-mono font-bold text-cyan-400">{currentWPM}</div>
                    </div>
                </div>

                {/* 3. TEXT DISPLAY */}
                <div 
                    className="bg-gray-800 p-6 rounded-lg border border-gray-700 relative cursor-text"
                    onClick={focusInput}
                >
                    <div 
                        ref={textDisplayRef} 
                        className="h-40 overflow-y-auto" 
                        style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '1.5rem', lineHeight: '2rem', letterSpacing: '0.05em' }}
                        tabIndex={0}
                    >
                        {textToType.split('').map((letter, index) => {
                            let className = 'text-gray-400'; // pending
                            if (index === currentLetterIndex) {
                                className = 'bg-yellow-200 text-gray-800 rounded-sm'; // current
                            } else if (letterStatuses[index] === 'correct') {
                                className = 'text-green-200'; // correct
                            } else if (letterStatuses[index] === 'incorrect') {
                                className = 'text-red-300 underline'; // incorrect
                            }
                            
                            return (
                                <span key={index} id={`letter-${index}`} className={className}>
                                    {letter}
                                </span>
                            );
                        })}
                    </div>
                </div>

                {/* 4. HIDDEN INPUT BOX */}
                <textarea 
                    ref={inputRef}
                    onKeyDown={handleKeyInput}
                    className="opacity-0 absolute p-0 m-0 w-0 h-0" 
                    autoFocus
                    // Disable input if waiting
                    disabled={isWaiting || !!gameResult} 
                />
            </div>

            {/* End Game Modal (Conditionally rendered) */}
            {gameResult && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 p-10 rounded-2xl shadow-2xl border border-gray-700 text-center space-y-6 w-full max-w-lg">
                        <h2 className={`text-5xl font-bold ${winnerColor}`}>{winnerText}</h2>
                        <div className="flex flex-col sm:flex-row justify-around text-lg">
                            <div className="p-4">
                                <div className="text-sm text-gray-400">Your Final WPM</div>
                                <div className="text-4xl font-mono font-bold text-cyan-400">{finalPlayerWPM}</div>
                            </div>
                            <div className="p-4">
                                <div className="text-sm text-gray-400">Opponent's WPM</div>
                                <div className="text-4xl font-mono font-bold text-red-400">{opponentWords}</div>
                            </div>
                        </div>
                        {/* Modal Buttons */}
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button 
                                // Reload the page to find a new match
                                onClick={() => window.location.reload()}
                                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-purple-500"
                            >
                                Play Again
                            </button>
                            <button 
                                onClick={onViewLeaderboard}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-500"
                            >
                                View Leaderboard
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- 4. API FUNCTIONS ---

/**
 * Fetches the leaderboard data from the API
 */
async function getLeaderboard(): Promise<any[]> {
    const res = await fetch(`${API_URL}/api/leaderboard`, {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.message || "Fetch leaderboard failed");
    }
    return res.json();
} 

/**
 * Saves the player's score to the backend
 * (This is now only used for AI mode, which is not active in this file)
 */
async function savePlayerScore(score: { name: string, matches: number, wpm: number, winRate: number }): Promise<void> {
    try {
        const res = await fetch(`${API_URL}/api/score`, {
            method: "POST",
            credentials: "include",
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(score),
        });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || "Save score failed");
        }
        // Score saved, no need to do anything with the response
        console.log("Score saved successfully");
    } catch (error) {
        console.error("Failed to save score:", error);
        // Don't bother the user, just log it
    }
} 


// --- 5. LEADERBOARD COMPONENT ---

// --- Type Definition ---
type LeaderboardEntry = {
  id: string;
  rank: number;
  name: string;
  matches: number;
  wpm: number;
  winRate: number;
};

// --- Helper Function ---
const getRankClass = (rank: number): string => {
  switch (rank) {
    case 1:
      return 'text-yellow-400 font-bold';
    case 2:
      return 'text-gray-300 font-bold';
    case 3:
      return 'text-yellow-600 font-bold';
    default:
      return 'text-gray-400';
  }
};

// --- Leaderboard Component ---
const LeaderboardDisplay: React.FC = () => {
    // State for data, loading, and errors
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch data on component mount
    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const data: any[] = await getLeaderboard();
                
                // Map API data to our LeaderboardEntry type, adding rank
                const rankedData = data.map((item, index) => ({
                    id: item.id || `user-${index}`, // Use id from backend map
                    rank: index + 1,
                    name: item.name || 'Anonymous',
                    matches: item.matches || 0,
                    wpm: item.wpm || 0,
                    winRate: item.winRate || 0,
                }));
                
                setLeaderboard(rankedData);
            } catch (err: any) { // <-- FIX: Added curly braces
                setError(err.message || "Failed to fetch leaderboard.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchLeaderboard();
    }, []); // Empty dependency array runs this effect once on mount

    // --- Render Loading State ---
    if (isLoading) {
        return (
            <div className="w-full max-w-4xl mx-auto bg-gray-900 rounded-2xl shadow-2xl p-10 text-center border border-gray-700">
                <h1 className="text-3xl font-bold text-white animate-pulse">
                    Loading Leaderboard...
                </h1>
            </div>
        );
    }

    // --- Render Error State ---
    if (error) {
        return (
            <div className="w-full max-w-4xl mx-auto bg-gray-900 rounded-2xl shadow-2xl p-10 text-center border border-red-700">
                <h1 className="text-3xl font-bold text-red-500 mb-4">
                    Error Fetching Data
                </h1>
                <p className="text-gray-300">{error}</p>
            </div>
        );
    }

    // --- Render Leaderboard ---
    return (
        <div className="w-full max-w-4xl mx-auto bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-700">
            <div className="p-6">
                <h1 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-6">
                Top 20 Players
                </h1>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-gray-300">
                    <thead className="bg-gray-800 border-b border-gray-700">
                        <tr>
                        <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-1/12">
                            Rank
                        </th>
                        <th scope="col" className="px-6 py-4 font-semibold text-white w-4/12">
                            Name
                        </th>
                        <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-2/1s2">
                            Matches
                        </th>
                        <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-2/12">
                            WPM
                        </th>
                        <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-2/12"> {/* <-- FIX: Removed invalid classType prop */}
                            Win Rate
                        </th>
                        </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-800">
                        {leaderboard.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-800/50 transition-colors duration-200">
                            <td className={`px-6 py-4 text-center font-medium ${getRankClass(user.rank)}`}>
                            {user.rank}
                            </td>
                            <td className="px-6 py-4 font-medium text-white whitespace-nowrap">
                            {user.name}
                            </td>
                            <td className="px-6 py-4 text-center text-purple-300">
                            {user.matches}
                            </td>
                            <td className="px-6 py-4 text-center text-cyan-300">
                            {user.wpm}
                            </td>
                            <td className="px-6 py-4 text-center text-pink-400">
                            {user.winRate.toFixed(1)}%
                            </td>
                        </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- 6. MAIN APP COMPONENT (Router) ---
export default function App() {
  const [currentView, setCurrentView] = useState<'game' | 'leaderboard'>('game');

  return (
    <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-4xl">
            {/* Navigation */}
            <nav className="mb-6 flex justify-center gap-4">
                <button
                    onClick={() => setCurrentView('game')}
                    className={`px-6 py-2 rounded-lg font-bold transition-all ${
                        currentView === 'game' 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                >
                    Game
                </button>
                <button
                    onClick={() => setCurrentView('leaderboard')}
                    className={`px-6 py-2 rounded-lg font-bold transition-all ${
                        currentView === 'leaderboard' 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                >
                    Leaderboard
                </button>
            </nav>

            {/* Conditional View */}
            {currentView === 'game' && <TypingGame onViewLeaderboard={() => setCurrentView('leaderboard')} />}
            {currentView === 'leaderboard' && <LeaderboardDisplay />}
        </div>
    </div>
  );
}

