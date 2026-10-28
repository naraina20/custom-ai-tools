'use client';

import React from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';

interface GoogleAuthProviderProps {
  children: React.ReactNode;
}

export function GoogleAuthProvider({ children }: GoogleAuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

  // Providing a fallback string ensures React context is initialized properly
  // even if NEXT_PUBLIC_GOOGLE_CLIENT_ID is temporarily empty.
  return (
    <GoogleOAuthProvider clientId={clientId || 'google-oauth-unconfigured'}>
      {children}
    </GoogleOAuthProvider>
  );
}
