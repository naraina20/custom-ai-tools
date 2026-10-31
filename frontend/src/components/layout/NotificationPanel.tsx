'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '@/lib/NotificationContext';
import { AppNotification } from '@/lib/types';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Zap,
  X,
  Check,
  Trash2,
  Clock,
  Radio,
  ExternalLink,
} from 'lucide-react';

function formatTimeAgo(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return 'Recent';
  }
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    isConnected,
    markAsRead,
    markAllAsRead,
    clearAll,
    latestToast,
    dismissToast,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss latest toast after 4.5s
  useEffect(() => {
    if (latestToast) {
      const timer = setTimeout(() => {
        dismissToast();
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [latestToast, dismissToast]);

  // Close panel on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const getNotificationIcon = (type: string, status?: string) => {
    if (type === 'HITL_REQUEST' || status === 'paused') {
      return <ShieldAlert className="w-4 h-4 text-amber-400" />;
    }
    if (type === 'TOOL_EXECUTION_PARTIAL_FAILURE' || status === 'failed' || status === 'warning') {
      return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    }
    if (type === 'STEP_PROGRESS') {
      return <Zap className="w-4 h-4 text-indigo-400" />;
    }
    return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Trigger Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500"
        title="Real-time Platform Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />

        {/* Live Socket Status Dot */}
        <span
          className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-slate-950 ${
            isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
          }`}
          title={isConnected ? 'Connected to Realtime Gateway' : 'Reconnecting...'}
        />

        {/* Unread Counter Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-[10px] font-bold text-white shadow-md shadow-indigo-500/40">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Floating Notification Popover Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm sm:max-w-md rounded-2xl border border-slate-800 bg-slate-950/95 backdrop-blur-xl shadow-2xl shadow-indigo-950/60 z-50 overflow-hidden flex flex-col max-h-[80vh]"
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Live Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {unreadCount} new
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <div
                  className="flex items-center gap-1 text-[10px] font-mono text-slate-400 mr-2"
                  title={isConnected ? 'Live WebSocket Connected' : 'Reconnecting...'}
                >
                  <Radio className={`w-3 h-3 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
                  <span className="hidden sm:inline">{isConnected ? 'Live' : 'Syncing'}</span>
                </div>

                {notifications.length > 0 && (
                  <>
                    <button
                      onClick={markAllAsRead}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 text-xs transition-colors"
                      title="Mark all as read"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={clearAll}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 text-xs transition-colors"
                      title="Clear all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Notification List Body */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-1">
              {notifications.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 mx-auto flex items-center justify-center text-slate-500">
                    <Bell className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-medium text-slate-300">No notifications yet</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
                    Real-time execution steps, approval alerts, and tool progress updates will appear here automatically.
                  </p>
                </div>
              ) : (
                notifications.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => markAsRead(item.id)}
                    className={`p-3.5 hover:bg-slate-900/60 cursor-pointer transition-colors flex items-start gap-3 rounded-xl mx-1 my-0.5 ${
                      !item.read ? 'bg-indigo-950/20 border-l-2 border-indigo-500' : ''
                    }`}
                  >
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 shrink-0 mt-0.5">
                      {getNotificationIcon(item.type, item.status)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white truncate">
                          {item.tool_title || 'Agent Workflow'}
                        </span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 shrink-0 font-mono">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTimeAgo(item.timestamp)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/10 px-1.5 py-0.2 rounded border border-indigo-500/20">
                          {item.step_name}
                        </span>
                        {item.step_index && item.total_steps ? (
                          <span className="text-[10px] font-mono text-slate-400">
                            {item.step_index}/{item.total_steps}
                          </span>
                        ) : null}
                      </div>

                      {item.details && (
                        <p className="text-[11px] text-slate-300/90 leading-relaxed mt-1 line-clamp-2">
                          {item.details}
                        </p>
                      )}

                      {/* Direct CTA button to HITL Approval Page */}
                      {item.type === 'HITL_REQUEST' && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <Link
                            href={item.data?.approval_url || `/tools/hitl-review?thread_id=${item.thread_id}${item.data?.tool_id ? `&tool_id=${item.data.tool_id}` : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(item.id);
                              setIsOpen(false);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-[11px] font-bold shadow-md shadow-amber-500/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
                          >
                            <span>Review & Authorize</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                          <span className="text-[10px] text-amber-400/90 font-mono">Action required</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="p-2 border-t border-slate-800/80 bg-slate-900/40 text-center">
                <span className="text-[10px] text-slate-500">
                  Showing {notifications.length} recent notification{notifications.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Floating Step Toast */}
      <AnimatePresence>
        {latestToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 max-w-sm rounded-2xl border border-indigo-500/40 bg-slate-950/95 backdrop-blur-xl p-4 shadow-2xl shadow-indigo-950/80 flex items-start gap-3"
          >
            <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 shrink-0">
              {getNotificationIcon(latestToast.type, latestToast.status)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white truncate">
                  {latestToast.tool_title || 'Execution Progress'}
                </span>
                <button
                  onClick={dismissToast}
                  className="p-1 rounded-md text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-semibold text-indigo-300">
                  {latestToast.step_name}
                </span>
                {latestToast.step_index && (
                  <span className="text-[10px] font-mono text-slate-400">
                    ({latestToast.step_index}/{latestToast.total_steps || 4})
                  </span>
                )}
              </div>

              {latestToast.details && (
                <p className="text-[11px] text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                  {latestToast.details}
                </p>
              )}

              {latestToast.type === 'HITL_REQUEST' && (
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <Link
                    href={latestToast.data?.approval_url || `/tools/hitl-review?thread_id=${latestToast.thread_id}${latestToast.data?.tool_id ? `&tool_id=${latestToast.data.tool_id}` : ''}`}
                    onClick={() => dismissToast()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-[11px] font-bold shadow-md shadow-amber-500/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <span>Review & Authorize</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
