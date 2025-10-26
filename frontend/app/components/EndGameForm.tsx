'use client';
import { Button, Divider } from '@heroui/react';
import { useAudio } from '@/lib/sfx';

export type EndGameStats = {
  myWpm: number;
  myAcc: number;
  oppWpm: number;
  oppAcc: number;
  iWon: boolean;
  roomCode: string;
};

interface EndGameFormProps {
  stats: EndGameStats;
  onRematch: () => void;
  onNewLobby: () => void;
  onLeave: () => void;
  onCopyRoom: () => void;
  isRematching?: boolean;
  error?: string | null;
}

export default function EndGameForm({
  stats,
  onRematch,
  onNewLobby,
  onLeave,
  onCopyRoom,
  isRematching,
  error
}: EndGameFormProps) {
  const { playKeypressSound } = useAudio();

  const Row = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex justify-between text-sm">
      <span className="opacity-80">{label}</span>
      <b>{value}</b>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h3 className="text-xl font-semibold">
          {stats.iWon ? '🏆 You Win!' : 'Good Game!'}
        </h3>
        <p className="text-xs opacity-70 mt-1">Room: <span className="font-mono">{stats.roomCode}</span></p>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2">
        <Row label="Your WPM" value={stats.myWpm} />
        <Row label="Your Accuracy" value={`${stats.myAcc}%`} />
        <Divider className="my-2" />
        <Row label="Opponent WPM" value={stats.oppWpm} />
        <Row label="Opponent Accuracy" value={`${stats.oppAcc}%`} />
      </div>

      {error ? (
        <p className="text-red-500 text-sm text-center -mt-2">{error}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="flat"
          onPress={() => { playKeypressSound(); onCopyRoom(); }}
        >
          Copy Room Code
        </Button>

        <div className="flex gap-2">
          <Button
            variant="light"
            onPress={() => { playKeypressSound(); onLeave(); }}
          >
            Leave
          </Button>
          <Button
            variant="bordered"
            onPress={() => { playKeypressSound(); onNewLobby(); }}
          >
            New Lobby
          </Button>
          <Button
            color="primary"
            onPress={() => { playKeypressSound(); onRematch(); }}
            isLoading={!!isRematching}
          >
            Rematch
          </Button>
        </div>
      </div>
    </div>
  );
}
