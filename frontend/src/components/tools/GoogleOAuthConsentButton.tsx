'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGoogleLogin, useGoogleOAuth } from '@react-oauth/google';
import { apiClient } from '@/lib/api-client';
import { GoogleOAuthStatusResponse } from '@/lib/types';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  KeyRound,
  AlertTriangle,
} from 'lucide-react';

export interface GoogleOAuthConsentButtonProps {
  userId: string;
  scope?: string;
  requiredProducts?: string[];
  onSuccess?: (email: string) => void;
  onStatusChange?: (connected: boolean, email?: string, statusInfo?: GoogleOAuthStatusResponse) => void;
  className?: string;
  buttonLabel?: string;
}

export function formatProductName(prod: string): string {
  const p = prod.toLowerCase().trim();
  if (p.includes('sheet')) return 'Google Sheets';
  if (p === 'drive_picker' || p === 'drive.file') return 'Google Drive (Picker)';
  if (p.includes('drive')) return 'Google Drive';
  if (p.includes('doc')) return 'Google Docs';
  if (p.includes('meet')) return 'Google Meet';
  if (p.includes('calendar')) return 'Google Calendar';
  if (p.includes('form')) return 'Google Forms';
  if (p.includes('gmail') || p.includes('mail')) return 'Gmail';
  return prod.charAt(0).toUpperCase() + prod.slice(1);
}

export function isProductGranted(prod: string, granted: string[] = [], scopes: string[] = []): boolean {
  const p = prod.toLowerCase().trim();
  if (p === 'drive_picker' || p === 'drive.file') {
    return granted.some((g) => g.toLowerCase() === 'drive_picker' || g.toLowerCase() === 'drive') ||
           scopes.some((s) => s.includes('drive.file') || s.endsWith('/drive'));
  }
  if (p === 'gmail' || p === 'gmail.send') {
    return granted.some((g) => g.toLowerCase().includes('gmail')) ||
           scopes.some((s) => s.includes('gmail.send'));
  }
  if (p.includes('sheet')) {
    return granted.some((g) => g.toLowerCase().includes('sheet')) ||
           scopes.some((s) => s.includes('spreadsheets'));
  }
  if (p.includes('doc')) {
    return granted.some((g) => g.toLowerCase().includes('doc')) ||
           scopes.some((s) => s.includes('documents'));
  }
  if (p === 'drive' || p === 'google drive') {
    return granted.some((g) => g.toLowerCase() === 'drive') ||
           scopes.some((s) => s.endsWith('/drive'));
  }
  if (p.includes('meet')) return granted.some((g) => g.toLowerCase().includes('meet'));
  if (p.includes('calendar')) return granted.some((g) => g.toLowerCase().includes('calendar'));
  if (p.includes('form')) return granted.some((g) => g.toLowerCase().includes('form'));
  return granted.some((g) => g.toLowerCase() === p);
}

