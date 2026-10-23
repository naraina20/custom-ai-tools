'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, UserToolDeployment, AgentRunResponse } from '@/lib/types';
import {
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  KeyRound,
  ShieldAlert,
  Loader2,
  RefreshCw,
  Terminal,
  Share2,
  Layers,
  Clock,
  ChevronDown,
  Copy,
  Check,
  GitBranch,
} from 'lucide-react';

interface ToolExecuteModalProps {
  tool: CustomTool | null;
  isOpen: boolean;
  onClose: () => void;
  userDeployments?: UserToolDeployment[];
  onOpenDeploy?: (tool: CustomTool) => void;
}

export function ToolExecuteModal({
  tool,
  isOpen,
  onClose,
  userDeployments: propDeployments,
  onOpenDeploy,
}: ToolExecuteModalProps) {
  const { user } = useUser();
  const currentUserId = user?.id || 'guest_user';

  // Deployments for this specific tool
  const [deployments, setDeployments] = useState<UserToolDeployment[]>([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<number | null>(null);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Runtime payload input for execution (optional webhook/test payload)
  const [runtimePayload, setRuntimePayload] = useState('{\n  "event": "manual_app_execution",\n  "status": "active"\n}');

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [executionResponse, setExecutionResponse] = useState<AgentRunResponse | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // HITL decision in flight
  const [isDeciding, setIsDeciding] = useState(false);

  // Fetch or filter user deployments on open
  useEffect(() => {
    if (!isOpen || !tool) return;

    setExecutionResponse(null);
    setExecutionError(null);

    async function loadDeployments() {
      setIsLoadingDeployments(true);
      try {
        const fetched = await apiClient.getUserDeployments(currentUserId, tool!.id);
        setDeployments(fetched);
        if (fetched.length > 0) {
          setSelectedDeploymentId(fetched[0].id);
        } else {
          setSelectedDeploymentId(null);
        }
      } catch (err) {
        // Fallback to prop deployments if API fails
        if (propDeployments) {
          const filtered = propDeployments.filter(
            (d) => (typeof d.tool === 'object' ? d.tool.id : d.tool) === tool!.id
          );
          setDeployments(filtered);
          if (filtered.length > 0) setSelectedDeploymentId(filtered[0].id);
        }
      } finally {
        setIsLoadingDeployments(false);
      }
    }

    loadDeployments();
  }, [isOpen, tool, currentUserId, propDeployments]);

  if (!isOpen || !tool) return null;

  const selectedDeployment = deployments.find((d) => d.id === selectedDeploymentId) || deployments[0];

  const host = typeof window !== 'undefined' ? window.location.origin : '';
  const activeWebhookSecret = selectedDeployment?.user_webhook_secret || tool.webhook_secret;
  const activeWebhookUrl = activeWebhookSecret ? `${host}/api/proxy/webhooks/${activeWebhookSecret}/` : '';

  const handleCopyWebhook = () => {
    if (!activeWebhookUrl) return;
    navigator.clipboard.writeText(activeWebhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeployment) return;

    setIsRunning(true);
    setExecutionError(null);
    setExecutionResponse(null);

    let parsedPayload: Record<string, any> = {};
    try {
      if (runtimePayload.trim()) {
        parsedPayload = JSON.parse(runtimePayload);
      }
    } catch {
      parsedPayload = { raw_payload: runtimePayload.trim() };
    }

    try {
      const res = await apiClient.runAgent({
        tool_id: tool.id,
        user_id: currentUserId,
        input_data: parsedPayload,
        deploy_tool_data: selectedDeployment.config_data || {},
      });
      setExecutionResponse(res);
    } catch (err: any) {
      setExecutionError(err.message || 'Execution failed. Please verify backend connection.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleDecision = async (decision: 'approve' | 'reject') => {
    if (!executionResponse?.thread_id) return;
    setIsDeciding(true);
    setExecutionError(null);

    try {
      const res = await apiClient.submitDecision({
        thread_id: executionResponse.thread_id,
        decision,
      });
      setExecutionResponse(res);
    } catch (err: any) {
      setExecutionError(err.message || `Failed to submit ${decision} decision.`);
    } finally {
      setIsDeciding(false);
    }
  };

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
              <Play className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Execute {tool.title}
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {tool.slug}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoadingDeployments ? (
            <div className="p-12 text-center space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400 mx-auto" />
              <p className="text-xs text-slate-400">Loading your deployed instances...</p>
            </div>
          ) : deployments.length === 0 ? (
            /* User has not deployed this tool yet */
            <div className="p-8 text-center space-y-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
                <Share2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  Tool Deployment Required
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  You have not deployed this tool yet. Deployment is required so that the tool has your configured endpoints and email credentials.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onOpenDeploy) onOpenDeploy(tool);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                <Share2 className="w-4 h-4" />
                <span>Deploy This Tool Now</span>
              </button>

              {/* Optional Shared Webhook Endpoint */}
              {activeWebhookUrl && (
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-left space-y-2 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Shared Tool Webhook Endpoint</span>
                    </span>
                    <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 font-mono">
                      POST
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 pl-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <code className="text-[11px] font-mono text-cyan-300 truncate flex-1 select-all">
                      {activeWebhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyWebhook}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium transition-all shrink-0"
                    >
                      {copiedWebhook ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* User has 1+ deployments */
            <form onSubmit={handleRunAgent} className="space-y-5">
              {/* Deployment Instance Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Select Deployed Instance</span>
                  </label>
                  <span className="text-[10px] text-indigo-300 font-mono bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    {deployments.length} instance{deployments.length === 1 ? '' : 's'} available
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {deployments.map((dep, idx) => {
                    const isSelected = dep.id === selectedDeployment?.id;
                    const emailChannel = dep.config_data?.email_channel_choice || 'platform_default';
                    const targetEmail = dep.config_data?.user_email || dep.config_data?.personal_email || 'default';
                    const targetApi = dep.config_data?.forward_api_url || dep.config_data?.api_url || '';

                    return (
                      <div
                        key={dep.id}
                        onClick={() => setSelectedDeploymentId(dep.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start justify-between gap-3 ${
                          isSelected
                            ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500/50'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">
                              Instance #{idx + 1}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              ID: {dep.id}
                            </span>
                            <span className="text-[10px] px-2 py-0.2 rounded-full bg-slate-800 text-slate-300 capitalize">
                              {emailChannel.replace('_', ' ')}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400 space-y-0.5 truncate">
                            {targetEmail && (
                              <p className="truncate">Email: <span className="text-slate-200">{targetEmail}</span></p>
                            )}
                            {targetApi && (
                              <p className="truncate">API: <span className="text-slate-200 font-mono">{targetApi}</span></p>
                            )}
                            <p className="text-[10px] text-slate-500">
                              Deployed on {new Date(dep.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>

                        <input
                          type="radio"
                          name="selectedDeployment"
                          checked={isSelected}
                          onChange={() => setSelectedDeploymentId(dep.id)}
                          className="mt-1 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700 shrink-0"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Deployed Inbound Webhook URL Box */}
              {activeWebhookUrl && (
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Inbound Webhook URL</span>
                    </span>
                    <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 font-mono">
                      POST Endpoint
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Trigger this deployed tool instance from external systems (Stripe, GitHub, Zapier, curl) by dispatching an HTTP POST request to this endpoint.
                  </p>

                  <div className="flex items-center gap-2 p-1.5 pl-3 rounded-lg bg-slate-900 border border-slate-800">
                    <code className="text-xs font-mono text-cyan-300 truncate flex-1 select-all">
                      {activeWebhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyWebhook}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all active:scale-95 shrink-0"
                    >
                      {copiedWebhook ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-300" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Display Selected Instance Config Data Preview */}
              {selectedDeployment && (
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                    <span className="font-semibold text-slate-300">
                      Configuration for this Execution
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Active Instance Data
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
                    {Object.entries(selectedDeployment.config_data || {}).map(([k, v]) => (
                      <div key={k} className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <span className="text-slate-400 block font-mono text-[10px] uppercase">{k}</span>
                        <span className="text-slate-200 truncate block mt-0.5">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Runtime Test/Trigger Payload (Optional) */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Runtime Execution Payload (JSON)
                </label>
                <textarea
                  rows={3}
                  value={runtimePayload}
                  onChange={(e) => setRuntimePayload(e.target.value)}
                  placeholder="Enter JSON payload for execution..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Passed to the LangGraph pipeline along with the selected instance&apos;s deployment parameters.
                </p>
              </div>

              {executionError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{executionError}</span>
                </div>
              )}

              {/* Execute Submit Button */}
              <button
                type="submit"
                disabled={isRunning}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.99]"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Executing LangGraph Autonomous Workflow...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Execute Tool with Selected Instance</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* HITL Interrupt Section: Pending Human Approval */}
          {executionResponse?.status === 'pending_human_approval' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-200">
                    Human Authorization Required (HITL)
                  </h3>
                  <p className="text-xs text-amber-300/80">
                    Execution halted before executing external side-effects. Please review and approve.
                  </p>
                </div>
              </div>

              {executionResponse.plans && executionResponse.plans.length > 0 && (
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                    Planned Execution Actions
                  </span>
                  <pre className="text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(executionResponse.plans, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleDecision('approve')}
                  disabled={isDeciding}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 transition-all"
                >
                  {isDeciding ? 'Submitting Approval...' : 'Approve & Resume Flow'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDecision('reject')}
                  disabled={isDeciding}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600/80 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-bold transition-all"
                >
                  Reject &amp; Terminate
                </button>
              </div>
            </motion.div>
          )}

          {/* Execution Result Summary View */}
          {executionResponse && executionResponse.status !== 'pending_human_approval' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {executionResponse.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span className="text-xs font-bold text-white capitalize">
                    Execution {executionResponse.status}
                  </span>
                </div>
                {executionResponse.thread_id && (
                  <span className="text-[10px] font-mono text-slate-400">
                    Thread: {executionResponse.thread_id.substring(0, 8)}...
                  </span>
                )}
              </div>

              {executionResponse.result?.summary && (
                <p className="text-xs text-slate-300 leading-relaxed">
                  {executionResponse.result.summary}
                </p>
              )}

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                  Full Pipeline Result
                </span>
                <pre className="text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap max-h-48">
                  {JSON.stringify(executionResponse.result || executionResponse, null, 2)}
                </pre>
              </div>
            </motion.div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
