"use client";

import { useEffect, useState } from "react";
import { getToken, logout } from "@/lib/auth";
import { getUsername, createLobby, getLobby, joinLobby, fetchUserProfile, getLeaderboard } from "@/lib/api";
import { useAudio } from "@/lib/sfx";
import { motion } from "framer-motion";

import {
  Avatar, AvatarIcon, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Button, Card, CardBody, Modal, ModalContent, ModalHeader, ModalBody,
  useDisclosure, Spinner
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { ChevronDown, Users, Gamepad2, Trophy, LogOut, Settings, User, Volume2, VolumeX } from "lucide-react"; 
import CreateLobbyForm from "@/app/components/createLobbyForm"; 
import JoinLobbyForm from "@/app/components/joinLobbyForm";

type UserStats = {
  avgWPM: number;
  peakWPM: number;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
};

type UserProfile = {
  id: string;
  username: string;
  email: string;
  stats: UserStats;
};

type LeaderboardEntry = {
  username: string;
  avatarUrl?: string;
  avgWPM: number;
  peakWPM: number;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: number;
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const router = useRouter();
  const { playKeypressSound, isMuted, toggleMute } = useAudio(); 
  const {isOpen, onOpen, onOpenChange, onClose} = useDisclosure();
  const [isCreatingLobby, setIsCreatingLobby] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);  

  const {
    isOpen: isJoinOpen,
    onOpen: onJoinOpen,
    onOpenChange: onJoinOpenChange
  } = useDisclosure();
  const [isJoiningLobby, setIsJoiningLobby] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
    } else {
      const fetchData = async () => {
        try {
          // Fetch user profile
          const profile = await fetchUserProfile(token);
          setUserProfile(profile);
          setUsername(profile.username);

          // Fetch leaderboard
          const leaderboardData = await getLeaderboard();
          setLeaderboard(leaderboardData.slice(0, 5)); // Top 5 players
        } catch (error) {
          console.error("Failed to fetch dashboard data:", error);
          setUsername("User");
        } finally {
          setLoading(false);
        }
      };
      fetchData();
    }
  }, [router]);

  if (loading || username === null) {
    return (
      
      <div
        className="relative h-screen w-screen bg-cover bg-center bg-no-repeat flex items-center justify-center p-4"
        style={{ backgroundImage: "url('/mainPage.jpg')" }}
      >
        
        <div className="absolute inset-0 bg-black/30 z-0"></div>
      
        <div className="z-10">
          <Spinner label="Loading Dashboard..." color="primary" labelColor="primary" size="lg"/>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    playKeypressSound();
    logout();
    router.push("/login");
  };

  const handleCreateLobbyClick = () => {
    console.log("Create lobby clicked, playing sound..."); 
    playKeypressSound();
    onOpen();
  };

  const handleJoinLobbyClick = () => {
    playKeypressSound();
    onJoinOpen();
  };

  const handleLeaderboardClick = () => {
    playKeypressSound();
    router.push("/leaderboard");
  };

  const handleSettingsClick = () => {
    playKeypressSound();
    router.push("/settings");
  };

  const handleViewProfileClick = () => {
    playKeypressSound();
    router.push("/profile");
  };

  const handleAvatarClick = () => {
    playKeypressSound();
  };

  const handleLobbyCreateSubmit = async (heroId: string) => {
    setIsCreatingLobby(true);
    console.log("Attempting to create lobby with hero:", heroId);
    try {
      const lobbyData = await createLobby(heroId, 2);

      if (lobbyData && lobbyData.code) {
        const lobbyCode = lobbyData.code;
        console.log("Lobby created with code:", lobbyCode);
        onClose(); 
        
        router.push(`/lobby/${lobbyCode}`);
      } else {
        
         console.error("Lobby created, but no code received from backend.");
         throw new Error("Failed to get lobby code from server.");
      }

    } catch (error: any) { 
      console.error("Failed to create lobby:", error);
      setModalError(error.message || "Could not create lobby. Please try again.");
    } finally {
      setIsCreatingLobby(false);
    }
  };

  const handleJoinSubmit = async (code: string) => {
    try {
      setJoinError(null);
      setIsJoiningLobby(true);
      await joinLobby(code);
      
      router.push(`/lobby/${code}`);
    } catch (err: any) {
      setJoinError(err?.message || "Invalid or unavailable code.");
    } finally {
      setIsJoiningLobby(false);
    }
  };

  return (
    <div
      className="relative min-h-screen w-screen bg-cover bg-center bg-no-repeat p-6"
      style={{ backgroundImage: "url('/mainPage.jpg')" }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40 z-0"></div>

      {/* Mute/Unmute Button (TOP LEFT) */}
      <div className="absolute top-4 left-4 z-10">
        <Button
          isIconOnly
          color="primary"
          variant="flat"
          onPress={() => {
            console.log("Mute button clicked. Current state:", isMuted);
            toggleMute();
          }}
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </Button>
      </div>

      {/* Avatar Dropdown (TOP RIGHT) */}
      <div className="absolute top-4 right-4 z-10">
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <motion.button 
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 hover:from-slate-800/95 hover:via-slate-700/95 hover:to-slate-800/95 transition-all duration-300 border-2 border-cyan-500/50 backdrop-blur-sm shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-105"
              onClick={handleAvatarClick}
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <Avatar 
                isBordered 
                color="primary" 
                fallback={<AvatarIcon />} 
                size="md" 
                className="w-10 h-10"
              />
              <div className="flex flex-col items-start">
                <span className="text-cyan-300 font-bold text-sm tracking-wide" style={{ fontFamily: "'Courier New', monospace" }}>
                  {username || "User"}
                </span>
                <span className="text-gray-400 text-xs" style={{ fontFamily: "'Courier New', monospace" }}>
                  Level 1 • {userProfile?.stats?.totalMatches ?? 0} Matches
                </span>
              </div>
              <ChevronDown size={18} className="text-cyan-400" />
            </motion.button>
          </DropdownTrigger>
          <DropdownMenu aria-label="Profile Actions" variant="flat">
            <DropdownItem 
              key="settings" 
              startContent={<Settings size={18} />} 
              onPress={handleSettingsClick}
            > 
              Settings 
            </DropdownItem>
            <DropdownItem 
              key="viewProfile" 
              startContent={<User size={18} />} 
              onPress={handleViewProfileClick}
            > 
              View Profile 
            </DropdownItem>
            <DropdownItem 
              key="logout" 
              color="danger" 
              startContent={<LogOut size={18} />} 
              onPress={handleLogout}
            > 
              Log Out 
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>

      {/* Main Content - relative z-10 to stay above overlay */}
      <div className="relative z-10 max-w-7xl mx-auto pt-20">
        {/* Header */}
        <motion.div 
          className="mb-8 text-center"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h1 
            className="text-6xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-rose-400"
            style={{ fontFamily: "'Courier New', monospace" }}
          >
            GAME HUB
          </h1>
          <p className="text-gray-400 text-sm tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>
            Welcome back, <span className="text-cyan-300 font-semibold">{username}</span>
          </p>
        </motion.div>

        {/* 3-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* LEFT COLUMN - Stats & Profile */}
          <motion.div 
            className="space-y-6"
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* Player Stats Card */}
            <Card className="bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 border-2 border-cyan-500/50 backdrop-blur-sm shadow-xl shadow-cyan-500/20">
              <CardBody className="p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="relative">
                    <Avatar isBordered color="primary" fallback={<AvatarIcon />} size="lg" className="w-16 h-16" />
                    <div className="absolute -bottom-1 -right-1 bg-gradient-to-br from-cyan-400 to-cyan-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-slate-900">
                      1
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-cyan-300" style={{ fontFamily: "'Courier New', monospace" }}>
                      {username}
                    </h3>
                    <p className="text-gray-400 text-sm">Level 1 Warrior</p>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="space-y-3">
                  <motion.div 
                    className="bg-slate-800/60 rounded-lg p-3 border border-cyan-500/30"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-cyan-400/70 text-xs" style={{ fontFamily: "'Courier New', monospace" }}>AVG WPM</span>
                      <motion.span 
                        className="text-white font-bold text-xl"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                      >
                        {userProfile?.stats?.avgWPM ?? 0}
                      </motion.span>
                    </div>
                  </motion.div>
                  <motion.div 
                    className="bg-slate-800/60 rounded-lg p-3 border border-cyan-500/30"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-cyan-400/70 text-xs" style={{ fontFamily: "'Courier New', monospace" }}>TOTAL MATCHES</span>
                      <motion.span 
                        className="text-white font-bold text-xl"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6 }}
                      >
                        {userProfile?.stats?.totalMatches ?? 0}
                      </motion.span>
                    </div>
                  </motion.div>
                  <motion.div 
                    className="bg-slate-800/60 rounded-lg p-3 border border-cyan-500/30"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-cyan-400/70 text-xs" style={{ fontFamily: "'Courier New', monospace" }}>WIN RATE</span>
                      <motion.span 
                        className="text-white font-bold text-xl"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.7 }}
                      >
                        {userProfile?.stats?.winRate?.toFixed(0) ?? 0}%
                      </motion.span>
                    </div>
                  </motion.div>
                </div>
              </CardBody>
            </Card>

            {/* Quick Settings */}
            <Card className="bg-slate-900/90 border border-slate-700 backdrop-blur-sm">
              <CardBody className="p-4">
                <h4 className="text-sm font-bold text-gray-300 mb-3" style={{ fontFamily: "'Courier New', monospace" }}>QUICK ACCESS</h4>
                <div className="space-y-2">
                  <Button
                    size="sm"
                    variant="flat"
                    className="w-full justify-start"
                    startContent={<Settings size={16} />}
                    onPress={handleSettingsClick}
                  >
                    Settings
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    className="w-full justify-start"
                    startContent={<User size={16} />}
                    onPress={handleViewProfileClick}
                  >
                    View Profile
                  </Button>
                </div>
              </CardBody>
            </Card>
          </motion.div>

          {/* MIDDLE COLUMN - Quick Actions & Recent Matches */}
          <motion.div 
            className="space-y-6"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {/* Action Buttons */}
            <Card className="bg-gradient-to-br from-purple-900/40 via-slate-900/90 to-slate-900/90 border-2 border-purple-500/50 backdrop-blur-sm shadow-xl">
              <CardBody className="p-6">
                <h3 className="text-lg font-bold text-purple-300 mb-4" style={{ fontFamily: "'Courier New', monospace" }}>QUICK ACTIONS</h3>
                <div className="space-y-3">
                  <Button
                    color="primary"
                    variant="solid"
                    size="lg"
                    className="w-full font-bold text-lg shadow-lg shadow-cyan-500/30 uppercase"
                    startContent={<Gamepad2 size={20} />}
                    onPress={handleCreateLobbyClick}
                    style={{ fontFamily: "'Courier New', monospace" }}
                  >
                    Create Lobby
                  </Button>
                  <Button
                    color="primary"
                    variant="bordered"
                    size="lg"
                    className="w-full font-bold text-lg uppercase"
                    startContent={<Users size={20} />}
                    onPress={handleJoinLobbyClick}
                    style={{ fontFamily: "'Courier New', monospace" }}
                  >
                    Join Lobby
                  </Button>
                </div>
              </CardBody>
            </Card>

            {/* Recent Matches */}
            <Card className="bg-slate-900/90 border border-slate-700 backdrop-blur-sm">
              <CardBody className="p-6">
                <h3 className="text-lg font-bold text-gray-300 mb-4" style={{ fontFamily: "'Courier New', monospace" }}>RECENT MATCHES</h3>
                <div className="space-y-3">
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-700">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-gray-400 text-xs">No recent matches</p>
                        <p className="text-gray-500 text-xs mt-1">Play your first game!</p>
                      </div>
                      <Trophy size={24} className="text-gray-600" />
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </motion.div>

          {/* RIGHT COLUMN - Leaderboard & Social */}
          <motion.div 
            className="space-y-6"
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {/* Leaderboard Preview */}
            <Card className="bg-gradient-to-br from-rose-900/40 via-slate-900/90 to-slate-900/90 border-2 border-rose-500/50 backdrop-blur-sm shadow-xl shadow-rose-500/20">
              <CardBody className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-rose-300" style={{ fontFamily: "'Courier New', monospace" }}>TOP PLAYERS</h3>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    onPress={handleLeaderboardClick}
                  >
                    View All
                  </Button>
                </div>
                <div className="space-y-2">
                  {leaderboard.length > 0 ? (
                    leaderboard.slice(0, 3).map((player, index) => (
                      <motion.div 
                        key={index} 
                        className="bg-slate-800/60 rounded-lg p-3 border border-rose-500/30 flex items-center gap-3"
                        initial={{ x: 50, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.5 + index * 0.1 }}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500' :
                          index === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-gray-900' :
                          'bg-gradient-to-br from-orange-600 to-orange-700'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="text-white font-semibold text-sm">{player.username}</p>
                          <p className="text-gray-400 text-xs">{player.avgWPM} WPM</p>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className="bg-slate-800/60 rounded-lg p-3 border border-rose-500/30">
                      <p className="text-gray-400 text-xs text-center">No players yet</p>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Online Friends / Live Lobbies */}
            <Card className="bg-slate-900/90 border border-slate-700 backdrop-blur-sm">
              <CardBody className="p-6">
                <h3 className="text-lg font-bold text-gray-300 mb-4" style={{ fontFamily: "'Courier New', monospace" }}>LIVE LOBBIES</h3>
                <div className="space-y-3">
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-700">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-gray-400 text-xs">No active lobbies</p>
                        <p className="text-gray-500 text-xs mt-1">Create one to get started!</p>
                      </div>
                      <div className="w-2 h-2 bg-gray-600 rounded-full"></div>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </motion.div>

        </div>
      </div>

      {/* Create Lobby Modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center" size="xl" className="bg-slate-900">
        <ModalContent className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-purple-500/50">
          {(modalOnClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1 border-b border-purple-500/30 pb-4">
                <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400" style={{ fontFamily: "'Courier New', monospace" }}>
                  CREATE NEW LOBBY
                </h2>
              </ModalHeader>
              <ModalBody className="py-6">
                <CreateLobbyForm
                  onSubmit={handleLobbyCreateSubmit}
                  onCancel={() => { 
                    playKeypressSound();
                    setModalError(null); 
                    modalOnClose(); 
                  }} 
                  isLoading={isCreatingLobby}
                  error={modalError}
                 />
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Join Lobby Modal */}
      <Modal isOpen={isJoinOpen} onOpenChange={onJoinOpenChange} placement="center" size="md" className="bg-slate-900">
        <ModalContent className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-purple-500/50">
          {(modalOnClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1 border-b border-purple-500/30 pb-4">
                <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400" style={{ fontFamily: "'Courier New', monospace" }}>
                  JOIN LOBBY
                </h2>
              </ModalHeader>
              <ModalBody className="py-6">
                <JoinLobbyForm
                  onSubmit={handleJoinSubmit}
                  onCancel={() => {
                    playKeypressSound();
                    setJoinError(null);
                    modalOnClose();
                  }}
                  isLoading={isJoiningLobby}
                  error={joinError}
                />
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>

    </div>
  );
}