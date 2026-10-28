'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { apiClient } from '@/lib/api-client';
import {
  GooglePickerConfigResponse,
  GooglePickerDoc,
  GooglePickerResponse,
} from '@/lib/types';
import {
  FolderOpen,
  FileSpreadsheet,
  FileText,
  File,
  CheckCircle2,
  Trash2,
  Loader2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { GoogleOAuthConsentButton, isProductGranted } from './GoogleOAuthConsentButton';

// Dynamic import of official @googleworkspace/drive-picker-react components
// Disables SSR because Google Web Components require document / customElements
const DrivePicker = dynamic(
  () =>
    import('@googleworkspace/drive-picker-react').then(
      (mod) => mod.DrivePicker
    ),
  { ssr: false }
);

const DrivePickerDocsView = dynamic(
  () =>
    import('@googleworkspace/drive-picker-react').then(
      (mod) => mod.DrivePickerDocsView
    ),
  { ssr: false }
);

interface GoogleDrivePickerProps {
  userId: string;
  userConfig?: {
    developerKey?: string;
    clientId?: string;
    token?: string;
    appId?: string;
  };
  viewMimeTypes?: string; // Comma separated: 'application/vnd.google-apps.spreadsheet,application/vnd.google-apps.document'
  supportDrives?: boolean;
  showUploadView?: boolean;
  multiselect?: boolean;
  selectedFile?: GooglePickerDoc | null;
  onSelect?: (result: GooglePickerResponse) => void;
  onFilePicked?: (doc: GooglePickerDoc, fullResponse: GooglePickerResponse) => void;
  onClearSelection?: () => void;
  autoSaveToBackend?: boolean;
  className?: string;
  buttonLabel?: string;
}

export function GoogleDrivePicker({
  userId,
  userConfig,
  viewMimeTypes = 'application/vnd.google-apps.spreadsheet',
  supportDrives = true,
  showUploadView = false,
  multiselect = false,
  selectedFile: externalSelectedFile,
  onSelect,
  onFilePicked,
  onClearSelection,
  autoSaveToBackend = true,
  className = '',
  buttonLabel = 'Select Spreadsheet from Google Drive',
}: GoogleDrivePickerProps) {
  const [isClient, setIsClient] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [pickerConfig, setPickerConfig] = useState<GooglePickerConfigResponse | null>(null);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [internalSelectedFile, setInternalSelectedFile] = useState<GooglePickerDoc | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDriveAuthorized, setIsDriveAuthorized] = useState(false);

  // Sync with external selectedFile prop if provided
  const activeFile = externalSelectedFile !== undefined ? externalSelectedFile : internalSelectedFile;

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch or refresh Google Drive Picker configuration (developerKey, clientId, token) & verify drive.file scope
  const fetchPickerConfig = useCallback(async (): Promise<GooglePickerConfigResponse | null> => {
    if (!userId) return null;
    setIsLoadingConfig(true);
    setErrorMessage(null);

    try {
      const [resConfig, resStatus] = await Promise.all([
        apiClient.getGooglePickerConfig(userId),
        apiClient.getGoogleOAuthStatus(userId).catch(() => null),
      ]);

      setPickerConfig(resConfig);

      const gProducts = resStatus?.granted_products || resConfig.granted_products || [];
      const gScopes = resStatus?.granted_scopes || resConfig.granted_scopes || [];

      // Check whether drive.file or drive scope has been granted
      const hasDrive = Boolean(resConfig.has_drive_file) || isProductGranted('drive_picker', gProducts, gScopes);
      setIsDriveAuthorized(hasDrive);

      return resConfig;
    } catch (err: any) {
      console.warn('Could not fetch Google Picker configuration:', err);
      // Fallback to client-side env vars
      const fallbackConfig: GooglePickerConfigResponse = {
        developerKey:
          process.env.NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY ||
          userConfig?.developerKey ||
          '',
        clientId:
          process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
          userConfig?.clientId ||
          '',
        token: userConfig?.token || null,
        configured: Boolean(
          process.env.NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY || userConfig?.developerKey
        ),
        has_token: Boolean(userConfig?.token),
        has_drive_file: Boolean(userConfig?.token),
        needs_oauth: !Boolean(userConfig?.token),
      };
      setPickerConfig(fallbackConfig);
      setIsDriveAuthorized(Boolean(fallbackConfig.has_token));
      return fallbackConfig;
    } finally {
      setIsLoadingConfig(false);
    }
  }, [userId, userConfig]);

  // Load config on mount
  useEffect(() => {
    fetchPickerConfig();
  }, [fetchPickerConfig]);

  // Open the Drive Picker Dialog
  const handleOpenPicker = async () => {
    setErrorMessage(null);

    let currentConfig = pickerConfig;
    if (!currentConfig || !currentConfig.token) {
      currentConfig = await fetchPickerConfig();
    }

    if (!currentConfig?.token || !isDriveAuthorized) {
      setIsDriveAuthorized(false);
      setErrorMessage('Active Google Authorization required. Please authenticate below to access Google Drive.');
      return;
    }

    setIsPickerActive(true);
  };

  // Google Picker callback: Selected file
  const handlePickerPicked = async (e: any) => {
    setIsPickerActive(false);

    const detail: GooglePickerResponse = e.detail || e;
    if (!detail) return;

    if (onSelect) {
      onSelect(detail);
    }

    const docs = detail.docs || [];
    if (docs.length === 0) return;

    const chosenDoc = docs[0];

    // Guard: Disallow folders
    if (chosenDoc.mimeType === 'application/vnd.google-apps.folder' || chosenDoc.type === 'folder') {
      setErrorMessage('Folders cannot be selected. Please choose a Google Spreadsheet.');
      return;
    }

    // Guard: Strictly ensure it is a spreadsheet
    if (!chosenDoc.mimeType.includes('spreadsheet')) {
      setErrorMessage('Only Google Spreadsheets can be selected.');
      return;
    }

    setInternalSelectedFile(chosenDoc);

    if (onFilePicked) {
      onFilePicked(chosenDoc, detail);
    }

    // Automatically persist to backend SharedUserAsset database with delegation_type='granular_picker'
    if (autoSaveToBackend && userId) {
      setIsSaving(true);
      try {
        const prod = chosenDoc.mimeType.includes('spreadsheet')
          ? 'sheets'
          : chosenDoc.mimeType.includes('document')
          ? 'docs'
          : 'drive';

        await apiClient.registerGoogleAsset({
          user_id: userId,
          google_file_or_folder_id: chosenDoc.id,
          asset_name: chosenDoc.name,
          mime_type: chosenDoc.mimeType,
          product_name: prod,
          delegation_type: 'granular_picker',
          metadata: chosenDoc as any,
        });
      } catch (err: any) {
        console.warn('Could not auto-register Google Asset in backend:', err);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handlePickerCanceled = () => {
    setIsPickerActive(false);
  };

  const handleClear = () => {
    setInternalSelectedFile(null);
    if (onClearSelection) {
      onClearSelection();
    }
  };

  // Icon helper
  const getFileIcon = (mime: string) => {
    if (mime.includes('spreadsheet')) {
      return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
    }
    if (mime.includes('document')) {
      return <FileText className="w-5 h-5 text-sky-400" />;
    }
    return <File className="w-5 h-5 text-indigo-400" />;
  };

  const effectiveDeveloperKey =
    pickerConfig?.developerKey ||
    userConfig?.developerKey ||
    process.env.NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY ||
    '';

  const effectiveClientId =
    pickerConfig?.clientId ||
    userConfig?.clientId ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    '';

  const effectiveToken =
    pickerConfig?.token ||
    userConfig?.token ||
    '';

  const effectiveAppId =
    pickerConfig?.appId ||
    userConfig?.appId ||
    (effectiveClientId ? effectiveClientId.split('-')[0] : '');

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. STATE: File is Picked & Active */}
      {activeFile ? (
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-700/80 shrink-0 mt-0.5">
                {getFileIcon(activeFile.mimeType)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-white truncate max-w-[220px]">
                    {activeFile.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Granular Access
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                  ID: {activeFile.id}
                </p>
                {activeFile.url && (
                  <a
                    href={activeFile.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline mt-1"
                  >
                    <span>Open in Google Drive</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleOpenPicker}
                disabled={isLoadingConfig}
                className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                title="Select another file"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Change</span>
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                title="Remove selection"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/90 pt-1 border-t border-slate-800/80">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Granular permission granted strictly for this asset. Quarantined to your profile.</span>
          </div>
        </div>
      ) : isDriveAuthorized ? (
        /* 2. STATE: drive.file IS GRANTED -> Show clean 'Select File' button */
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
                <FolderOpen className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">
                  Select Specific File from Google Drive
                </span>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                  Pick the exact Google Sheet or Doc your tool instance will process. Only the chosen file is accessible.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenPicker}
            disabled={isLoadingConfig || isPickerActive}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all active:scale-[0.99]"
          >
            {isLoadingConfig || isPickerActive ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{isPickerActive ? 'Drive Picker Active in Window...' : 'Preparing Drive Access...'}</span>
              </>
            ) : (
              <>
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{buttonLabel}</span>
              </>
            )}
          </button>

          {errorMessage && (
            <p className="text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
              {errorMessage}
            </p>
          )}
        </div>
      ) : (
        /* 3. STATE: drive.file IS NOT GRANTED -> Do NOT show file picker button, ONLY show Authorize button */
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
                <FolderOpen className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">
                  Select Specific File from Google Drive
                </span>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                  Pick the exact Google Sheet or Doc your tool instance will process. Only the chosen file is accessible.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 space-y-2">
            <div className="flex items-start gap-2">
              <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-200 leading-snug">
                <span className="font-semibold block">Google Authorization Required</span>
                Authorize Drive File Picker access so you can select documents from your Google Drive.
              </div>
            </div>
            <GoogleOAuthConsentButton
              userId={userId}
              scope="https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid"
              requiredProducts={['drive_picker']}
              buttonLabel="Authorize Google Drive Picker"
              onSuccess={() => {
                setIsDriveAuthorized(true);
                fetchPickerConfig();
              }}
              onStatusChange={(fullyAuth) => {
                if (fullyAuth) {
                  setIsDriveAuthorized(true);
                  fetchPickerConfig();
                }
              }}
            />
          </div>

          {errorMessage && (
            <p className="text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
              {errorMessage}
            </p>
          )}
        </div>
      )}

      {/* 4. Official Google Drive Picker Web Wrapper Component (Rendered on Client) */}
      {isClient && isPickerActive && effectiveToken && effectiveDeveloperKey && effectiveClientId && (
        <DrivePicker
          developer-key={effectiveDeveloperKey}
          client-id={effectiveClientId}
          oauth-token={effectiveToken}
          app-id={effectiveAppId || undefined}
          hide-title-bar="false"
          multiselect={multiselect}
          onPicked={handlePickerPicked}
          onCanceled={handlePickerCanceled}
          onOauthError={(e: any) => {
            console.error('Picker OAuth error:', e);
            setErrorMessage('Google authentication error occurred while opening picker.');
            setIsPickerActive(false);
          }}
        >
          {/* Primary View: Personal Google Spreadsheets with folder navigation (folder selection blocked) */}
          <DrivePickerDocsView
            view-id="SPREADSHEETS"
            mime-types="application/vnd.google-apps.spreadsheet"
            include-folders="true"
            select-folder-enabled="false"
          />

          {/* Secondary View: Shared Drives Google Spreadsheets with folder navigation (folder selection blocked) */}
          <DrivePickerDocsView
            view-id="SPREADSHEETS"
            enable-drives="true"
            mime-types="application/vnd.google-apps.spreadsheet"
            include-folders="true"
            select-folder-enabled="false"
          />
        </DrivePicker>
      )}
    </div>
  );
}