export function GoogleOAuthConsentButton({
  userId,
  scope,
  requiredProducts = [],
  onSuccess,
  onStatusChange,
  className = '',
  buttonLabel,
}: GoogleOAuthConsentButtonProps) {
  const { clientId } = useGoogleOAuth();
  const isClientIdConfigured = Boolean(clientId && clientId !== 'google-oauth-unconfigured');

  const [isChecking, setIsChecking] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string>('');
  const [grantedScopes, setGrantedScopes] = useState<string[]>([]);
  const [grantedProducts, setGrantedProducts] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backendConfigured, setBackendConfigured] = useState(true);

  const isCheckingRef = useRef(false);
  const prevAuthKeyRef = useRef<string>('');

  const requiredProductsRef = useRef(requiredProducts);
  requiredProductsRef.current = requiredProducts;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Compute missing products that are required by current tool configuration
  const missingProducts = requiredProducts.filter((req) => !isProductGranted(req, grantedProducts, grantedScopes));
  const isFullyAuthorized = isConnected && missingProducts.length === 0;

  // Check current authorization status from backend
  const checkStatus = useCallback(async () => {
    if (!userId || isCheckingRef.current) return null;
    isCheckingRef.current = true;

    try {
      const res = await apiClient.getGoogleOAuthStatus(userId);
      setIsConnected(res.connected);
      setBackendConfigured(res.client_id_configured ?? true);
      const gProducts = res.granted_products || [];
      const gScopes = res.granted_scopes || [];
      setGrantedScopes(gScopes);
      setGrantedProducts(gProducts);

      const missing = requiredProductsRef.current.filter((req) => !isProductGranted(req, gProducts, gScopes));
      const fullyAuth = res.connected && missing.length === 0;

      const currentAuthKey = `${res.connected}-${res.email || ''}-${fullyAuth}-${gProducts.sort().join(',')}`;

      if (res.connected && res.email) {
        setAccountEmail(res.email);
      } else {
        setAccountEmail('');
      }

      if (currentAuthKey !== prevAuthKeyRef.current) {
        prevAuthKeyRef.current = currentAuthKey;
        if (onStatusChangeRef.current) {
          onStatusChangeRef.current(fullyAuth, res.email || '', res);
        }
      }

      return { res, fullyAuth, missing };
    } catch (err: any) {
      console.warn('Could not verify Google OAuth status:', err);
      return null;
    } finally {
      setIsChecking(false);
      isCheckingRef.current = false;
    }
  }, [userId]);

  // Handle Disconnect / Revoke
  const handleDisconnect = async () => {
    if (!userId) return;
    setIsDisconnecting(true);
    try {
      await apiClient.revokeGoogleOAuth(userId);
      setIsConnected(false);
      setAccountEmail('');
      setGrantedScopes([]);
      setGrantedProducts([]);
      prevAuthKeyRef.current = 'revoked';
      if (onStatusChangeRef.current) onStatusChangeRef.current(false, '');
    } catch (err: any) {
      console.warn('Could not disconnect Google OAuth:', err);
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Google Identity Services (GIS) via @react-oauth/google
  // Window open, closure detection, and code exchange handled via native event callbacks
  const effectiveScope = scope && scope.trim() ? scope.trim() : 'https://www.googleapis.com/auth/gmail.send';

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    scope: effectiveScope,
    onSuccess: async (codeResponse) => {
      setIsConnecting(true);
      setErrorMessage(null);

      try {
        const exchangeRes = await apiClient.exchangeGoogleAuthCode(userId, codeResponse.code);
        if (exchangeRes.success) {
          setIsConnected(true);
          const email = exchangeRes.email || '';
          setAccountEmail(email);
          const gProducts = exchangeRes.granted_products || [];
          const gScopes = exchangeRes.granted_scopes || [];
          setGrantedScopes(gScopes);
          setGrantedProducts(gProducts);

          const missing = requiredProductsRef.current.filter((req) => !isProductGranted(req, gProducts, gScopes));
          const fullyAuth = missing.length === 0;

          if (onSuccessRef.current) {
            onSuccessRef.current(email);
          }
          if (onStatusChangeRef.current) {
            onStatusChangeRef.current(fullyAuth, email, exchangeRes as any);
          }
        } else {
          setErrorMessage(exchangeRes.error || 'Failed to complete authorization with Google.');
        }
      } catch (err: any) {
        console.error('Google authorization code exchange failed:', err);
        setErrorMessage(err.message || 'Error exchanging authorization code with backend.');
      } finally {
        setIsConnecting(false);
      }
    },
    onError: (errorResponse) => {
      setIsConnecting(false);
      if (errorResponse.error && errorResponse.error !== 'access_denied') {
        setErrorMessage(errorResponse.error_description || errorResponse.error);
      }
    },
    onNonOAuthError: (nonOAuthError) => {
      // Handles window closure and popup failures without any cross-origin errors
      setIsConnecting(false);
      if (nonOAuthError.type === 'popup_failed_to_open') {
        setErrorMessage('Google consent popup was blocked by browser. Please allow popups and try again.');
      } else if (nonOAuthError.type === 'popup_closed') {
        // User closed the window before granting permissions
        console.log('Google OAuth consent window was closed by user.');
      }
    },
  });

  const handleStartOAuth = () => {
    setErrorMessage(null);
    setIsConnecting(true);
    try {
      googleLogin();
    } catch (err: any) {
      setIsConnecting(false);
      setErrorMessage(err.message || 'Failed to launch Google consent screen.');
    }
  };

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const isConfigured = isClientIdConfigured && backendConfigured;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Configuration Error Banner */}
      {!isConfigured && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <span className="font-semibold text-amber-200 block">Google OAuth Client ID Missing</span>
            <p className="text-amber-300/80 leading-relaxed text-[11px]">
              Set <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-amber-300">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in{' '}
              <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-amber-300">frontend/.env.local</code> and{' '}
              <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-amber-300">GOOGLE_OAUTH_CLIENT_ID</code> in{' '}
              <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-amber-300">backend/.env</code>.
            </p>
          </div>
        </div>
      )}

      {/* 2. Error Message */}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2.5 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">Authentication Error</span>
            <p className="text-[11px] text-rose-300/90">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* 3. Loading State */}
      {isChecking ? (
        <div className="flex items-center gap-2 py-2.5 px-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
          <span>Verifying active Google credentials...</span>
        </div>
      ) : isFullyAuthorized ? (
        /* 4. Fully Authorized State */
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-emerald-300 block">
                  Google Account Authorized
                </span>
                <span className="text-[11px] text-emerald-400/80 font-mono truncate block">
                  {accountEmail}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="text-[10px] text-slate-400 hover:text-rose-400 px-2 py-1 rounded-lg border border-slate-700/60 hover:border-rose-500/30 hover:bg-rose-500/10 transition-colors shrink-0 disabled:opacity-50"
            >
              {isDisconnecting ? 'Revoking...' : 'Disconnect'}
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-emerald-500/15">
            <span className="text-[10px] text-emerald-400/90 font-medium">Active permissions:</span>
            {grantedProducts.map((p) => (
              <span
                key={p}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              >
                {formatProductName(p)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        /* 5. Missing Permissions or Disconnected State */
        <div className="space-y-2.5">
          {isConnected && missingProducts.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Additional Permission Scope Required</span>
                <p className="text-[11px] text-amber-300/80 mb-1.5">
                  Your connected Google account ({accountEmail}) lacks access to:{' '}
                  <strong>{missingProducts.map(formatProductName).join(', ')}</strong>.
                </p>
                <div className="flex items-center gap-1 flex-wrap">
                  {missingProducts.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    >
                      +{formatProductName(p)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleStartOAuth}
            disabled={isConnecting || !isConfigured}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all active:scale-[0.99]"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Waiting for Google Consent Window...</span>
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5" />
                <span>{buttonLabel || (isConnected ? 'Grant Additional Permissions' : 'Authorize with Google')}</span>
                <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
