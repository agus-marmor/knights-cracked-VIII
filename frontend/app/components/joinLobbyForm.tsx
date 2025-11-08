'use client';

import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { motion } from 'framer-motion';
import { useAudio } from '@/lib/sfx';

interface JoinLobbyFormProps {
  onSubmit: (code: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export default function JoinLobbyForm({
  onSubmit,
  onCancel,
  isLoading,
  error,
}: JoinLobbyFormProps) {
  const [code, setCode] = useState('');
  const { playKeypressSound } = useAudio();

  const normalized = (s: string) =>
    s.replace(/\s+/g, '').toUpperCase();

  const handleSubmit = () => {
    playKeypressSound();
    const cleaned = normalized(code);
    if (cleaned.length > 0) onSubmit(cleaned);
  };

  const handleCancel = () => {
    playKeypressSound();
    onCancel();
  };

  return (
    <div className="flex flex-col gap-6 p-2">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <p className="text-center text-sm font-bold tracking-widest text-purple-300 mb-6" style={{ fontFamily: "'Courier New', monospace" }}>
          ENTER LOBBY CODE
        </p>
        
        {/* Code Input */}
        <div className="relative">
          {/* Decorative corner accents */}
          <div className="absolute -top-2 -left-2 w-6 h-6 border-t-2 border-l-2 border-cyan-400/50 rounded-tl z-10" />
          <div className="absolute -top-2 -right-2 w-6 h-6 border-t-2 border-r-2 border-cyan-400/50 rounded-tr z-10" />
          
          <Input
            aria-label="Lobby code"
            placeholder="ABC123"
            value={code}
            onValueChange={setCode}
            isDisabled={isLoading}
            size="lg"
            variant="bordered"
            classNames={{
              inputWrapper:
                'bg-slate-800/60 border-2 border-purple-500/50 hover:border-cyan-500/70 focus-within:border-cyan-500 backdrop-blur-sm transition-all duration-300 h-16',
              input: 'tracking-[0.3em] uppercase text-center text-2xl font-bold text-cyan-300',
            }}
            style={{ fontFamily: "'Courier New', monospace" }}
            autoFocus
          />
          
          {/* Bottom decorative accents */}
          <div className="absolute -bottom-2 -left-2 w-6 h-6 border-b-2 border-l-2 border-purple-400/50 rounded-bl z-10" />
          <div className="absolute -bottom-2 -right-2 w-6 h-6 border-b-2 border-r-2 border-purple-400/50 rounded-br z-10" />
        </div>

        {/* Helper text */}
        <p className="text-center text-xs text-gray-500 mt-3" style={{ fontFamily: "'Courier New', monospace" }}>
          Enter the 6-character code from your friend
        </p>
      </motion.div>

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
          isDisabled={!code.trim() || isLoading}
          className="font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 shadow-lg shadow-cyan-500/30"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          {isLoading ? "Joining..." : "Join Lobby"}
        </Button>
      </div>
    </div>
  );
}
