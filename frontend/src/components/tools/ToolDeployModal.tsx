'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, UserToolDeployment } from '@/lib/types';
import {
  X,
  Share2,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Terminal,
} from 'lucide-react';

interface ToolDeployModalProps {
  tool: CustomTool | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ToolDeployModal({ tool, isOpen, onClose }: ToolDeployModalProps) {
  const { user } = useUser();
  const currentUserId = user?.id || 'user_dev';

  const [notificationEmail, setNotificationEmail] = useState(
    user?.primaryEmailAddress?.emailAddress || ''
  );
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployment, setDeployment] = useState<UserToolDeployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !tool) return null;

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeploying(true);
    setError(null);

    try {
      const res = await apiClient.deployTool({
        tool_id: tool.id,
        user_id: currentUserId,
        config_data: { user_email: notificationEmail },
      });
      setDeployment(res);
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

  const handleClose = () => {
    setDeployment(null);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-xl my-8 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Deploy Personal Instance
              </h2>
              <p className="text-xs text-slate-400">
                Generate an isolated webhook endpoint for {tool.title}
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

        <div className="p-6 space-y-5 overflow-y-auto">
          {!deployment ? (
            <form onSubmit={handleDeploy} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Notification Email (Optional)
                </label>
                <input
                  type="email"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  placeholder="alerts@company.com"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Will receive completion or failure reports when webhooks are ingested and processed.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isDeploying}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Provisioning Instance...</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4" />
                    <span>Deploy &amp; Generate Webhook</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Instance deployed successfully!</span>
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
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* cURL Example */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
                <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mb-2">
                  <Terminal className="w-3 h-3 text-slate-400" />
                  <span>Test with cURL:</span>
                </div>
                <pre className="text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap select-all">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello from external webhook"}'`}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end shrink-0">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
