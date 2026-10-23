'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, AgentRunResponse } from '@/lib/types';
import {
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  KeyRound,
  ShieldCheck,
  Loader2,
  RefreshCw,
  Terminal,
  ExternalLink,
} from 'lucide-react';

interface ToolExecuteModalProps {
  tool: CustomTool | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ToolExecuteModal({ tool, isOpen, onClose }: ToolExecuteModalProps) {
  const { user } = useUser();
  const currentUserId = user?.id || 'user_dev';

  // Form input state keyed by schema property
  const [inputs, setInputs] = useState<Record<string, any>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [executionResponse, setExecutionResponse] = useState<AgentRunResponse | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // HITL decision in flight
  const [isDeciding, setIsDeciding] = useState(false);

  // Initialize input defaults from tool schema
  useEffect(() => {
    if (tool && tool.form_schema?.properties) {
      const initial: Record<string, any> = {};
      Object.entries(tool.form_schema.properties).forEach(([key, prop]) => {
        initial[key] = prop.default !== undefined ? prop.default : (prop.type === 'boolean' ? false : '');
      });
      setInputs(initial);
      setExecutionResponse(null);
      setExecutionError(null);
    }
  }, [tool]);

  if (!isOpen || !tool) return null;

  const handleInputChange = (key: string, value: any) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    setExecutionError(null);
    setExecutionResponse(null);

    try {
      const res = await apiClient.runAgent({
        tool_id: tool.id,
        input_data: inputs,
        user_id: currentUserId,
      });
      setExecutionResponse(res);
    } catch (err: any) {
      setExecutionError(err.message || 'Execution failed. Please check backend connection.');
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
          {/* OAuth Integration Notice if tool requires OAuth */}
          {tool.requires_oauth && tool.oauth_provider !== 'none' && (
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-start gap-3">
              <KeyRound className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-purple-200 capitalize">
                  {tool.oauth_provider} Authorization Configured
                </p>
                <p className="text-purple-300/80 leading-relaxed">
                  This tool leverages user delegation tokens for {tool.oauth_provider}. Tokens are securely fetched and managed server-side via backend OAuth service.
                </p>
              </div>
            </div>
          )}

          {/* Dynamic Form generated from tool schema */}
          <form onSubmit={handleRunAgent} className="space-y-4">
            <div className="border-b border-slate-800 pb-2">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Input Parameters
              </h3>
            </div>

            {Object.keys(properties).length === 0 ? (
              <p className="text-xs text-slate-500 italic">
                This tool does not define any input parameters.
              </p>
            ) : (
              Object.entries(properties).map(([key, prop]) => {
                const isRequired = requiredKeys.includes(key);

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-medium text-slate-200">
                        {prop.title || key} {isRequired && <span className="text-rose-400">*</span>}
                      </label>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {prop.type}
                      </span>
                    </div>

                    {prop.description && (
                      <p className="text-[11px] text-slate-400 leading-snug">
                        {prop.description}
                      </p>
                    )}

                    {prop.type === 'boolean' ? (
                      <label className="flex items-center gap-2 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!inputs[key]}
                          onChange={(e) => handleInputChange(key, e.target.checked)}
                          className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700"
                        />
                        <span className="text-xs text-slate-300">Enabled</span>
                      </label>
                    ) : prop.type === 'number' ? (
                      <input
                        type="number"
                        required={isRequired}
                        value={inputs[key] ?? ''}
                        onChange={(e) => handleInputChange(key, parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    ) : (
                      <input
                        type="text"
                        required={isRequired}
                        value={inputs[key] ?? ''}
                        onChange={(e) => handleInputChange(key, e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    )}
                  </div>
                );
              })
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isRunning}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Executing LangGraph Agent Flow...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start Execution</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Execution Error Banner */}
          {executionError && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-rose-200">Execution Error</p>
                <p className="text-rose-300 leading-relaxed">{executionError}</p>
              </div>
            </div>
          )}

          {/* HITL Interrupt Section: Pending Human Approval */}
          {executionResponse?.status === 'pending_human_approval' && (
            <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-amber-200">
                    Human-in-the-Loop Approval Required
                  </h4>
                  <p className="text-xs text-amber-300/80 mt-1">
                    The agent completed initial planning and safely paused execution. Your authorization is required to execute external actions.
                  </p>
                  <p className="text-[11px] font-mono text-amber-400/70 mt-1">
                    Thread ID: {executionResponse.thread_id}
                  </p>
                </div>
              </div>

              {/* Proposed Plans */}
              {executionResponse.plans && executionResponse.plans.length > 0 && (
                <div className="bg-slate-950/70 rounded-lg p-3 text-xs border border-amber-500/20 font-mono space-y-1">
                  <div className="text-[11px] font-sans font-semibold text-amber-300 mb-1">
                    Proposed Action Plans:
                  </div>
                  {executionResponse.plans.map((p, i) => (
                    <div key={i} className="text-slate-300 text-[11px]">
                      • {typeof p === 'object' ? JSON.stringify(p) : String(p)}
                    </div>
                  ))}
                </div>
              )}

              {/* Decision Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleDecision('approve')}
                  disabled={isDeciding}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all"
                >
                  {isDeciding ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Approve &amp; Resume</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDecision('reject')}
                  disabled={isDeciding}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-rose-600/20 transition-all"
                >
                  {isDeciding ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  <span>Reject &amp; Abort</span>
                </button>
              </div>
            </div>
          )}

          {/* Execution Completed Successfully */}
          {executionResponse?.status === 'completed' && (
            <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span className="text-sm font-bold">Execution Completed</span>
              </div>

              {executionResponse.result?.summary && (
                <div className="text-xs text-slate-200 bg-slate-950/70 p-3 rounded-lg border border-slate-800 leading-relaxed">
                  {executionResponse.result.summary}
                </div>
              )}

              {/* Structured JSON Output preview */}
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-1.5">
                  <span className="flex items-center gap-1">
                    <Terminal className="w-3.5 h-3.5 text-slate-400" /> Output Payload
                  </span>
                  <span>{executionResponse.result?.executed_at || 'Just now'}</span>
                </div>
                <pre className="text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-48 scrollbar-thin">
                  {JSON.stringify(executionResponse.result || executionResponse, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Execution Rejected */}
          {executionResponse?.status === 'rejected' && (
            <div className="p-4 rounded-xl bg-slate-950 border border-rose-500/30 flex items-center gap-3 text-rose-300 text-xs">
              <XCircle className="w-5 h-5 shrink-0" />
              <span>Workflow execution was rejected by human operator. Execution stopped.</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end shrink-0">
          <button
            type="button"
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
