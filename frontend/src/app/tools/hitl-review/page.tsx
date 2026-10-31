'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { apiClient } from '@/lib/api-client';
import { AgentHITLInfoResponse, AgentHITLActionCard } from '@/lib/types';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Mail,
  FileSpreadsheet,
  Cpu,
  ArrowRight,
  MessageSquare,
  Loader2,
  Clock,
  Sparkles,
  Info,
} from 'lucide-react';

function HITLReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadId = searchParams.get('thread_id');
  const toolId = searchParams.get('tool_id');

  const { user, isLoaded: isUserLoaded, isSignedIn } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hitlInfo, setHitlInfo] = useState<AgentHITLInfoResponse | null>(null);

  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [decisionResult, setDecisionResult] = useState<{
    status: 'approved' | 'rejected';
    message: string;
  } | null>(null);

  // Auth redirect with redirect_url
  useEffect(() => {
    if (isUserLoaded && !isSignedIn) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      router.push(`/sign-in?redirect_url=${returnUrl}`);
    }
  }, [isUserLoaded, isSignedIn, router]);

  // Fetch HITL State
  const fetchHITLInfo = useCallback(async () => {
    if (!threadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAgentHITLInfo(threadId, toolId || undefined);
      setHitlInfo(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve pending HITL approval data.');
    } finally {
      setLoading(false);
    }
  }, [threadId, toolId]);

  useEffect(() => {
    if (isSignedIn && threadId) {
      fetchHITLInfo();
    }
  }, [isSignedIn, threadId, fetchHITLInfo]);

  // Handle Approve or Reject
  const handleDecision = async (approved: boolean) => {
    if (!threadId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await apiClient.submitHITLDecision({
        thread_id: threadId,
        tool_id: hitlInfo?.tool_id || toolId || undefined,
        approved,
        feedback: feedback.trim() || undefined,
        user_id: user?.id,
      });

      setDecisionResult({
        status: approved ? 'approved' : 'rejected',
        message: (res as any)?.message || (approved
          ? 'Workflow approved! The agent is executing the verified actions in the background and streaming live updates.'
          : 'Workflow rejected. Execution has been safely terminated.'),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to submit decision.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isUserLoaded || loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 space-y-4">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        <p className="text-xs text-slate-400 font-mono">Loading human review checkpoint...</p>
      </div>
    );
  }

  // If user opens page without thread_id or no pending HITL exists
  if (!threadId || !hitlInfo) {
    return (
      <div className="max-w-xl mx-auto p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4 my-16">
        <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700/60 text-slate-400 flex items-center justify-center mx-auto">
          <Info className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-white">No Pending Approval Checkpoint</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
          There are currently no active actions awaiting human review for this link. If a workflow triggers a gatekeeper, you will receive an approval link via email or notification.
        </p>
        <div className="pt-2">
          <Link
            href="/tools"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-all shadow-md"
          >
            <span>Go to AI Tools Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  // Resolved checkpoint check: only block if status is terminal ('completed', 'approved', 'rejected')
  const isAlreadyResolved = ['completed', 'approved', 'rejected'].includes(hitlInfo.approval_status);
  if (isAlreadyResolved) {
    const isApproved = hitlInfo.approval_status === 'approved' || hitlInfo.approval_status === 'completed';
    return (
      <div className="max-w-xl mx-auto p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4 my-16">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto ${
            isApproved
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
          }`}
        >
          {isApproved ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
        </div>
        <h2 className="text-base font-bold text-white">
          {isApproved ? 'Review Already Completed' : 'Workflow Declined / Rejected'}
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          This checkpoint has already been processed with status:{' '}
          <span className={`font-mono font-semibold ${isApproved ? 'text-emerald-400' : 'text-rose-400'}`}>
            {hitlInfo.approval_status}
          </span>.
        </p>
        <div className="pt-2">
          <Link
            href="/tools"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-all"
          >
            <span>Return to Tools Dashboard</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6 my-6">
      {/* Banner */}
      <div className="flex items-center gap-3.5 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold text-white">
              Action Approval Required: {hitlInfo.tool_title || 'Agent Workflow'}
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Awaiting Approval
            </span>
          </div>
          <p className="text-xs text-amber-200/90 mt-0.5">
            This tool requires human confirmation before executing outbound actions. Review the proposed operations below:
          </p>
        </div>
      </div>

      {decisionResult ? (
        <div
          className={`p-6 rounded-2xl text-center space-y-4 ${
            decisionResult.status === 'approved'
              ? 'bg-emerald-500/10 border border-emerald-500/25'
              : 'bg-rose-500/10 border border-rose-500/25'
          }`}
        >
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto ${
              decisionResult.status === 'approved'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            }`}
          >
            {decisionResult.status === 'approved' ? (
              <CheckCircle2 className="w-6 h-6" />
            ) : (
              <XCircle className="w-6 h-6" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              {decisionResult.status === 'approved' ? 'Workflow Approved' : 'Workflow Rejected'}
            </h2>
            <p
              className={`text-xs mt-1 ${
                decisionResult.status === 'approved' ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {decisionResult.message}
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/tools"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-all"
            >
              <span>Back to AI Tools Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Working Process / Proposed Actions Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>Planned Operations ({hitlInfo.actions?.length || 0})</span>
              </h2>
              <span className="text-[11px] text-slate-500 font-mono">
                Thread: {threadId.slice(0, 12)}...
              </span>
            </div>

            {hitlInfo.actions && hitlInfo.actions.length > 0 ? (
              <div className="space-y-3">
                {hitlInfo.actions.map((act: AgentHITLActionCard, idx: number) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                        {act.icon === 'mail' ? (
                          <Mail className="w-4 h-4" />
                        ) : act.icon === 'spreadsheet' ? (
                          <FileSpreadsheet className="w-4 h-4" />
                        ) : (
                          <Cpu className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-white truncate">{act.title}</h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
                            {act.tool}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{act.description}</p>
                      </div>
                    </div>

                    {/* Rich Details Preview: Sheet Rows & Headers or Outbound Email Contents */}
                    {act.details && (
                      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-3">
                        {/* 1. Google Spreadsheet Data Table View */}
                        {act.tool === 'write_sheet' && (
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <span className="text-slate-400">
                                Target Spreadsheet:{' '}
                                <strong className="text-white font-mono">{act.details.sheet_title || 'Sheet1'}</strong>
                              </span>
                              <span className="font-mono text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                                {act.details.rows_count || (act.details.rows || []).length} rows generated by AI
                              </span>
                            </div>

                            {act.details.headers && act.details.headers.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[10px] uppercase font-mono text-slate-400 font-semibold block">
                                  Generated Spreadsheet Rows to Append:
                                </span>
                                <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/50 max-h-64 overflow-y-auto">
                                  <table className="w-full text-left border-collapse text-[11px]">
                                    <thead>
                                      <tr className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-10">
                                        {act.details.headers.map((h: string, hIdx: number) => (
                                          <th
                                            key={hIdx}
                                            className="px-3 py-2 text-slate-300 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap bg-slate-950"
                                          >
                                            {h || `Col ${hIdx + 1}`}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                                      {(act.details.rows || act.details.sample_rows || []).map((row: any[], rIdx: number) => (
                                        <tr key={rIdx} className="hover:bg-slate-800/40 transition-colors">
                                          {row.map((cell: any, cIdx: number) => (
                                            <td key={cIdx} className="px-3 py-1.5 text-slate-200 whitespace-nowrap">
                                              {cell !== null && cell !== undefined && String(cell).trim() !== '' ? (
                                                String(cell)
                                              ) : (
                                                <span className="text-slate-600 italic">—</span>
                                              )}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 2. Outbound Emails Content View */}
                        {act.tool === 'send_email' && (
                          <div className="space-y-3">
                            {act.details.emails && act.details.emails.length > 0 ? (
                              <div className="space-y-2.5">
                                <span className="text-[10px] uppercase font-mono text-slate-400 font-semibold block">
                                  Generated Outbound Emails ({act.details.emails.length}):
                                </span>
                                {act.details.emails.map((em: any, emIdx: number) => (
                                  <div
                                    key={emIdx}
                                    className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2"
                                  >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-slate-500 font-medium w-14 shrink-0">To:</span>
                                        <span className="font-mono text-indigo-300 font-semibold px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
                                          {em.to || 'Recipient'}
                                        </span>
                                      </div>
                                      {em.client_identifier && (
                                        <span className="text-[10px] font-mono text-slate-500">
                                          Ref: {em.client_identifier}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-start gap-1.5 text-[11px]">
                                      <span className="text-slate-500 font-medium w-14 shrink-0 mt-0.5">Subject:</span>
                                      <span className="text-slate-100 font-semibold">{em.subject}</span>
                                    </div>
                                    <div className="pt-2 border-t border-slate-800/60">
                                      <span className="text-[10px] uppercase font-mono text-slate-500 block mb-1">
                                        Email Body:
                                      </span>
                                      <div className="text-slate-300 text-[11px] leading-relaxed whitespace-pre-wrap bg-slate-950/70 p-3 rounded-lg border border-slate-800/60 font-sans">
                                        {em.body}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {act.details.to && (
                                  <div className="flex items-baseline gap-2 text-[11px]">
                                    <span className="text-slate-500 font-medium w-16 shrink-0">To:</span>
                                    <span className="font-mono text-indigo-300 font-semibold">{act.details.to}</span>
                                  </div>
                                )}
                                {act.details.subject && (
                                  <div className="flex items-baseline gap-2 text-[11px]">
                                    <span className="text-slate-500 font-medium w-16 shrink-0">Subject:</span>
                                    <span className="text-slate-100 font-semibold">{act.details.subject}</span>
                                  </div>
                                )}
                                {act.details.body && (
                                  <div className="pt-1 border-t border-slate-800/60">
                                    <span className="text-[10px] uppercase font-mono text-slate-500 block mb-1">
                                      Email Body Content:
                                    </span>
                                    <div className="text-slate-300 text-[11px] leading-relaxed whitespace-pre-wrap bg-slate-950/70 p-3 rounded-lg border border-slate-800/60 font-sans">
                                      {act.details.body}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. General Tool Items View */}
                        {act.tool !== 'write_sheet' && act.tool !== 'send_email' && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] uppercase font-mono text-slate-400 font-semibold block">
                              Operation Payload:
                            </span>
                            <pre className="text-[11px] font-mono text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800 overflow-x-auto max-h-48">
                              {JSON.stringify(act.details.items || act.details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-400">
                General tool execution with verified input parameters.
              </div>
            )}
          </div>

          {/* Natural Language Feedback Input */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-400" />
              <label className="text-xs font-bold text-white uppercase tracking-wider block">
                Modification Feedback (Optional)
              </label>
            </div>
            <p className="text-xs text-slate-400">
              Need to adjust wording or exclude a recipient? Type your instructions here, and the AI will refine the actions before continuing:
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. Change email tone to be more formal, or do not append the second customer row..."
              rows={3}
              className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
            />
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Decision Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              onClick={() => handleDecision(false)}
              disabled={submitting}
              className="w-full sm:w-1/3 py-3 px-4 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700/80 hover:border-rose-500/40 text-xs font-semibold transition-all disabled:opacity-50"
            >
              {submitting ? 'Processing...' : 'Reject & Abort'}
            </button>

            <button
              onClick={() => handleDecision(true)}
              disabled={submitting}
              className="w-full sm:w-2/3 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.99]"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Resuming Workflow Engine...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{feedback.trim() ? 'Apply Feedback & Execute' : 'Approve & Execute Actions'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HITLReviewPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 space-y-4">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-xs text-slate-400 font-mono">Loading approval interface...</p>
          </div>
        }
      >
        <HITLReviewContent />
      </Suspense>
    </AppShell>
  );
}
