'use client';
import { useState } from 'react';
import { Button } from '@heroui/react';
import Image from 'next/image';
import { useAudio } from '@/lib/sfx';
import { motion } from 'framer-motion';

type Hero = { id: string; name: string; src: string; };

const HEROES: Hero[] = [
  { id: "mech", name: "Robot", src: "/mech.png" },
  { id: "kaiju", name: "Monster", src: "/kaiju.png" },
];

interface CreateLobbyFormProps {
  onSubmit: (heroId: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export default function CreateLobbyForm({ onSubmit, onCancel, isLoading, error }: CreateLobbyFormProps) {
  const [selectedHero, setSelectedHero] = useState<string | null>(null);
  const { playKeypressSound } = useAudio(); 

  const handleSubmit = () => {
    playKeypressSound(); 
    if (selectedHero) {
      onSubmit(selectedHero);
    }
  };

  const handleCancel = () => {
    playKeypressSound(); 
    onCancel();
  };

  const handleHeroSelect = (heroId: string) => {
    playKeypressSound(); 
    setSelectedHero(heroId);
  };

  return (
    <div className="flex flex-col gap-6 p-2">
      {/* Hero selection */}
      <div>
        <p className="text-center text-sm font-bold tracking-widest text-purple-300 mb-6" style={{ fontFamily: "'Courier New', monospace" }}>
          SELECT YOUR CHARACTER
        </p>
        <div className="flex justify-center gap-6">
          {HEROES.map((hero, index) => (
            <motion.button
              key={hero.id}
              type="button"
              onClick={() => handleHeroSelect(hero.id)}
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: index * 0.1, type: "spring", stiffness: 200 }}
              whileHover={{ scale: 1.05, y: -5 }}
              whileTap={{ scale: 0.95 }}
              className={`relative group rounded-xl p-6 border-2 transition-all duration-300 ${
                selectedHero === hero.id
                  ? "border-cyan-500 ring-2 ring-cyan-500/50 bg-gradient-to-br from-cyan-900/30 to-slate-800/70 shadow-lg shadow-cyan-500/30"
                  : "border-slate-700 hover:border-purple-500/50 bg-slate-800/40 hover:bg-slate-700/50"
              }`}
            >
              {/* Corner accent for selected */}
              {selectedHero === hero.id && (
                <>
                  <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-2 border-l-2 border-cyan-400 rounded-tl" />
                  <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-2 border-r-2 border-cyan-400 rounded-tr" />
                </>
              )}
              
              <div className="relative w-32 h-32 sm:w-36 sm:h-36">
                {/* Glow effect when selected */}
                {selectedHero === hero.id && (
                  <div className="absolute inset-0 bg-cyan-500/20 rounded-lg blur-xl" />
                )}
                <Image 
                  src={hero.src} 
                  alt={hero.name} 
                  fill 
                  className="object-contain drop-shadow-2xl relative z-10" 
                  sizes="(max-width: 640px) 128px, 144px" 
                />
              </div>
              
              <p className={`mt-4 text-center text-lg font-bold transition-colors uppercase tracking-wide ${
                selectedHero === hero.id ? "text-cyan-300" : "text-gray-400 group-hover:text-purple-300"
              }`}
              style={{ fontFamily: "'Courier New', monospace" }}
              >
                {hero.name}
              </p>

              {/* Selection indicator */}
              {selectedHero === hero.id && (
                <motion.div 
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3/4 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent rounded-full"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.3 }}
                />
              )}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Display error message */}
      {error && (
        <motion.p 
          className="text-rose-400 text-sm text-center bg-rose-900/20 border border-rose-500/30 rounded-lg p-3"
          style={{ fontFamily: "'Courier New', monospace" }}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.p>
      )}

      {/* Submit/Cancel Buttons */}
      <div className="flex justify-end gap-3 mt-4">
        <Button 
          color="danger" 
          variant="bordered"
          onPress={handleCancel} 
          disabled={isLoading}
          className="font-bold uppercase tracking-wider"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          Cancel
        </Button>
        <Button
          color="primary"
          onPress={handleSubmit}
          isLoading={isLoading}
          isDisabled={!selectedHero || isLoading}
          className="font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 shadow-lg shadow-cyan-500/30"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          {isLoading ? "Creating..." : "Create Lobby"}
        </Button>
      </div>
    </div>
  );
}