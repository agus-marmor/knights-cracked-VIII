'use client'; // 1. Mark this as a Client Component

import { HeroUIProvider } from '@heroui/react';
import { useRouter } from 'next/navigation'; 

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    
    <HeroUIProvider navigate={router.push}> 
      {children}
    </HeroUIProvider>
  );
}