'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, UserToolDeployment } from '@/lib/types';
import { GoogleOAuthConsentButton } from './GoogleOAuthConsentButton';
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
} from 'lucide-react';

interface ToolDeployModalProps {
  tool: CustomTool | null;
  isOpen: boolean;
  onClose: () => void;
  onDeploySuccess?: (deployment: UserToolDeployment) => void;
}

export function ToolDeployModal({ tool, isOpen, onClose, onDeploySuccess }: ToolDeployModalProps) {
  const { user } = useUser();
  const currentUserId = user?.id || 'guest_user';

  // Config data fields generated from tool schema
  const [configValues, setConfigValues] = useState<Record<string, any>>({});

  // 3 Email delivery options: 'oauth' | 'app_password' | 'platform_default'
  const [emailChannel, setEmailChannel] = useState<'oauth' | 'app_password' | 'platform_default'>('platform_default');
  const [appEmail, setAppEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [isOAuthGranted, setIsOAuthGranted] = useState(false);
  const [oauthAccountEmail, setOauthAccountEmail] = useState('');

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployment, setDeployment] = useState<UserToolDeployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      setEmailChannel('platform_default');
      setAppEmail('');
      setAppPassword('');
    }
  }, [tool, isOpen]);

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
        user_email: effectiveEmail,
        personal_email: effectiveEmail,
        gmail_app_email: appEmail.trim(),
        gmail_app_password: appPassword.trim(),
        oauth_granted: emailChannel === 'oauth',
        oauth_provider: emailChannel === 'oauth' ? 'google' : 'none',
        oauth_email: emailChannel === 'oauth' ? effectiveEmail : '',
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

              {/* 3 Email Channel Options */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Outbound Email Delivery Service
                </h4>
                <p className="text-[11px] text-slate-400">
                  Select which account will dispatch outgoing emails (welcome emails, reports, alerts):
                </p>

                <div className="grid grid-cols-1 gap-2.5">
                  {/* Option 1: Personal Account OAuth */}
                  <div
                    className={`p-3.5 rounded-xl border transition-all ${
                      emailChannel === 'oauth'
                        ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                        : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="emailChannel"
                        value="oauth"
                        checked={emailChannel === 'oauth'}
                        onChange={() => setEmailChannel('oauth')}
                        className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">
                          Personal Google Account (via OAuth Authorization)
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Dispatches emails directly from your personal Gmail address using user delegation token.
                        </span>
                      </div>
                    </label>

                    {emailChannel === 'oauth' && (
                      <div className="pl-7 mt-2 pt-2 border-t border-slate-800/80">
                        <GoogleOAuthConsentButton
                          userId={currentUserId}
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
                  </div>

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

              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isDeploying || (emailChannel === 'oauth' && !isOAuthGranted)}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition-all"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Provisioning Instance...</span>
                  </>
                ) : emailChannel === 'oauth' && !isOAuthGranted ? (
                  <>
                    <Lock className="w-4 h-4 text-amber-300" />
                    <span>Grant Google Consent to Enable Deploy</span>
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
