"use client";

import { useEffect, useState } from "react";
import { getToken, logout } from "@/lib/auth";
import { getUsername, createLobby, getLobby, joinLobby } from "@/lib/api";
import { useAudio } from "@/lib/sfx";

import {
  Avatar, AvatarIcon, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Button, Card, CardBody, Modal, ModalContent, ModalHeader, ModalBody,
  useDisclosure, Spinner
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { ChevronDown, Users, Gamepad2, Trophy, LogOut, Settings, User, Volume2, VolumeX } from "lucide-react"; 
import CreateLobbyForm from "@/app/components/createLobbyForm"; 
import JoinLobbyForm from "@/app/components/joinLobbyForm";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
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
      const fetchUsername = async () => {
        try {
          const fetchedUsername = await getUsername();
          setUsername(fetchedUsername);
        } catch (error) {
          console.error("Failed to fetch username:", error);
          setUsername("User");
        } finally {
          setLoading(false);
        }
      };
      fetchUsername();
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
      className="relative h-screen w-screen bg-cover bg-center bg-no-repeat flex items-center justify-center p-4"
      style={{ backgroundImage: "url('/mainPage.jpg')" }}
    >
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
             <button 
               className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/80 hover:bg-slate-800/90 transition-colors min-w-[200px] border border-slate-700"
               onClick={handleAvatarClick}
             >
              <Avatar isBordered className="transition-transform flex-shrink-0" color="primary" fallback={<AvatarIcon />} size="md" />
              <div className="flex flex-col items-start grow"> <span className="text-xs text-gray-400">Signed in as</span> <span className="text-sm font-semibold text-white truncate">{username || "User"}</span> </div>
              <ChevronDown size={18} className="text-gray-400 flex-shrink-0" />
            </button>
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


      {/* Main Content Card */}
      <Card className="bg-slate-900/90 max-w-lg w-full text-gray-100 border border-slate-700">
        <CardBody className="p-8">
          <h1 className="text-3xl font-bold mb-8 text-center">
             Welcome, {username}!
          </h1>
          <div className="flex flex-col gap-4 items-center mb-6">
            <Button
              color="primary" 
              variant="solid" 
              className="w-64 font-semibold"
              startContent={<Gamepad2 size={18}/>} 
              onPress={handleCreateLobbyClick}
            >
              Create Lobby
            </Button>

            <Button
              color="primary"
              variant="bordered"
              className="w-64 font-semibold"
              startContent={<Users size={18}/>}
              onPress={handleJoinLobbyClick}
            >
              Join Lobby
            </Button>

            <Button 
              color="primary" 
              variant="bordered" 
              className="w-64 font-semibold" 
              startContent={<Trophy size={18}/>} 
              onPress={handleLeaderboardClick}
            > 
              View Leaderboard 
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Create Lobby Modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center" size="xl"> 
        <ModalContent>
          {(modalOnClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Create New Lobby</ModalHeader>
              <ModalBody>
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
      <Modal isOpen={isJoinOpen} onOpenChange={onJoinOpenChange} placement="center" size="md">
        <ModalContent>
          {(modalOnClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Join Lobby</ModalHeader>
              <ModalBody>
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