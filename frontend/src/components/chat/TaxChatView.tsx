'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useUser, UserButton } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { TaxChatMessage, TaxChatSession } from '@/lib/types';
import { COMPANY_NAME } from '@/config/site';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Bot,
  User,
  Plus,
  MessageSquare,
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Scale,
  Receipt,
  FileCheck2,
  ArrowLeft,
  Wrench,
  Menu,
  X,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  LogIn,
  History,
} from 'lucide-react';

const SUGGESTIONS = [
  'Compare tax liability under Old vs New Tax Regime for ₹15 Lakhs income.',
  'What are the mandatory conditions to claim Input Tax Credit under Section 16?',
  'Explain GST Reverse Charge Mechanism (RCM) applicability for GTA services.',
  'What deductions are available under Section 80C, 80D, and NPS 80CCD(1B)?',
];

export function TaxChatView() {
  const { user, isSignedIn, isLoaded: isUserLoaded } = useUser();
  const currentUserId = user?.id || 'guest_user';

  // Guest login prompt modal (skippable)
  const [showGuestModal, setShowGuestModal] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<TaxChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false);

  useEffect(() => {
    // If visitor is not logged in, prompt them with the skippable modal
    if (isUserLoaded && !isSignedIn) {
      const dismissed = typeof window !== 'undefined' ? sessionStorage.getItem('dismissed_tax_guest_modal') : null;
      if (!dismissed) {
        setShowGuestModal(true);
      }
    }
  }, [isUserLoaded, isSignedIn]);

  const handleDismissGuestModal = () => {
    setShowGuestModal(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dismissed_tax_guest_modal', 'true');
    }
  };

  // Active chat state
  const [messages, setMessages] = useState<TaxChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  // Load user sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      setIsLoadingSessions(true);
      try {
        const data = await apiClient.getTaxSessions(currentUserId);
        setSessions(data);
      } catch (err) {
        console.error('Failed to load tax sessions:', err);
      } finally {
        setIsLoadingSessions(false);
      }
    };
    loadSessions();
  }, [currentUserId]);

  // Load history when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    const loadHistory = async () => {
      try {
        const data = await apiClient.getTaxChatHistory(activeSessionId);
        // Exclude internal system prompt if returned
        const userAndAssistant = (data.messages || []).filter((m) => m.role !== 'system');
        setMessages(userAndAssistant);
      } catch (err: any) {
        setError(err.message || 'Failed to load conversation history.');
      }
    };

    loadHistory();
  }, [activeSessionId]);

  // Handle Send Message
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputValue.trim();
    if (!text || isSending) return;

    setError(null);
    setInputValue('');

    // Optimistic user message addition
    const optimisticUserMsg: TaxChatMessage = {
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);
    setIsSending(true);

    try {
      const res = await apiClient.sendTaxMessage({
        message: text,
        session_id: activeSessionId || undefined,
        user_id: currentUserId,
      });

      if (!activeSessionId && res.session_id) {
        setActiveSessionId(res.session_id);
        // Refresh session list in sidebar
        const updatedSessions = await apiClient.getTaxSessions(currentUserId);
        setSessions(updatedSessions);
      }

      // Filter out system prompt from returned messages
      const cleanMessages = (res.messages || []).filter((m) => m.role !== 'system');
      setMessages(cleanMessages);
    } catch (err: any) {
      setError(err.message || 'Failed to communicate with fine-tuned tax model.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleStartNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
    setHistorySidebarOpen(false);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Standalone Product Top Navbar (No platform sidebar) */}
      <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-4 md:px-6 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          {/* Mobile History Toggle */}
          <button
            onClick={() => setHistorySidebarOpen(!historySidebarOpen)}
            className="md:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
            title="Toggle Consultation History"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Product Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-600/25">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">
                  {COMPANY_NAME} Tax &amp; GST Intelligence
                </span>
                <span className="hidden sm:inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
                  Qwen3-1.7B LoRA
                </span>
              </div>
              <p className="text-[10px] text-slate-400 -mt-0.5 hidden sm:block">
                Statutory Income Tax Act 1961 &amp; CGST/SGST/IGST Compliance Copilot
              </p>
            </div>
          </div>
        </div>

        {/* Center/Right Nav & Consultation Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/tools"
            className="hidden sm:inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>AI Tools Platform</span>
          </Link>

          <button
            onClick={handleStartNewSession}
            className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/25 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Consultation</span>
          </button>

          {isSignedIn ? (
            <UserButton />
          ) : (
            <Link
              href="/sign-in"
              className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white font-medium transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Side: Consultation History Sidebar */}
        <aside
          className={`${
            historySidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } md:translate-x-0 transition-transform duration-200 fixed md:static inset-y-0 left-0 top-16 z-30 md:z-0 flex flex-col w-72 md:w-80 border-r border-slate-800/80 bg-slate-950 md:bg-slate-900/40 backdrop-blur-xl shrink-0`}
        >
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span>Consultation History</span>
            </span>
            <button
              onClick={handleStartNewSession}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs transition-colors"
              title="New consultation"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {isLoadingSessions ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Loading consultations...
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                <Receipt className="w-8 h-8 text-slate-700 mx-auto" />
                <p>No previous tax consultations.</p>
                <p className="text-[11px] text-slate-600">
                  Ask a tax or GST question to begin your first session.
                </p>
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => {
                    setActiveSessionId(s.session_id);
                    setHistorySidebarOpen(false);
                  }}
                  className={`w-full text-left p-3 rounded-2xl text-xs transition-all flex items-start gap-2.5 group ${
                    activeSessionId === s.session_id
                      ? 'bg-purple-600/15 border border-purple-500/30 text-purple-200 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  <MessageSquare className="w-4 h-4 shrink-0 mt-0.5 opacity-60 group-hover:text-purple-400 transition-colors" />
                  <div className="truncate flex-1">
                    <div className="truncate font-medium text-slate-200 group-hover:text-white transition-colors">
                      {s.title || 'Tax Consultation'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                      <span>{s.message_count || 1} messages</span>
                      <span>{s.updated_at ? new Date(s.updated_at).toLocaleDateString() : ''}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Sidebar Footer Link to Tools */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
            <Link
              href="/tools"
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800/80 text-xs text-slate-300 hover:text-white transition-colors border border-slate-800"
            >
              <span className="flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-indigo-400" />
                <span>Go to AI Tools Hub</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            </Link>
          </div>
        </aside>

        {/* Mobile Backdrop for Sidebar */}
        {historySidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-20 md:hidden"
            onClick={() => setHistorySidebarOpen(false)}
          />
        )}

        {/* Right / Center: The Dedicated Chat Workspace */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950/40">
          {/* Conversation Stream */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
            {messages.length === 0 ? (
              /* Welcome Splash with Tax Suggestion Chips */
              <div className="max-w-3xl mx-auto py-10 md:py-16 text-center space-y-8">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-purple-500/20 via-indigo-500/10 to-transparent border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto shadow-2xl shadow-purple-500/10">
                  <Scale className="w-8 h-8" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-semibold mb-3">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Specialized Legal Reasoning Engine</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                    Indian Income Tax &amp; GST Intelligence Copilot
                  </h2>
                  <p className="text-xs md:text-sm text-slate-400 mt-2 max-w-xl mx-auto leading-relaxed">
                    Powered by fine-tuned <b>Qwen3-1.7B</b>. Get statutory legal anchors, Section 115BAC regime tax breakdowns, Section 16 ITC criteria, and GSTR compliance analysis.
                  </p>
                </div>

                {/* Pre-made Question Suggestion Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-left max-w-2xl mx-auto pt-2">
                  {SUGGESTIONS.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(s)}
                      className="p-4 rounded-2xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-purple-500/40 text-xs text-slate-300 hover:text-white transition-all duration-200 group flex items-start gap-3 shadow-sm hover:shadow-lg hover:shadow-purple-500/5"
                    >
                      <Receipt className="w-4 h-4 text-purple-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <span className="leading-relaxed">{s}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message Bubbles Stream */
              messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';

                return (
                  <div
                    key={index}
                    className={`flex gap-3.5 max-w-3xl ${
                      isAssistant ? 'mr-auto' : 'ml-auto flex-row-reverse'
                    }`}
                  >
                    {/* Role Avatar */}
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isAssistant
                          ? 'bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-600/30'
                          : 'bg-slate-800 border border-slate-700 text-slate-300'
                      }`}
                    >
                      {isAssistant ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    </div>

                    {/* Message Bubble Body */}
                    <div
                      className={`rounded-2xl p-4 text-xs leading-relaxed space-y-2 ${
                        isAssistant
                          ? 'bg-slate-900/90 border border-slate-800 text-slate-200 shadow-sm'
                          : 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      }`}
                    >
                      {isAssistant ? (
                        <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800 prose-table:text-xs">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* In-Flight Response Loader */}
            {isSending && (
              <div className="flex gap-3.5 max-w-3xl mr-auto">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-purple-600/30">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="rounded-2xl p-4 bg-slate-900 border border-slate-800 flex items-center gap-2.5 text-xs text-purple-300">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  <span>Computing statutory compliance and legal sections via Qwen3-1.7B...</span>
                </div>
              </div>
            )}

            {/* Error Banner with Retry */}
            {error && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-between gap-3 text-rose-300 text-xs max-w-2xl mx-auto">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
                <button
                  onClick={() => handleSendMessage()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Message Composer */}
          <div className="p-4 md:p-6 border-t border-slate-800/80 bg-slate-950/80 backdrop-blur-xl shrink-0">
            <div className="max-w-3xl mx-auto space-y-2.5">
              <div className="relative flex items-end gap-2 bg-slate-900/90 border border-slate-800 focus-within:border-purple-500 rounded-2xl p-3 transition-colors shadow-lg shadow-black/20">
                <textarea
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about GST slabs, Section 115BAC, ITC claims, Advance Tax schedules..."
                  className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none resize-none max-h-36 px-2 py-1 leading-relaxed"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || isSending}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 text-white transition-all shadow-md shadow-purple-600/30 shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between text-[10px] text-slate-500 px-1 gap-1">
                <span>Press <b>Enter</b> to send, <b>Shift + Enter</b> for line break</span>
                <span>{COMPANY_NAME} Tax AI Disclaimer: Statutory educational guidance. Not legal or CA certification.</span>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Skippable Guest Login Popup Modal */}
      <AnimatePresence>
        {showGuestModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 md:p-8 shadow-2xl shadow-purple-950/50 space-y-6 relative overflow-hidden text-center"
            >
              {/* Subtle Ambient Background Gradient */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-purple-500/15 rounded-full blur-2xl pointer-events-none" />

              {/* Close Button */}
              <button
                type="button"
                onClick={handleDismissGuestModal}
                className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Skip and continue as guest"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Icon Badge */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600/20 via-indigo-600/20 to-transparent border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto shadow-lg shadow-purple-500/10">
                <Scale className="w-7 h-7" />
              </div>

              {/* Copy / Message */}
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  <span>Guest Consultation</span>
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  Save Your Consultation History
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                  You can use {COMPANY_NAME} Tax AI for free as a guest. However, signing in permanently preserves your multi-turn conversation history, calculation records, and statutory bookmarks across devices.
                </p>
              </div>

              {/* Actions */}
              <div className="space-y-2.5 pt-2">
                <Link
                  href="/sign-in?redirect_url=/chat"
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-500 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-purple-600/25 transition-all active:scale-[0.98]"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Log In to Save History</span>
                </Link>

                <button
                  type="button"
                  onClick={handleDismissGuestModal}
                  className="w-full py-2.5 px-4 rounded-2xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
                >
                  I&apos;ll Log In Later (Continue as Guest)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
