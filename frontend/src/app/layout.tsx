import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { ParticlesBackground } from '@/components/ui/ParticlesBackground';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Gravita AI Gateway | Autonomous Tool Engineering & Tax Intelligence',
  description:
    'Enterprise AI Tool Creation, LangGraph Human-in-the-Loop Orchestration, and Indian GST/Tax Intelligence Assistant.',
};

import { NotificationProvider } from '@/lib/NotificationContext';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#6366f1',
          colorBackground: '#0d1117',
        },
      }}
    >
      <html lang="en" className={`dark ${inter.variable}`}>
        <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
          <ParticlesBackground />
          <NotificationProvider>
            <div className="relative z-10 min-h-screen flex flex-col">
              {children}
            </div>
          </NotificationProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
