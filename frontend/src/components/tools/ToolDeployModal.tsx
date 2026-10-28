'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, UserToolDeployment, GooglePickerDoc } from '@/lib/types';
import { GoogleOAuthConsentButton, isProductGranted } from './GoogleOAuthConsentButton';
import { GoogleDrivePicker } from './GoogleDrivePicker';
import { COMPANY_NAME } from '@/config/site';
import {
  X,
  Share2,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Terminal,
  Mail,
  KeyRound,
  ShieldCheck,
  PlusCircle,
  Lock,
  FolderCheck,
} from 'lucide-react';

interface ToolDeployModalProps {
  tool: CustomTool | null;
  isOpen: boolean;
  onClose: () => void;
  onDeploySuccess?: (deployment: UserToolDeployment) => void;
}

function formatProductName(prod: string): string {
  const p = prod.toLowerCase().trim();
  if (p.includes('sheet')) return 'Google Sheets';
  if (p === 'drive_picker') return 'Google Drive (Picker)';
  if (p.includes('drive')) return 'Google Drive';
  if (p.includes('doc')) return 'Google Docs';
  if (p.includes('meet')) return 'Google Meet';
  if (p.includes('calendar')) return 'Google Calendar';
  if (p.includes('form')) return 'Google Forms';
  if (p.includes('gmail') || p.includes('mail')) return 'Gmail';
  return prod.charAt(0).toUpperCase() + prod.slice(1);
}

function normalizeGoogleProduct(raw: string): string | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (s.includes('sheet')) return 'sheets';
  if (s.includes('doc')) return 'docs';
  if (s.includes('drive')) return 'drive';
  if (s.includes('gmail') || s.includes('mail')) return 'gmail';
  if (s.includes('meet')) return 'meet';
  if (s.includes('calendar')) return 'calendar';
  if (s.includes('form')) return 'forms';
  return s;
}

