"use client";

import React, { useState, useEffect } from 'react';
import { Trophy, Zap, Clock, ArrowLeft, User, TrendingUp, Target, Award, ChevronUp, ChevronDown } from 'lucide-react';

// Types
type LeaderboardEntry = {
  username: string;
  avatarUrl: string;
  averageWPM: number;
  peakWPM: number;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: number;
};

type SortKey = 'rank' | 'avgWPM' | 'peakWPM' | 'winRate' | 'totalMatches';
type SortDirection = 'asc' | 'desc';

// Mock Data Generator 
const generateMockData = (): LeaderboardEntry[] => {
  const names = ['SpeedDemon', 'KeyboardWarrior', 'TypeMaster', 'FastFingers', 'QuickTyper', 
                 'RacerPro', 'SwiftKeys', 'TurboTypist', 'NitroRacer', 'BlazingKeys',
                 'VelocityKing', 'RapidFire', 'LightningHands', 'ThunderType', 'FlashTyper'];
  
  return names.map((name, i) => {
    const totalMatches = Math.floor(Math.random() * 200) + 20;
    const wins = Math.floor(Math.random() * totalMatches);
    const losses = totalMatches - wins;
    const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;
    
    return {
      username: name,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      averageWPM: Math.random() * 80 + 40,
      peakWPM: Math.random() * 120 + 60,
      wins,
      losses,
      totalMatches,
      winRate
    };
  }).sort((a, b) => b.averageWPM - a.averageWPM);
};

// Helper Functions 
const getRankClass = (rank: number): string => {
  switch (rank) {
    case 1:
      return 'text-yellow-400 font-black text-2xl drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]';
    case 2:
      return 'text-slate-300 font-black text-xl drop-shadow-[0_0_6px_rgba(203,213,225,0.4)]';
    case 3:
      return 'text-amber-600 font-bold text-lg drop-shadow-[0_0_6px_rgba(217,119,6,0.4)]';
    default:
      return 'text-slate-400 font-semibold';
  }
};

const getRankBadge = (rank: number) => {
  if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-400 animate-pulse" />;
  if (rank === 2) return <Award className="w-5 h-5 text-slate-300" />;
  if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />;
  return null;
};

