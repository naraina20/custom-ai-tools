'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

interface GoogleOAuthConsentButtonProps {
  userId: string;
  onSuccess?: (email: string) => void;
  onStatusChange?: (connected: boolean, email?: string) => void;
  className?: string;
}

export function GoogleOAuthConsentButton({
  userId,
  onSuccess,
  onStatusChange,
  className = '',
}: GoogleOAuthConsentButtonProps) {
  const [isChecking, setIsChecking] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(true);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await apiClient.getGoogleOAuthStatus(userId);
      setIsConnected(res.connected);
      setIsConfigured(res.client_id_configured ?? true);
      if (res.connected && res.email) {
        setAccountEmail(res.email);
        if (onStatusChange) onStatusChange(true, res.email);
      } else {
        setAccountEmail('');
        if (onStatusChange) onStatusChange(false, '');
      }
    } catch (err: any) {
      console.warn('Could not verify Google OAuth status:', err);
    } finally {
      setIsChecking(false);
    }
  }, [userId, onStatusChange]);

  const handleDisconnect = async () => {
    if (!userId) return;
    setIsDisconnecting(true);
    try {
      await apiClient.revokeGoogleOAuth(userId);
      setIsConnected(false);
      setAccountEmail('');
      if (onStatusChange) onStatusChange(false, '');
    } catch (err: any) {
      console.warn('Could not disconnect Google OAuth:', err);
    } finally {
      setIsDisconnecting(false);
    }
  };

  useEffect(() => {
    checkStatus();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [checkStatus]);

  // Handle OAuth Consent Window Launch
  const handleStartOAuth = async () => {
    setIsConnecting(true);
    setErrorMessage(null);

    try {
      const res = await apiClient.initGoogleOAuth(userId);

      if (!res.auth_url) {
        setErrorMessage(
          res.details ||
          res.error ||
          'Google Developer Console credentials (GOOGLE_OAUTH_CLIENT_ID) not found in backend .env.'
        );
        setIsConfigured(false);
        setIsConnecting(false);
        return;
      }

      // Open Google OAuth consent popup
      const width = 600;
      const height = 720;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        res.auth_url,
        'GoogleOAuthConsent',
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=no,resizable=yes`
      );

      // Helper to finalize success state
      const handleAuthSuccess = (email: string) => {
        cleanup();
        setIsConnected(true);
        setAccountEmail(email);
        setIsConnecting(false);
        setErrorMessage(null);
        if (onSuccess) onSuccess(email);
        if (onStatusChange) onStatusChange(true, email);
      };

      const handleAuthError = (msg?: string) => {
        cleanup();
        setErrorMessage(msg || 'Authorization was cancelled or denied.');
        setIsConnecting(false);
      };

      // Channel 1: postMessage
      const messageListener = (event: MessageEvent) => {
        if (event.data && event.data.type === 'GOOGLE_OAUTH_SUCCESS') {
          handleAuthSuccess(event.data.email || '');
        } else if (event.data && event.data.type === 'GOOGLE_OAUTH_ERROR') {
          handleAuthError(event.data.message);
        }
      };

      // Channel 2: BroadcastChannel
      let bc: BroadcastChannel | null = null;
      try {
        bc = new BroadcastChannel('nexus_google_oauth');
        bc.onmessage = (event) => {
          if (event.data && event.data.type === 'GOOGLE_OAUTH_SUCCESS') {
            handleAuthSuccess(event.data.email || '');
          } else if (event.data && event.data.type === 'GOOGLE_OAUTH_ERROR') {
            handleAuthError(event.data.message);
          }
        };
      } catch (e) {}

      // Channel 3: localStorage event
      const storageListener = (e: StorageEvent) => {
        if (e.key === 'google_oauth_completed' && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            if (data.type === 'GOOGLE_OAUTH_SUCCESS') {
              handleAuthSuccess(data.email || '');
            } else if (data.type === 'GOOGLE_OAUTH_ERROR') {
              handleAuthError(data.message);
            }
          } catch (err) {}
        }
      };

      const cleanup = () => {
        window.removeEventListener('message', messageListener);
        window.removeEventListener('storage', storageListener);
        if (bc) {
          try {
            bc.close();
          } catch (e) {}
        }
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };

      window.addEventListener('message', messageListener);
      window.addEventListener('storage', storageListener);

      // Fallback Polling in case popup communication is blocked
      let pollCount = 0;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(async () => {
        pollCount += 1;
        try {
          const statusRes = await apiClient.getGoogleOAuthStatus(userId);
          if (statusRes.connected) {
            handleAuthSuccess(statusRes.email || '');
          }
        } catch (e) {}

        if (pollCount > 60 || (popup && popup.closed)) {
          cleanup();
          setIsConnecting(false);
        }
      }, 2000);

    } catch (err: any) {
      setErrorMessage(
        err.message || 'Failed to start Google OAuth flow. Please ensure backend credentials are configured.'
      );
      setIsConnecting(false);
    }
  };

  return (
    <div className={`mt-2.5 space-y-2.5 ${className}`}>
      {isChecking ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-400 py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
          <span>Checking Google account authorization...</span>
        </div>
      ) : isConnected ? (
        /* Connected State Card */
        <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">
                  Google Account Authorized
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  gmail.send active
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate mt-0.5 font-mono">
                {accountEmail || 'Personal Google Account'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleStartOAuth}
              disabled={isConnecting || isDisconnecting}
              className="text-[11px] text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 transition-colors"
              title="Switch Google Account"
            >
              {isConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Change'}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isConnecting || isDisconnecting}
              className="text-[11px] text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 hover:border-rose-500/40 transition-colors"
              title="Disconnect Google Account"
            >
              {isDisconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : (
        /* Unconnected / Consent Required Card */
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 shrink-0 mt-0.5">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">
                Google OAuth Consent Required
              </span>
              <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                Authorize your personal Gmail account to dispatch automated emails for this tool instance.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartOAuth}
            disabled={isConnecting}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all active:scale-[0.98]"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Waiting for Consent...</span>
              </>
            ) : (
              <>
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect Personal Google Account</span>
              </>
            )}
          </button>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block">{errorMessage}</span>
                {!isConfigured && (
                  <p className="text-[10px] text-rose-200/80 leading-relaxed">
                    Add <code className="bg-slate-950 px-1 py-0.5 rounded text-amber-300 font-mono">GOOGLE_OAUTH_CLIENT_ID</code> and <code className="bg-slate-950 px-1 py-0.5 rounded text-amber-300 font-mono">GOOGLE_OAUTH_CLIENT_SECRET</code> to your <code className="font-mono text-white">backend/.env</code> file.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
