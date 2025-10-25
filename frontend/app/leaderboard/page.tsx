"use client";
import React, { useState, useEffect } from 'react';


async function getLeaderboard(): Promise<any[]> {
  
  const res = await fetch("http://localhost:5000/api/leaderboard", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Fetch leaderboard failed");
  }
  return res.json();
} 


type LeaderboardEntry = {
  id: string;
  rank: number;
  name: string;
  matches: number;
  wpm: number;
  winRate: number;
};


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

// --- 4. Leaderboard Component ---
const LeaderboardDisplay: React.FC = () => {
  // --- State for data, loading, and errors ---
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // --- Fetch data on component mount ---
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data: any[] = await getLeaderboard();
        
        // Map API data to our LeaderboardEntry type, adding rank
        const rankedData = data.map((item, index) => ({
          id: item.id || `user-${index}`, // Ensure a unique key
          rank: index + 1,
          name: item.name || 'Anonymous',
          matches: item.matches || 0,
          wpm: item.wpm || 0,
          winRate: item.winRate || 0,
        }));
        
        setLeaderboard(rankedData);
      } catch (err: any) {
        setError(err.message || "Failed to fetch leaderboard.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, []); // Empty dependency array runs this effect once on mount

  // --- Render Container ---
  return (
    <div className="w-full max-w-4xl mx-auto bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-700">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-6">
          Top 20 Players
        </h1>
      </div>

      {/* --- Conditional Content based on state --- */}
      {isLoading ? (
        <div className="p-10 text-center">
          <p className="text-xl text-gray-300 animate-pulse">Loading Leaderboard...</p>
        </div>
      ) : error ? (
        <div className="p-10 text-center">
          <p className="text-xl text-red-500">Error: {error}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-gray-300">
            {/* Table Header */}
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-1/12">
                  Rank
                </th>
                <th scope="col" className="px-6 py-4 font-semibold text-white w-4/12">
                  Name
                </th>
                <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-2/12">
                  Matches
                </th>
                <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-2/12">
                  WPM
                </th>
                <th scope="col" className="px-6 py-4 font-semibold text-white text-center w-2/1tran-pink-400">
                  Win Rate
                </th>
              </tr>
            </thead>

            {/* Table Body (mapping over fetched data) */}
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
      )}
    </div>
  );
};

// --- 5. Main App Component ---
// This is the default export that renders the leaderboard
export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-8 flex items-center justify-center font-sans">
      <LeaderboardDisplay />
    </div>
  );
}