export function ToolDeployModal({ tool, isOpen, onClose, onDeploySuccess }: ToolDeployModalProps) {
  const { user } = useUser();
  const currentUserId = user?.id || 'guest_user';

  // Config data fields generated from tool schema
  const [configValues, setConfigValues] = useState<Record<string, any>>({});

  // 3 File access options: 'oauth_full' | 'granular_picker' | 'share_email'
  const [fileAccessChoice, setFileAccessChoice] = useState<'oauth_full' | 'granular_picker' | 'share_email'>('share_email');
  const [pickedGoogleFile, setPickedGoogleFile] = useState<GooglePickerDoc | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  // 3 Email delivery options: 'oauth' | 'app_password' | 'platform_default'
  const [emailChannel, setEmailChannel] = useState<'oauth' | 'app_password' | 'platform_default'>('platform_default');
  const [appEmail, setAppEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [isOAuthGranted, setIsOAuthGranted] = useState(false);
  const [oauthAccountEmail, setOauthAccountEmail] = useState('');
  const [grantedProducts, setGrantedProducts] = useState<string[]>([]);
  const [grantedScopes, setGrantedScopes] = useState<string[]>([]);

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployment, setDeployment] = useState<UserToolDeployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync user's granted Google products from status API
  const syncUserOAuthStatus = useCallback(async () => {
    if (!currentUserId || currentUserId === 'guest_user') return;
    try {
      const res = await apiClient.getGoogleOAuthStatus(currentUserId);
      if (res.connected) {
        setGrantedProducts(res.granted_products || []);
        setGrantedScopes(res.granted_scopes || []);
        if (res.email) setOauthAccountEmail(res.email);
      } else {
        setGrantedProducts([]);
        setGrantedScopes([]);
      }
    } catch (e) {}
  }, [currentUserId]);

  useEffect(() => {
    if (isOpen) {
      syncUserOAuthStatus();
    }
  }, [isOpen, syncUserOAuthStatus]);

  // Initialize form values from tool schema when modal opens
  useEffect(() => {
    if (tool && tool.form_schema?.properties) {
      const initial: Record<string, any> = {};
      Object.entries(tool.form_schema.properties).forEach(([key, prop]) => {
        initial[key] = prop.default !== undefined ? prop.default : (prop.type === 'boolean' ? false : '');
      });
      setConfigValues(initial);
      setDeployment(null);
      setError(null);
      setFileAccessChoice('share_email');
      setPickedGoogleFile(null);
      setEmailCopied(false);
      setEmailChannel('platform_default');
      setAppEmail('');
      setAppPassword('');
    }
  }, [tool, isOpen]);

  // Product Detection & Dynamic OAuth Scope Calculation
  const toolDetected: string[] = (tool?.google_products && tool.google_products.length > 0)
    ? tool.google_products
    : (tool?.google_products_detected && tool.google_products_detected.length > 0)
      ? tool.google_products_detected
      : [];

  const titleDescScan = `${tool?.title || ''} ${tool?.description || ''} ${tool?.specification_summary || ''}`.toLowerCase();
  const toolFinalProductsSet = new Set<string>();
  toolDetected.forEach((p: string) => {
    const norm = normalizeGoogleProduct(p);
    if (norm) toolFinalProductsSet.add(norm);
  });

  if (titleDescScan.includes('sheet')) toolFinalProductsSet.add('sheets');
  if (titleDescScan.includes('drive')) toolFinalProductsSet.add('drive');
  if (titleDescScan.includes('doc')) toolFinalProductsSet.add('docs');
  if (titleDescScan.includes('meet')) toolFinalProductsSet.add('meet');
  if (titleDescScan.includes('calendar')) toolFinalProductsSet.add('calendar');
  if (titleDescScan.includes('forms') || titleDescScan.includes('form')) toolFinalProductsSet.add('forms');
  if (titleDescScan.includes('gmail') || titleDescScan.includes('email') || titleDescScan.includes('mail')) toolFinalProductsSet.add('gmail');

  const finalProducts = Array.from(toolFinalProductsSet);

  // File products (sheets, drive, docs) - strictly normalized to avoid duplicate badges
  const fileProducts = finalProducts.filter((p) => ['sheets', 'drive', 'docs'].includes(p));
  const hasFileProducts = fileProducts.length > 0;

  // Gmail
  const hasGmail = finalProducts.includes('gmail') || titleDescScan.includes('email') || titleDescScan.includes('mail');

  // Other products (meet, calendar, forms)
  const otherProducts = finalProducts.filter((p) => !['sheets', 'drive', 'docs', 'gmail'].includes(p));

  // Dynamic Scope Construction
  const scopeParts = ['https://www.googleapis.com/auth/userinfo.email', 'openid'];
  const requiredOAuthProducts: string[] = [];

  // 1. Gmail OAuth - check if already granted
  const isGmailGranted = isProductGranted('gmail', grantedProducts, grantedScopes);
  const emailNeedsOAuth = hasGmail && emailChannel === 'oauth' && !isGmailGranted;
  if (emailNeedsOAuth) {
    scopeParts.push('https://www.googleapis.com/auth/gmail.send');
    if (!requiredOAuthProducts.includes('gmail')) requiredOAuthProducts.push('gmail');
  }

  // 2. File products OAuth
  // Note: 'granular_picker' handles drive.file authorization directly inside GoogleDrivePicker component.
  // Only 'oauth_full' requires broad scopes at deployment level if not already granted.
  let fileNeedsOAuth = false;
  if (hasFileProducts && fileAccessChoice === 'oauth_full') {
    fileProducts.forEach((p) => {
      if (!isProductGranted(p, grantedProducts, grantedScopes)) {
        fileNeedsOAuth = true;
        if (p === 'sheets') scopeParts.push('https://www.googleapis.com/auth/spreadsheets');
        if (p === 'drive') scopeParts.push('https://www.googleapis.com/auth/drive');
        if (p === 'docs') scopeParts.push('https://www.googleapis.com/auth/documents');
        if (!requiredOAuthProducts.includes(p)) requiredOAuthProducts.push(p);
      }
    });
  }

  // 3. Other products (e.g. meet, calendar, forms)
  let otherNeedsOAuth = false;
  otherProducts.forEach((p) => {
    if (!isProductGranted(p, grantedProducts, grantedScopes)) {
      otherNeedsOAuth = true;
      if (p === 'meet') {
        scopeParts.push('https://www.googleapis.com/auth/meetings.space.created');
        if (!requiredOAuthProducts.includes('meet')) requiredOAuthProducts.push('meet');
      }
      if (p === 'calendar') {
        scopeParts.push('https://www.googleapis.com/auth/calendar.events');
        if (!requiredOAuthProducts.includes('calendar')) requiredOAuthProducts.push('calendar');
      }
      if (p === 'forms') {
        scopeParts.push('https://www.googleapis.com/auth/forms.body');
        if (!requiredOAuthProducts.includes('forms')) requiredOAuthProducts.push('forms');
      }
    }
  });

  const computedScope = Array.from(new Set(scopeParts)).join(' ');
  const needsOAuth = emailNeedsOAuth || fileNeedsOAuth || otherNeedsOAuth;

  if (!isOpen || !tool) return null;

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeploying(true);
    setError(null);

    try {
      const effectiveEmail = emailChannel === 'app_password'
        ? appEmail.trim()
        : (emailChannel === 'oauth' ? (oauthAccountEmail || user?.primaryEmailAddress?.emailAddress || '') : (user?.primaryEmailAddress?.emailAddress || ''));

      const configData: Record<string, any> = {
        ...configValues,
        email_channel_choice: emailChannel,
        file_access_choice: hasFileProducts ? fileAccessChoice : 'none',
        file_products: fileProducts,
        oauth_scope: computedScope,
        user_email: effectiveEmail,
        personal_email: effectiveEmail,
        gmail_app_email: appEmail.trim(),
        gmail_app_password: appPassword.trim(),
        oauth_granted: needsOAuth ? isOAuthGranted : true,
        oauth_provider: needsOAuth ? 'google' : 'none',
        oauth_email: oauthAccountEmail || effectiveEmail,
        google_file_id: pickedGoogleFile?.id,
        google_file_name: pickedGoogleFile?.name,
        google_file_mime: pickedGoogleFile?.mimeType,
        google_file_url: pickedGoogleFile?.url,
      };

      const res = await apiClient.deployTool({
        tool_id: tool.id,
        user_id: currentUserId,
        config_data: configData,
      });

      setDeployment(res);
      if (onDeploySuccess) {
        onDeploySuccess(res);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to deploy tool instance.');
    } finally {
      setIsDeploying(false);
    }
  };

  const host = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookSecret = deployment?.user_webhook_secret;
  const webhookUrl = webhookSecret ? `${host}/api/proxy/webhooks/${webhookSecret}/` : '';

  const handleCopy = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetForAnotherDeploy = () => {
    setDeployment(null);
    setError(null);
  };

  const handleClose = () => {
    setDeployment(null);
    setError(null);
    onClose();
  };

  const properties = tool.form_schema?.properties || {};
  const requiredKeys = tool.form_schema?.required || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-2xl my-8 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Deploy Tool: {tool.title}
              </h2>
              <p className="text-xs text-slate-400">
                Configure operational parameters and email identity to generate a dedicated webhook instance.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {!deployment ? (
            <form onSubmit={handleDeploy} className="space-y-6">
              {/* Tool summary card */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
                <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider block mb-1">
                  Target AI Tool
                </span>
                <p className="font-semibold text-slate-100">{tool.title}</p>
                <p className="text-slate-400 text-[11px] mt-0.5 line-clamp-2">
                  {tool.description}
                </p>
              </div>

              {/* Dynamic Input Properties from Schema */}
              {Object.keys(properties).length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Deployment Configuration Parameters
                  </h4>
                  <div className="grid grid-cols-1 gap-3.5 p-4 rounded-xl bg-slate-950/50 border border-slate-800">
                    {Object.entries(properties).map(([key, prop]) => (
                      <div key={key}>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          {prop.title || key}
                          {requiredKeys.includes(key) && (
                            <span className="text-indigo-400 ml-1">*</span>
                          )}
                        </label>
                        {prop.type === 'boolean' ? (
                          <label className="flex items-center gap-2 cursor-pointer mt-1">
                            <input
                              type="checkbox"
                              checked={!!configValues[key]}
                              onChange={(e) =>
                                setConfigValues((prev) => ({
                                  ...prev,
                                  [key]: e.target.checked,
                                }))
                              }
                              className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                            />
                            <span className="text-xs text-slate-300">Enable</span>
                          </label>
                        ) : (
                          <input
                            type={prop.type === 'number' ? 'number' : 'text'}
                            value={configValues[key] !== undefined ? configValues[key] : ''}
                            onChange={(e) =>
                              setConfigValues((prev) => ({
                                ...prev,
                                [key]: prop.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                              }))
                            }
                            placeholder={`Enter ${prop.title || key}...`}
                            required={requiredKeys.includes(key)}
                            className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                        )}
                        {prop.description && (
                          <p className="text-[11px] text-slate-400 mt-1">{prop.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Google Workspace File Access (Sheets, Drive, Docs) */}
              {hasFileProducts && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <FolderCheck className="w-4 h-4 text-indigo-400" />
                      <span>Google Workspace File Access</span>
                    </h4>
                    <div className="flex items-center gap-1">
                      {fileProducts.map((p) => (
                        <span
                          key={p}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                        >
                          {formatProductName(p)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Choose how this tool instance should access your Google Sheets, Docs, or Drive files:
                  </p>

                  <div className="grid grid-cols-1 gap-2.5">
                    {/* Option 1: Total Access from Consent Screen */}
                    <label
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        fileAccessChoice === 'oauth_full'
                          ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="fileAccessChoice"
                        value="oauth_full"
                        checked={fileAccessChoice === 'oauth_full'}
                        onChange={() => setFileAccessChoice('oauth_full')}
                        className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">
                          Total Access from Consent Screen
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Grants full read/write access to {fileProducts.map(formatProductName).join(', ')} directly through Google OAuth consent.
                        </span>
                      </div>
                    </label>

                    {/* Option 2: Granular Access with Picker */}
                    <div
                      className={`p-3.5 rounded-xl border transition-all ${
                        fileAccessChoice === 'granular_picker'
                          ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="fileAccessChoice"
                          value="granular_picker"
                          checked={fileAccessChoice === 'granular_picker'}
                          onChange={() => setFileAccessChoice('granular_picker')}
                          className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                        />
                        <div>
                          <span className="text-xs font-semibold text-white block">
                            Granular Access with Google Drive Picker
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Limits authorization strictly to the specific files or spreadsheets you explicitly select via Google Drive Picker.
                          </span>
                        </div>
                      </label>

                      {fileAccessChoice === 'granular_picker' && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80">
                          <GoogleDrivePicker
                            userId={currentUserId}
                            viewMimeTypes="application/vnd.google-apps.spreadsheet"
                            supportDrives={true}
                            showUploadView={false}
                            buttonLabel="Select Spreadsheet from Google Drive"
                            selectedFile={pickedGoogleFile}
                            onFilePicked={(doc) => {
                              if (doc.mimeType === 'application/vnd.google-apps.folder' || (doc as any).type === 'folder') {
                                setError('Folders cannot be selected. Please choose a Google Sheet.');
                                return;
                              }
                              if (!doc.mimeType.includes('spreadsheet')) {
                                setError('Only Google Spreadsheets can be selected.');
                                return;
                              }
                              setError(null);
                              setPickedGoogleFile(doc);
                              setConfigValues((prev) => ({
                                ...prev,
                                google_file_id: doc.id,
                                google_file_name: doc.name,
                                google_file_mime: doc.mimeType,
                                google_file_url: doc.url,
                              }));
                            }}
                            onClearSelection={() => {
                              setPickedGoogleFile(null);
                              setConfigValues((prev) => {
                                const next = { ...prev };
                                delete next.google_file_id;
                                delete next.google_file_name;
                                delete next.google_file_mime;
                                delete next.google_file_url;
                                return next;
                              });
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Option 3: Share File with Working Email */}
                    <div
                      className={`p-3.5 rounded-xl border transition-all ${
                        fileAccessChoice === 'share_email'
                          ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="fileAccessChoice"
                          value="share_email"
                          checked={fileAccessChoice === 'share_email'}
                          onChange={() => setFileAccessChoice('share_email')}
                          className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                        />
                        <div>
                          <span className="text-xs font-semibold text-white block">
                            Share File with Working Email (No Consent Screen Required)
                          </span>
                          <span className="text-[11px] text-slate-400">
                            No OAuth consent screen needed. Share your Google Sheet or Doc with our service email.
                          </span>
                        </div>
                      </label>

                      {fileAccessChoice === 'share_email' && (
                        <div className="pl-7 mt-3 pt-3 border-t border-slate-800/80 space-y-2.5">
                          <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                                Working Service Email (Editor Permission)
                              </span>
                              <code className="text-xs font-mono text-emerald-400 font-medium truncate block">
                                narainad308@gmail.com
                              </code>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText('narainad308@gmail.com');
                                setEmailCopied(true);
                                setTimeout(() => setEmailCopied(false), 2000);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shrink-0"
                            >
                              {emailCopied ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy Email</span>
                                </>
                              )}
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-300">
                            💡 <span className="font-semibold text-slate-200">How to share:</span> Open your Google Sheet or Doc, click the <span className="text-white font-semibold">Share</span> button, add <span className="font-mono text-emerald-300">narainad308@gmail.com</span> with <span className="text-white font-semibold">Editor</span> permissions.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Other Google Products Integration Notice */}
              {otherProducts.length > 0 && (
                <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 shrink-0 mt-0.5">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="text-xs">
                    <span className="font-bold text-white block">
                      Required Google Integration: {otherProducts.map(formatProductName).join(', ')}
                    </span>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                      This tool integrates with {otherProducts.map(formatProductName).join(' and ')}. Permissions will be included in the Google OAuth authorization below.
                    </p>
                  </div>
                </div>
              )}

              {/* Outbound Email Delivery Service (Gmail) */}
              {hasGmail && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Mail className="w-4 h-4 text-indigo-400" />
                    <span>Outbound Email Delivery Service</span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Select which account will dispatch outgoing emails (welcome emails, reports, alerts):
                  </p>

                  <div className="grid grid-cols-1 gap-2.5">
                    {/* Option 1: Personal Account OAuth */}
                    <label
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        emailChannel === 'oauth'
                          ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="emailChannel"
                        value="oauth"
                        checked={emailChannel === 'oauth'}
                        onChange={() => setEmailChannel('oauth')}
                        className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                      />
                      <div className="w-full">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white block">
                            Personal Google Account (via OAuth Authorization)
                          </span>
                          {isGmailGranted && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Authorized</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 block mt-0.5">
                          Dispatches emails directly from your personal Gmail address using user delegation token.
                        </span>
                        {emailChannel === 'oauth' && (
                          <div className="mt-2 pt-2 border-t border-slate-800/80">
                            {isGmailGranted ? (
                              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Gmail OAuth Connected ({oauthAccountEmail || 'Authorized'})</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>Gmail permission required below before deployment.</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </label>

                    {/* Option 2: Provide App Password */}
                    <label
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        emailChannel === 'app_password'
                          ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="emailChannel"
                        value="app_password"
                        checked={emailChannel === 'app_password'}
                        onChange={() => setEmailChannel('app_password')}
                        className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                      />
                      <div className="w-full">
                        <span className="text-xs font-semibold text-white block">
                          Google Account App Password (Direct SMTP)
                        </span>
                        <span className="text-[11px] text-slate-400 block mb-2">
                          Provide your Google email and generated 16-character Google App Password.
                        </span>

                        {emailChannel === 'app_password' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800">
                            <div>
                              <label className="block text-[11px] text-slate-300 mb-1">
                                Google Account Email *
                              </label>
                              <input
                                type="email"
                                value={appEmail}
                                onChange={(e) => setAppEmail(e.target.value)}
                                placeholder="user@gmail.com"
                                required={emailChannel === 'app_password'}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-300 mb-1">
                                16-Character App Password *
                              </label>
                              <input
                                type="password"
                                value={appPassword}
                                onChange={(e) => setAppPassword(e.target.value)}
                                placeholder="xxxx xxxx xxxx xxxx"
                                required={emailChannel === 'app_password'}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </label>

                    {/* Option 3: Platform Default Account */}
                    <label
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        emailChannel === 'platform_default'
                          ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="emailChannel"
                        value="platform_default"
                        checked={emailChannel === 'platform_default'}
                        onChange={() => setEmailChannel('platform_default')}
                        className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">
                          Platform Default Outbound Email (narainad308@gmail.com)
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Uses {COMPANY_NAME} managed infrastructure. No OAuth or credentials configuration needed.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Google OAuth Authorization Section (if any product needs OAuth) */}
              {needsOAuth && (
                <div className="space-y-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
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
                    Authorize access to your Google account for {requiredOAuthProducts.map(formatProductName).join(', ')}:
                  </p>

                  <GoogleOAuthConsentButton
                    userId={currentUserId}
                    scope={computedScope}
                    requiredProducts={requiredOAuthProducts}
                    onStatusChange={(connected, email) => {
                      setIsOAuthGranted(connected);
                      if (email) setOauthAccountEmail(email);
                    }}
                    onSuccess={(email) => {
                      setIsOAuthGranted(true);
                      if (email) setOauthAccountEmail(email);
                    }}
                  />
                </div>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  isDeploying ||
                  (needsOAuth && !isOAuthGranted) ||
                  (hasGmail && emailChannel === 'oauth' && !isGmailGranted && !isOAuthGranted) ||
                  (hasFileProducts && fileAccessChoice === 'granular_picker' && !pickedGoogleFile) ||
                  (hasGmail && emailChannel === 'app_password' && (!appEmail.trim() || !appPassword.trim()))
                }
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition-all active:scale-[0.99]"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Provisioning Instance...</span>
                  </>
                ) : needsOAuth && !isOAuthGranted ? (
                  <>
                    <Lock className="w-4 h-4 text-amber-300" />
                    <span>Grant Google Consent ({requiredOAuthProducts.map(formatProductName).join(', ')}) to Deploy</span>
                  </>
                ) : hasFileProducts && fileAccessChoice === 'granular_picker' && !pickedGoogleFile ? (
                  <>
                    <FolderCheck className="w-4 h-4 text-amber-300" />
                    <span>Select a File from Google Drive to Deploy</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4" />
                    <span>Deploy Tool Instance</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            /* Confirmation after deployment */
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Tool instance deployed successfully! The Execute button on this tool is now active.</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Personal Webhook Endpoint
                </label>
                <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <code className="text-xs font-mono text-indigo-300 flex-1 truncate select-all">
                    {webhookUrl}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="p-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs transition-colors shrink-0"
                    title="Copy Webhook URL"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* cURL Example */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
                <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mb-2">
                  <Terminal className="w-3 h-3 text-slate-400" />
                  <span>Inbound Webhook Trigger Example:</span>
                </div>
                <pre className="text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap select-all">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"event": "trigger", "message": "Execute workflow"}'`}
                </pre>
              </div>

              {/* Config summary */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-1.5">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                  Active Deployment Configuration
                </span>
                <div className="flex justify-between">
                  <span className="text-slate-400">Email Dispatch:</span>
                  <span className="text-slate-200 capitalize">{emailChannel.replace('_', ' ')}</span>
                </div>
                {Object.entries(deployment.config_data || {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[11px]">
                    <span className="text-slate-400">{k}:</span>
                    <span className="text-slate-200 truncate max-w-xs">{String(v)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetForAnotherDeploy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Deploy Another Instance</span>
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                >
                  Close &amp; View Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
