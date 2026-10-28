import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { ParticlesBackground } from '@/components/ui/ParticlesBackground';
import { NotificationProvider } from '@/lib/NotificationContext';
import { GoogleAuthProvider } from '@/components/providers/GoogleAuthProvider';
import { COMPANY_NAME, APP_TITLE, APP_DESCRIPTION } from '@/config/site';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: {
    default: APP_TITLE,
    template: `%s | ${COMPANY_NAME}`,
  },
  description: APP_DESCRIPTION,
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    shortcut: '/favicon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    siteName: COMPANY_NAME,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
};

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
            <GoogleAuthProvider>
              <div className="relative z-10 min-h-screen flex flex-col">
                {children}
              </div>
            </GoogleAuthProvider>
          </NotificationProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
