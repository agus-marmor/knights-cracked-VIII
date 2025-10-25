'use client';

import { useState } from 'react';
import { Button, Input } from '@heroui/react';

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

  const normalized = (s: string) =>
    s.replace(/\s+/g, '').toUpperCase();

  const handleSubmit = () => {
    const cleaned = normalized(code);
    if (cleaned.length > 0) onSubmit(cleaned);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-center text-sm font-semibold tracking-widest text-gray-300 mb-4">
          ENTER LOBBY CODE
        </p>
        <Input
          aria-label="Lobby code"
          placeholder="e.g. ABC123"
          value={code}
          onValueChange={setCode}
          isDisabled={isLoading}
          size="lg"
          variant="bordered"
          classNames={{
            inputWrapper:
              'bg-slate-800/40 border-slate-700 hover:border-slate-500',
            input: 'tracking-widest uppercase text-center',
          }}
          autoFocus
        />
      </div>

      {error && (
        <p className="text-red-500 text-sm text-center -mt-2 mb-2">{error}</p>
      )}

      <div className="flex justify-end gap-2 mt-2">
        <Button color="danger" variant="light" onPress={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          color="primary"
          onPress={handleSubmit}
          isLoading={isLoading}
          isDisabled={!code.trim() || isLoading}
        >
          Join Lobby
        </Button>
      </div>
    </div>
  );
}
