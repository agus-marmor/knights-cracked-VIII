'use client';

import { HeroUIProvider } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { AudioProvider } from '@/lib/sfx'; 

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  return (
    <AudioProvider> {/* Wrap with AudioProvider */}
      <HeroUIProvider navigate={router.push}>
        {children}
      </HeroUIProvider>
    </AudioProvider>
  );
}