'use client';

import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import {
  GoogleOAuthConsentButton,
  formatProductName,
  isProductGranted,
} from '@/components/tools/GoogleOAuthConsentButton';
import { GoogleDrivePicker } from '@/components/tools/GoogleDrivePicker';
import { apiClient } from '@/lib/api-client';
import {
  FailedWebhookInfoResponse,
  GooglePickerDoc,
  DeploymentAssetHistoryItem,
} from '@/lib/types';
import {
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  ExternalLink,
  Loader2,
  FileSpreadsheet,
  FileText,
  File,
  Mail,
  ShieldCheck,
  History,
  Clock,
  Check,
  XCircle,
  Info,
} from 'lucide-react';

function normalizeGoogleProduct(raw: string): string | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (s.includes('sheet')) return 'sheets';
  if (s.includes('doc')) return 'docs';
  if (s.includes('drive')) return 'drive';
  if (s.includes('gmail') || s.includes('mail') || s.includes('email')) return 'gmail';
  if (s.includes('meet')) return 'meet';
  if (s.includes('calendar')) return 'calendar';
  if (s.includes('form')) return 'forms';
  return s;
}

function OAuthReauthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('job_id');

  const { user, isLoaded: isUserLoaded, isSignedIn } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobInfo, setJobInfo] = useState<FailedWebhookInfoResponse | null>(null);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);

  // File selection, auto-check, and history states
  const [pickedFile, setPickedFile] = useState<GooglePickerDoc | null>(null);
  const [fileDescription, setFileDescription] = useState<string>('');
  const [isCheckingFileAccess, setIsCheckingFileAccess] = useState(false);
  const [fileCheckResult, setFileCheckResult] = useState<{
    performed?: boolean;
    is_accessible?: boolean;
    error?: string | null;
  } | null>(null);
  const [isSelectingFile, setIsSelectingFile] = useState(false);
  const [showChangeSheet, setShowChangeSheet] = useState(false);

  const [isRetrying, setIsRetrying] = useState(false);
  const [retrySuccess, setRetrySuccess] = useState<string | null>(null);

  // Authentication check & redirect with return url
  useEffect(() => {
    if (isUserLoaded && !isSignedIn) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      router.push(`/sign-in?redirect_url=${returnUrl}`);
    }
  }, [isUserLoaded, isSignedIn, router]);

  // Fetch Failed Webhook Details
  const fetchJobInfo = useCallback(async () => {
    if (!jobId) {
      setError('No job_id provided in the recovery link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getFailedWebhookInfo(jobId);
      setJobInfo(data);
      if (data.file_access_check) {
        setFileCheckResult(data.file_access_check);
      }
      if (data.connected_asset?.description) {
        setFileDescription(data.connected_asset.description);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve webhook recovery information.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (isSignedIn && jobId) {
      fetchJobInfo();
    }
  }, [isSignedIn, jobId, fetchJobInfo]);

  // Explicit auto-check against Google Drive API for connected file
  const handleCheckFileAccess = useCallback(async () => {
    if (!jobId) return;
    setIsCheckingFileAccess(true);
    try {
      const res = await apiClient.checkFailedWebhookFileAccess(jobId);
      setFileCheckResult({
        performed: true,
        is_accessible: res.is_accessible,
        error: res.error,
      });
      if (res.connected_asset !== undefined) {
        setJobInfo((prev) => (prev ? {
          ...prev,
          connected_asset: res.connected_asset ?? null,
          file_history: res.file_history ?? prev.file_history,
        } : null));
        if (res.connected_asset?.description !== undefined) {
          setFileDescription(res.connected_asset.description || '');
        }
      }
    } catch (err: any) {
      setFileCheckResult({
        performed: true,
        is_accessible: false,
        error: err.message || 'Error checking Google Drive permissions.',
      });
    } finally {
      setIsCheckingFileAccess(false);
    }
  }, [jobId]);

  // Select a new file or re-activate a historical file (strictly one active sheet per deployment)
  const handleSelectOrReactivateFile = async (
    fileId: string,
    fileName?: string,
    mimeType?: string,
    descriptionText?: string
  ) => {
    if (!jobId) return;
    setIsSelectingFile(true);
    setError(null);
    try {
      const res = await apiClient.selectFailedWebhookFile(jobId, {
        google_file_id: fileId,
        asset_name: fileName || 'Selected Spreadsheet',
        mime_type: mimeType || 'application/vnd.google-apps.spreadsheet',
        description: descriptionText !== undefined ? descriptionText : fileDescription,
      });
      setJobInfo((prev) => (prev ? {
        ...prev,
        connected_asset: res.connected_asset,
        file_history: res.file_history,
      } : null));
      setPickedFile(null);
      setShowChangeSheet(false);
      // Automatically re-verify access in Drive
      await handleCheckFileAccess();
    } catch (err: any) {
      setError(err.message || 'Failed to link spreadsheet.');
    } finally {
      setIsSelectingFile(false);
    }
  };

  // Handle Retry execution
  const handleRestartExecution = async () => {
    if (!jobId) return;
    setIsRetrying(true);
    setError(null);
    setRetrySuccess(null);
    try {
      const activeAsset = jobInfo?.connected_asset;
      const fileId = pickedFile?.id || (activeAsset?.is_active ? activeAsset.google_file_or_folder_id : undefined);
      const fileName = pickedFile?.name || activeAsset?.asset_name;
      const mimeType = pickedFile?.mimeType || activeAsset?.mime_type;

      const assetPayload = fileId
        ? {
            google_file_id: fileId,
            asset_name: fileName,
            mime_type: mimeType,
            description: fileDescription,
          }
        : undefined;

      const res = await apiClient.retryFailedWebhook(jobId, assetPayload);
      setRetrySuccess(res.message || 'Webhook execution successfully resumed!');
    } catch (err: any) {
      setError(err.message || 'Failed to restart webhook execution.');
    } finally {
      setIsRetrying(false);
    }
  };


  const tool = jobInfo?.tool;
  const deployment = jobInfo?.deployment;
  const connectedAsset = jobInfo?.connected_asset;

  // Compute products and required scopes dynamically matching ToolDeployModal
  const {
    finalProducts,
    fileProducts,
    hasFileProducts,
    hasGmail,
    otherProducts,
    requiredOAuthProducts,
    computedScope,
    needsOAuth,
    fileAccessChoice,
    emailChannel,
  } = useMemo(() => {
    const toolDetected: string[] = Array.isArray(tool?.google_products)
      ? tool.google_products
      : [];

    const titleDescTasksScan = `${tool?.title || ''} ${tool?.description || ''} ${tool?.tasks || ''}`.toLowerCase();
    const toolFinalProductsSet = new Set<string>();

    toolDetected.forEach((p: string) => {
      const norm = normalizeGoogleProduct(p);
      if (norm) toolFinalProductsSet.add(norm);
    });

    if (titleDescTasksScan.includes('sheet')) toolFinalProductsSet.add('sheets');
    if (titleDescTasksScan.includes('drive')) toolFinalProductsSet.add('drive');
    if (titleDescTasksScan.includes('doc')) toolFinalProductsSet.add('docs');
    if (titleDescTasksScan.includes('meet')) toolFinalProductsSet.add('meet');
    if (titleDescTasksScan.includes('calendar')) toolFinalProductsSet.add('calendar');
    if (titleDescTasksScan.includes('forms') || titleDescTasksScan.includes('form')) toolFinalProductsSet.add('forms');
    if (titleDescTasksScan.includes('gmail') || titleDescTasksScan.includes('email') || titleDescTasksScan.includes('mail') || Boolean(tool?.add_gmail_oauth_flag)) {
      toolFinalProductsSet.add('gmail');
    }

    const cfg = deployment?.config_data || {};
    if (cfg.file_products && Array.isArray(cfg.file_products)) {
      cfg.file_products.forEach((p: string) => {
        const norm = normalizeGoogleProduct(p);
        if (norm) toolFinalProductsSet.add(norm);
      });
    }
    if (cfg.google_file_id || connectedAsset) {
      toolFinalProductsSet.add('sheets');
      toolFinalProductsSet.add('drive');
    }

    const finalProductsList = Array.from(toolFinalProductsSet);
    const fileProds = finalProductsList.filter((p) => ['sheets', 'drive', 'docs'].includes(p));
    const hasFiles = fileProds.length > 0;
    const gmailNeeded = finalProductsList.includes('gmail') || Boolean(tool?.add_gmail_oauth_flag) || titleDescTasksScan.includes('email') || titleDescTasksScan.includes('mail');
    const otherProds = finalProductsList.filter((p) => !['sheets', 'drive', 'docs', 'gmail'].includes(p));

    const fChoice = cfg.file_access_choice || (hasFiles ? 'granular_picker' : 'none');
    const eChannel = cfg.email_channel_choice || (gmailNeeded ? 'oauth' : 'none');

    // Scope construction: ONLY request scopes for products this tool/deployment actually needs
    const scopeParts = ['https://www.googleapis.com/auth/userinfo.email', 'openid'];
    const oauthProductsList: string[] = [];

    // 1. Gmail OAuth - only if tool uses Gmail AND email channel is configured for OAuth
    if (gmailNeeded && eChannel === 'oauth') {
      scopeParts.push('https://www.googleapis.com/auth/gmail.send');
      if (!oauthProductsList.includes('gmail')) oauthProductsList.push('gmail');
    }

    // 2. File products OAuth (Sheets, Drive, Docs) - strictly per-file via drive.file only (no whole drive, no broad spreadsheet access)
    if (hasFiles && fChoice !== 'share_email' && fChoice !== 'none') {
      scopeParts.push('https://www.googleapis.com/auth/drive.file');
      if (!oauthProductsList.includes('drive_picker')) oauthProductsList.push('drive_picker');
    }

    // 3. Other products (Meet, Calendar, Forms)
    otherProds.forEach((p) => {
      if (p === 'meet') {
        scopeParts.push('https://www.googleapis.com/auth/meetings.space.created');
        if (!oauthProductsList.includes('meet')) oauthProductsList.push('meet');
      }
      if (p === 'calendar') {
        scopeParts.push('https://www.googleapis.com/auth/calendar.events');
        if (!oauthProductsList.includes('calendar')) oauthProductsList.push('calendar');
      }
      if (p === 'forms') {
        scopeParts.push('https://www.googleapis.com/auth/forms.body');
        if (!oauthProductsList.includes('forms')) oauthProductsList.push('forms');
      }
    });

    const cScope = Array.from(new Set(scopeParts)).join(' ');
    const requiresAuth = oauthProductsList.length > 0;

    return {
      finalProducts: finalProductsList,
      fileProducts: fileProds,
      hasFileProducts: hasFiles,
      hasGmail: gmailNeeded,
      otherProducts: otherProds,
      requiredOAuthProducts: oauthProductsList,
      computedScope: cScope,
      needsOAuth: requiresAuth,
      fileAccessChoice: fChoice,
      emailChannel: eChannel,
    };
  }, [tool, deployment, connectedAsset]);

  if (!isUserLoaded || loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-xs text-slate-400 font-mono">Loading OAuth recovery parameters...</p>
      </div>
    );
  }

  if (error && !jobInfo) {
    return (
      <div className="max-w-xl mx-auto p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4 my-12">
        <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-white">OAuth Recovery Failed</h2>
        <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
        <Link
          href="/tools"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-all"
        >
          <span>Return to Tools Dashboard</span>
        </Link>
      </div>
    );
  }

  const effectiveUserId = user?.id || jobInfo?.user_id || 'guest_user';

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6 my-6">
      {/* Top Banner */}
      <div className="flex items-center gap-3.5 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base font-bold text-white">
            OAuth Authorization Required for Webhook Ingestion
          </h1>
          <p className="text-xs text-amber-200/90 mt-0.5">
            Your automated tool execution paused because required Google OAuth authorization was missing or expired.
          </p>
        </div>
      </div>

      {retrySuccess ? (
        <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Execution Resumed Successfully</h2>
            <p className="text-xs text-emerald-300 mt-1">{retrySuccess}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              The failed webhook record has been resolved, and your payload is now queued and processing.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/tools"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all"
            >
              <span>Back to AI Tools Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Target AI Tool Card */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider block">
                  Target AI Tool
                </span>
                <h2 className="text-sm font-bold text-white mt-0.5">{tool?.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                {jobInfo?.pending_failed_count && jobInfo.pending_failed_count > 1 ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    {jobInfo.pending_failed_count} Pending Webhooks
                  </span>
                ) : null}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60">
                  Job #{jobId}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">{tool?.description}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <span className="text-slate-500 block mb-0.5">Deployment Instance</span>
                <span className="font-mono text-slate-300">Instance #{deployment?.id || 'Direct'}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <span className="text-slate-500 block mb-0.5">Deployer User ID</span>
                <span className="font-mono text-slate-300 truncate block">{jobInfo?.user_id}</span>
              </div>
            </div>

            {jobInfo?.error_message && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                <span className="font-semibold block mb-0.5">Reason Execution Paused:</span>
                <span className="font-mono text-[11px]">{jobInfo.error_message}</span>
              </div>
            )}
          </div>

          {/* Section 1: File Access Configuration (Only if tool operates on files) */}
          {hasFileProducts && (
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Google Workspace File Configuration
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {fileProducts.map((p) => (
                      <span
                        key={p}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20"
                      >
                        {formatProductName(p)}
                      </span>
                    ))}
                  </div>
                  {(connectedAsset?.google_file_or_folder_id || deployment?.config_data?.google_file_id) && (
                    <button
                      type="button"
                      onClick={() => handleCheckFileAccess()}
                      disabled={isCheckingFileAccess || !oauthConnected}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-medium text-slate-300 border border-slate-700 transition-all disabled:opacity-50"
                      title="Run live access check against Google Drive API"
                    >
                      {isCheckingFileAccess ? (
                        <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                      ) : (
                        <RefreshCw className="w-3 h-3 text-purple-400" />
                      )}
                      <span>{isCheckingFileAccess ? 'Checking...' : 'Check Access'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Check if current connected asset is active vs revoked */}
              {connectedAsset && connectedAsset.is_active ? (
                <div className="space-y-3">
                  {/* Active File Card */}
                  <div
                    className={`p-4 rounded-xl border transition-all ${
                      fileCheckResult?.is_accessible === false
                        ? 'bg-rose-950/20 border-rose-500/40'
                        : 'bg-slate-950/80 border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            fileCheckResult?.is_accessible === false
                              ? 'bg-rose-500/15 text-rose-400'
                              : 'bg-emerald-500/15 text-emerald-400'
                          }`}
                        >
                          {connectedAsset.mime_type?.includes('spreadsheet') ? (
                            <FileSpreadsheet className="w-4 h-4" />
                          ) : (
                            <FileText className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">
                              {connectedAsset.asset_name || 'Connected Google File'}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Active
                            </span>
                            {connectedAsset.is_verified && fileCheckResult?.is_accessible !== false ? (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                                <span>Drive Verified</span>
                              </span>
                            ) : null}
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                            ID: {connectedAsset.google_file_or_folder_id}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowChangeSheet(!showChangeSheet)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-all"
                        >
                          {showChangeSheet ? 'Cancel Change' : 'Change Sheet'}
                        </button>
                      </div>
                    </div>

                    {/* Access Revoked Warning if check failed */}
                    {fileCheckResult?.is_accessible === false && (
                      <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-xs text-rose-300">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold block">Google Drive Permission Revoked or Lost</span>
                          <span className="text-[11px] text-rose-200/90 leading-relaxed block mt-0.5">
                            {fileCheckResult.error || connectedAsset.last_error || 'Access to this file in Google Drive returned 403/404. This sheet is marked inactive.'}
                          </span>
                          <span className="text-[10px] text-slate-400 block mt-1">
                            Please select a replacement spreadsheet below, or re-select this file to re-grant OAuth access.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Non-required description field for future LLM multi-file usage */}
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                          File Description / Purpose (Optional)
                        </label>
                        <span className="text-[10px] text-slate-500">Non-required (used by AI for multi-file tools)</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={fileDescription}
                          onChange={(e) => setFileDescription(e.target.value)}
                          placeholder="e.g., Primary sales leads spreadsheet"
                          className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (connectedAsset?.google_file_or_folder_id) {
                              handleSelectOrReactivateFile(
                                connectedAsset.google_file_or_folder_id,
                                connectedAsset.asset_name,
                                connectedAsset.mime_type,
                                fileDescription
                              );
                            }
                          }}
                          disabled={isSelectingFile || fileDescription === (connectedAsset.description || '')}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium border border-slate-700 transition-all disabled:opacity-40"
                        >
                          {isSelectingFile ? 'Saving...' : 'Save Description'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Drive Picker if user clicked "Change Sheet" or if access was revoked */}
                  {(showChangeSheet || fileCheckResult?.is_accessible === false) && (
                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                      <p className="text-xs text-slate-300">
                        {fileCheckResult?.is_accessible === false
                          ? 'Select a replacement Google Sheet or re-pick the same file to re-grant access:'
                          : 'Select a different Google Sheet to connect to this deployment:'}
                      </p>
                      <GoogleDrivePicker
                        key={`drive-picker-${oauthConnected ? 'auth' : 'unauth'}`}
                        userId={effectiveUserId}
                        viewMimeTypes="application/vnd.google-apps.spreadsheet"
                        supportDrives={true}
                        showUploadView={false}
                        buttonLabel="Pick Replacement Spreadsheet from Google Drive"
                        selectedFile={pickedFile}
                        onFilePicked={(doc) => {
                          setPickedFile(doc);
                          handleSelectOrReactivateFile(doc.id, doc.name, doc.mimeType);
                        }}
                        onClearSelection={() => setPickedFile(null)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* No Active File for Deployment */
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
                    <span className="font-semibold block mb-0.5">No Active Spreadsheet Connected</span>
                    <span>
                      {connectedAsset
                        ? `The previously chosen file '${connectedAsset.asset_name}' is inactive. Please pick a spreadsheet below or re-activate one from history.`
                        : 'Select the Google Sheet your tool instance will read and write data to:'}
                    </span>
                  </div>

                  {/* Optional Description Input */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                      Spreadsheet Description / Role (Optional)
                    </label>
                    <input
                      type="text"
                      value={fileDescription}
                      onChange={(e) => setFileDescription(e.target.value)}
                      placeholder="e.g., Primary sales leads spreadsheet"
                      className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <GoogleDrivePicker
                    key={`drive-picker-${oauthConnected ? 'auth' : 'unauth'}`}
                    userId={effectiveUserId}
                    viewMimeTypes="application/vnd.google-apps.spreadsheet"
                    supportDrives={true}
                    showUploadView={false}
                    buttonLabel="Select Spreadsheet from Google Drive"
                    selectedFile={pickedFile}
                    onFilePicked={(doc) => {
                      setPickedFile(doc);
                      handleSelectOrReactivateFile(doc.id, doc.name, doc.mimeType);
                    }}
                    onClearSelection={() => setPickedFile(null)}
                  />
                </div>
              )}

              {/* Section 1.5: Deployment File History */}
              {jobInfo?.file_history && jobInfo.file_history.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-indigo-400" />
                      <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">
                        Previously Chosen Files for this Deployment ({jobInfo.file_history.length})
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      1 active sheet per deployment
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    History of spreadsheets connected to deployment #{deployment?.id || 'current'}. Only one spreadsheet is active at a time. Re-activating an older file or selecting a new file automatically deactivates previous files.
                  </p>

                  <div className="space-y-2">
                    {jobInfo.file_history.map((histItem) => {
                      const isItemActive = Boolean(histItem.is_active);
                      return (
                        <div
                          key={`file-hist-${histItem.id}`}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all ${
                            isItemActive
                              ? 'bg-slate-950/70 border-emerald-500/40 ring-1 ring-emerald-500/20'
                              : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                isItemActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-white truncate block">
                                  {histItem.asset_name || 'Spreadsheet'}
                                </span>
                                {isItemActive ? (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                    Active
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
                                    Inactive
                                  </span>
                                )}
                                {histItem.is_verified ? (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                    Verified
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                    Unverified
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-mono text-slate-500 block truncate mt-0.5">
                                ID: {histItem.google_file_or_folder_id}
                              </span>
                              {histItem.description && (
                                <span className="text-[10px] text-slate-400 block truncate mt-0.5">
                                  Description: {histItem.description}
                                </span>
                              )}
                              {histItem.last_error && !isItemActive && (
                                <span className="text-[10px] text-rose-400 block truncate mt-0.5">
                                  Last error: {histItem.last_error}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!isItemActive && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleSelectOrReactivateFile(
                                    histItem.google_file_or_folder_id,
                                    histItem.asset_name,
                                    undefined,
                                    histItem.description
                                  )
                                }
                                disabled={isSelectingFile}
                                className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[10px] font-semibold border border-indigo-500/30 transition-all disabled:opacity-50"
                              >
                                {isSelectingFile ? 'Activating...' : 'Re-activate this File'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 2: Outbound Email Delivery Service (Only if tool sends Gmail) */}
          {hasGmail && (
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Outbound Email Delivery Service (Gmail)
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                  Gmail Send
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold text-white block">
                  Personal Google Account (via OAuth Authorization)
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Dispatches outgoing messages directly from your personal Gmail address using user delegation token.
                </p>
                {oauthConnected ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium pt-1 border-t border-slate-800/80">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Gmail OAuth Connected ({oauthEmail || 'Authorized'})</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium pt-1 border-t border-slate-800/80">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Gmail permission required below before re-executing jobs.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 3: Other Google Products Integration Notice */}
          {otherProducts.length > 0 && (
            <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-start gap-3">
              <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <span className="font-bold text-white block">
                  Required Integration: {otherProducts.map(formatProductName).join(', ')}
                </span>
                <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  This tool integrates with {otherProducts.map(formatProductName).join(' and ')}. Permissions will be included in the authorization below.
                </p>
              </div>
            </div>
          )}

          {/* Section 4: Google OAuth Authorization Required (Matching ToolDeployModal) */}
          {needsOAuth && (
            <div className="space-y-3 p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-indigo-400" />
                  <span>Google OAuth Authorization Required</span>
                </h4>
                <div className="flex items-center gap-1 flex-wrap">
                  {requiredOAuthProducts.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20"
                    >
                      {formatProductName(p)}
                    </span>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                Authorize access to your Google account for {requiredOAuthProducts.map(formatProductName).join(', ')}. All required permissions are requested in a single consent screen. No personal profile data is accessed.
              </p>

              <GoogleOAuthConsentButton
                userId={effectiveUserId}
                scope={computedScope}
                requiredProducts={requiredOAuthProducts}
                onStatusChange={(connected, email) => {
                  setOauthConnected(connected);
                  if (email) setOauthEmail(email);
                  if (connected && hasFileProducts) {
                    handleCheckFileAccess();
                  }
                }}
                onSuccess={(email) => {
                  setOauthConnected(true);
                  if (email) setOauthEmail(email);
                  if (hasFileProducts) {
                    handleCheckFileAccess();
                  }
                }}
              />
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Button: Restart / Resume Execution */}
          <div className="pt-2">
            <button
              onClick={handleRestartExecution}
              disabled={isRetrying || (needsOAuth && !oauthConnected)}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition-all active:scale-[0.99]"
            >
              {isRetrying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Re-verifying OAuth &amp; Resuming Webhook(s)...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>
                    {jobInfo?.pending_failed_count && jobInfo.pending_failed_count > 1
                      ? `Resume All ${jobInfo.pending_failed_count} Pending Webhooks for this Deployment`
                      : 'Restart Webhook Execution'}
                  </span>
                </>
              )}
            </button>
            {needsOAuth && !oauthConnected && (
              <p className="text-[11px] text-center text-slate-500 mt-2">
                Please complete Google OAuth authorization above to enable webhook re-execution.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OAuthReauthPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 space-y-4">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <p className="text-xs text-slate-400 font-mono">Initializing authentication...</p>
          </div>
        }
      >
        <OAuthReauthContent />
      </Suspense>
    </AppShell>
  );
}