// Main Leaderboard Component 
function LeaderboardDisplay() {
  const [data, setData] = useState<LeaderboardEntry[] | null>(null);
  const [sortedData, setSortedData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        setLoading(true);
        setError(null);
        // Simulating API call with mock data
        await new Promise(resolve => setTimeout(resolve, 800));
        const result = generateMockData();
        setData(result);
        setSortedData(result);
      } catch (e: any) {
        console.error("Leaderboard fetch failed:", e);
        setError("Failed to load leaderboard data.");
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, []);

  // Sorting logic
  const handleSort = (key: SortKey) => {
    const newDirection = sortKey === key && sortDirection === 'desc' ? 'asc' : 'desc';
    setSortKey(key);
    setSortDirection(newDirection);

    const sorted = [...(data || [])].sort((a, b) => {
      let aVal: number, bVal: number;
      
      if (key === 'rank') {
        aVal = data?.indexOf(a) ?? 0;
        bVal = data?.indexOf(b) ?? 0;
      } else if (key === 'avgWPM') {
        aVal = a.averageWPM;
        bVal = b.averageWPM;
      } else if (key === 'peakWPM') {
        aVal = a.peakWPM;
        bVal = b.peakWPM;
      } else if (key === 'winRate') {
        aVal = a.winRate;
        bVal = b.winRate;
      } else {
        aVal = a.totalMatches;
        bVal = b.totalMatches;
      }

      return newDirection === 'desc' ? bVal - aVal : aVal - bVal;
    });

    setSortedData(sorted);
  };

  const SortButton = ({ column, label }: { column: SortKey; label: string }) => (
    <button
      onClick={() => handleSort(column)}
      className="flex items-center justify-center gap-1 hover:text-blue-400 transition-colors group w-full"
    >
      <span>{label}</span>
      <div className="flex flex-col opacity-40 group-hover:opacity-100 transition-opacity">
        <ChevronUp 
          className={`w-3 h-3 -mb-1 ${sortKey === column && sortDirection === 'asc' ? 'text-blue-400' : ''}`} 
        />
        <ChevronDown 
          className={`w-3 h-3 ${sortKey === column && sortDirection === 'desc' ? 'text-blue-400' : ''}`} 
        />
      </div>
    </button>
  );

  if (loading) {
    return (
      <div className="max-w-6xl w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/50 rounded-2xl p-12 shadow-2xl">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 text-lg font-medium">Loading Leaderboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl w-full bg-gradient-to-br from-slate-900 to-red-950 border border-red-700/50 rounded-2xl p-8 text-center shadow-2xl">
        <div className="text-red-400">
          <p className="text-2xl font-bold mb-2">⚠️ Error</p>
          <p className="mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-semibold"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!sortedData || sortedData.length === 0) {
    return (
      <div className="max-w-6xl w-full bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700/50 rounded-2xl p-12 text-center shadow-2xl">
        <Trophy className="w-16 h-16 text-slate-600 mx-auto mb-4" />
        <p className="text-xl font-semibold text-slate-400 mb-2">No Data Available</p>
        <p className="text-slate-500">Start playing matches to see your ranking!</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden backdrop-blur-sm">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900/40 via-purple-900/40 to-blue-900/40 border-b border-slate-700/50 p-6">
        <div className="flex justify-between items-center">
          <button 
            onClick={() => window.history.back()}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
            aria-label="Back to Dashboard"
          >
            <ArrowLeft size={24} className="text-slate-400" />
          </button>
          
          <div className="flex items-center gap-3">
            <Trophy size={32} className="text-yellow-400 drop-shadow-[0_0_12px_rgba(250,204,21,0.5)]" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              GLOBAL LEADERBOARD
            </h1>
          </div>
          
          <div className="w-10"></div>
        </div>
      </div>
      
      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4 p-6 bg-slate-800/30">
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <TrendingUp className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Total Racers</p>
            <p className="text-xl font-bold text-white">{sortedData.length}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Zap className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Avg Speed</p>
            <p className="text-xl font-bold text-white">
              {(sortedData.reduce((sum, e) => sum + e.averageWPM, 0) / sortedData.length).toFixed(1)} WPM
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <div className="p-2 bg-emerald-500/20 rounded-lg">
            <Target className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Top Speed</p>
            <p className="text-xl font-bold text-white">
              {Math.max(...sortedData.map(e => e.peakWPM)).toFixed(1)} WPM
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/80 border-b border-slate-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-4 text-center w-20">
                <SortButton column="rank" label="#" />
              </th>
              <th className="px-6 py-4 text-left">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Player</span>
              </th>
              <th className="px-4 py-4 text-center">
                <SortButton column="avgWPM" label="AVG WPM" />
              </th>
              <th className="px-4 py-4 text-center">
                <SortButton column="peakWPM" label="PEAK WPM" />
              </th>
              <th className="px-4 py-4 text-center">
                <SortButton column="winRate" label="WIN RATE" />
              </th>
              <th className="px-4 py-4 text-center">
                <SortButton column="totalMatches" label="MATCHES" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((entry, index) => {
              const originalRank = data?.indexOf(entry)! + 1;
              
              return (
                <tr 
                  key={entry.username}
                  className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-all duration-200 group"
                >
                  {/* Rank */}
                  <td className="px-4 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {getRankBadge(originalRank)}
                      <span className={getRankClass(originalRank)}>
                        {originalRank}
                      </span>
                    </div>
                  </td>

                  {/* Player */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <img 
                          src={entry.avatarUrl} 
                          alt={entry.username}
                          className={`w-12 h-12 rounded-full border-2 ${
                            originalRank <= 3 ? 'border-yellow-400 shadow-lg shadow-yellow-400/30' : 'border-slate-600'
                          } group-hover:scale-110 transition-transform`}
                        />
                        {originalRank <= 3 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center text-xs font-bold text-slate-900">
                            {originalRank}
                          </div>
                        )}
                      </div>
                      <span className="font-bold text-white text-lg group-hover:text-blue-400 transition-colors">
                        {entry.username}
                      </span>
                    </div>
                  </td>

                  {/* Avg WPM */}
                  <td className="px-4 py-4 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-lg border border-blue-500/30">
                      <Zap className="w-4 h-4 text-blue-400" />
                      <span className="font-mono font-bold text-lg text-blue-400">
                        {entry.averageWPM.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  
                  {/* Peak WPM */}
                  <td className="px-4 py-4 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 rounded-lg border border-purple-500/30">
                      <TrendingUp className="w-4 h-4 text-purple-400" />
                      <span className="font-mono font-semibold text-purple-400">
                        {entry.peakWPM.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  
                  {/* Win Rate */}
                  <td className="px-4 py-4 text-center">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border ${
                      entry.winRate >= 60 ? 'bg-emerald-500/10 border-emerald-500/30' :
                      entry.winRate >= 40 ? 'bg-yellow-500/10 border-yellow-500/30' :
                      'bg-red-500/10 border-red-500/30'
                    }`}>
                      <Target className={`w-4 h-4 ${
                        entry.winRate >= 60 ? 'text-emerald-400' :
                        entry.winRate >= 40 ? 'text-yellow-400' :
                        'text-red-400'
                      }`} />
                      <span className={`font-bold ${
                        entry.winRate >= 60 ? 'text-emerald-400' :
                        entry.winRate >= 40 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {entry.winRate}%
                      </span>
                    </div>
                  </td>

                  {/* Total Matches */}
                  <td className="px-4 py-4 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-700/30 rounded-lg">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-300 font-medium">
                        {entry.totalMatches}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}

// Page Export
export default function LeaderboardPage() {
  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950"
    >
      <LeaderboardDisplay />
    </div>
  );
}