import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,  
  ReactNode
} from 'react';

// --- Placeholder sound effect paths ---
// You would place these in your /public folder
const KEYPRESS_SOUND_SRC = 'keyboard-click-327728.mp3'; // <-- UPDATED
const WIN_SOUND_SRC = 'tadaa-47995.mp3'; // <-- UPDATED
const JOIN_SOUND_SRC = 'Joined Lobby.mp3'; // <-- UPDATED
const MUSIC_SRC = 'big-beat-loop-275479.mp3'; // <-- UPDATED

// 1. Define the "shape" of your context
type AudioContextType = {
  isMuted: boolean;
  toggleMute: () => void;
  playKeypressSound: () => void;
  playWinSound: () => void;
  playJoinSound: () => void; // <-- CHANGED
};

// 2. Create the Context
const AudioContext = createContext<AudioContextType | undefined>(undefined);

// 3. Create the Provider (the component that does the work)
export const AudioProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isMuted, setIsMuted] = useState(true);

  // Refs for your audio elements
  const bgMusicRef = useRef<HTMLAudioElement>(null);
  const keypressSoundRef = useRef<HTMLAudioElement | null>(null);
  const winSoundRef = useRef<HTMLAudioElement | null>(null);
  const joinSoundRef = useRef<HTMLAudioElement | null>(null); // <-- CHANGED

  // --- Background Music Control ---
  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (bgMusicRef.current) {
      bgMusicRef.current.muted = nextMuted;
      // Autoplay is often blocked until user interaction
      bgMusicRef.current.play().catch(e => console.error("Audio play failed:", e));
    }
  }, [isMuted]); // <-- FIX: Changed isMMuted to isMuted

  // --- Sound Effect Controls ---
  // We use a function to load/play on demand
  // FIX: Changed parameter type to allow for 'null'
  const playSound = (ref: React.RefObject<HTMLAudioElement | null>) => { 
    if (!isMuted && ref.current) {
      ref.current.currentTime = 0; // Rewind
      ref.current.play().catch(e => console.error("SFX play failed:", e));
    }
  };

  const playKeypressSound = useCallback(() => playSound(keypressSoundRef), [isMuted]);
  const playWinSound = useCallback(() => playSound(winSoundRef), [isMuted]);
  const playJoinSound = useCallback(() => playSound(joinSoundRef), [isMuted]); // <-- CHANGED
  
  // Load SFX on the client
  useEffect(() => {
    keypressSoundRef.current = new Audio(KEYPRESS_SOUND_SRC);
    winSoundRef.current = new Audio(WIN_SOUND_SRC);
    joinSoundRef.current = new Audio(JOIN_SOUND_SRC); // <-- CHANGED
    
    // Preload them
    keypressSoundRef.current.preload = 'auto';
    winSoundRef.current.preload = 'auto';
    joinSoundRef.current.preload = 'auto'; // <-- CHANGED
  }, []);

  const value = {
    isMuted,
    toggleMute,
    playKeypressSound,
    playWinSound,
    playJoinSound // <-- CHANGED
  };

  return (
    <AudioContext.Provider value={value}>
      {/* Background music is always here */}
      <audio ref={bgMusicRef} src={MUSIC_SRC} loop autoPlay muted />
      {/* We use new Audio() for SFX so we don't need <audio> tags for them.
        This is better for playing sounds overlapping/rapidly.
      */}
      {children}
    </AudioContext.Provider>
  );
};

// 4. Create a custom hook to easily use the context
export const useAudio = () => {
  const context = useContext(AudioContext);
  if (context === undefined) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
};

