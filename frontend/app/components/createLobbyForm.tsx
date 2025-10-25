'use client';

import { useState } from 'react';
import { Button } from '@heroui/react';
import Image from 'next/image';

type Hero = { id: string; name: string; src: string; };
const HEROES: Hero[] = [
  { id: "mech", name: "Robot", src: "/hero1.png" },
  { id: "kaiju", name: "Monster", src: "/hero2.png" },
];

interface CreateLobbyFormProps {
  onSubmit: (heroId: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null; 
}

export default function CreateLobbyForm({ onSubmit, onCancel, isLoading, error }: CreateLobbyFormProps) { 
  const [selectedHero, setSelectedHero] = useState<string | null>(null);

  const handleSubmit = () => {
    if (selectedHero) {
      onSubmit(selectedHero);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Hero selection */}
      <div>
        <p className="text-center text-sm font-semibold tracking-widest text-gray-300 mb-4">
          PICK A CHARACTER
        </p>
        <div className="flex justify-center gap-6">
          {HEROES.map((hero) => (
            <button
              key={hero.id}
              type="button"
              onClick={() => setSelectedHero(hero.id)}
              className={`relative group rounded-xl p-4 border-2 transition-all duration-200 ease-in-out ${
                selectedHero === hero.id
                  ? "border-blue-500 ring-2 ring-blue-500/50 bg-slate-800/70 scale-105"
                  : "border-slate-700 hover:border-slate-500 bg-slate-800/40 hover:scale-105"
              }`}
            >
              <div className="relative w-28 h-28 sm:w-32 sm:h-32">
                <Image src={hero.src} alt={hero.name} fill className="object-contain" sizes="(max-width: 640px) 112px, 128px" />
              </div>
              <p className={`mt-3 text-center text-base sm:text-lg font-semibold transition-colors ${
                  selectedHero === hero.id ? "text-blue-400" : "text-gray-300"
                }`}
              >
                {hero.name}
              </p>
            </button>
          ))}
        </div>
      </div>

       {/* 3. Display error message */}
       {error && (
         <p className="text-red-500 text-sm text-center -mt-2 mb-2">{error}</p>
       )}

      {/* Submit/Cancel Buttons */}
      <div className="flex justify-end gap-2 mt-4">
         <Button color="danger" variant="light" onPress={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
           color="primary"
           onPress={handleSubmit}
           isLoading={isLoading}
           isDisabled={!selectedHero || isLoading}
        >
          Create Lobby
        </Button>
      </div>
    </div>
  );
}