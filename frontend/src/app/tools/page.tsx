'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { AppShell } from '@/components/layout/AppShell';
import { ToolCard } from '@/components/tools/ToolCard';
import { CreateToolModal } from '@/components/tools/CreateToolModal';
import { ToolExecuteModal } from '@/components/tools/ToolExecuteModal';
import { ToolDeployModal } from '@/components/tools/ToolDeployModal';
import { apiClient } from '@/lib/api-client';
import { CustomTool } from '@/lib/types';
import {
  Search,
  PlusCircle,
  Wrench,
  Sparkles,
  Layers,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  LogIn,
} from 'lucide-react';

export default function ToolsDashboardPage() {
  const router = useRouter();
  const { user, isLoaded: isUserLoaded, isSignedIn } = useUser();
  const currentUserId = user?.id || 'guest_user';

  // Active tab: 'marketplace' or 'my_tools'
  const [activeTab, setActiveTab] = useState<'marketplace' | 'my_tools'>('marketplace');

  // Search query with debounced server-side execution
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Tools state
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [executingTool, setExecutingTool] = useState<CustomTool | null>(null);
  const [deployingTool, setDeployingTool] = useState<CustomTool | null>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch tools from real backend via Next.js proxy
  const fetchTools = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let data: CustomTool[] = [];
      if (activeTab === 'marketplace') {
        data = await apiClient.getMarketplaceTools(debouncedQuery);
      } else {
        if (!isSignedIn && isUserLoaded) {
          setTools([]);
          setIsLoading(false);
          return;
        }
        data = await apiClient.getMyTools(currentUserId, debouncedQuery);
      }
      setTools(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load tools from backend.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, debouncedQuery, currentUserId, isSignedIn, isUserLoaded]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleOpenCreateTool = () => {
    if (!isSignedIn && isUserLoaded) {
      router.push('/sign-in');
      return;
    }
    setIsCreateOpen(true);
  };

  const handleRunTool = (tool: CustomTool) => {
    setExecutingTool(tool);
  };

  const handleDeployTool = (tool: CustomTool) => {
    if (!isSignedIn && isUserLoaded) {
      router.push('/sign-in');
      return;
    }
    setDeployingTool(tool);
  };

  // Quick stats
  const totalTools = tools.length;
  const hitlCount = tools.filter((t) => t.requires_hitl).length;
  const oauthCount = tools.filter((t) => t.requires_oauth).length;

  return (
    <AppShell onOpenCreateTool={handleOpenCreateTool}>
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
        {/* Page Top Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Autonomous Agentic Gateway</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              AI Tools &amp; Agent Workflows
            </h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1">
              Build, configure, execute, and deploy schema-driven autonomous agent tools.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {!isSignedIn && (
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700/80 transition-all shadow-sm"
              >
                <LogIn className="w-3.5 h-3.5 text-indigo-400" />
                <span>Log In</span>
              </Link>
            )}

            <button
              onClick={handleOpenCreateTool}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 border border-indigo-400/20 transition-all active:scale-[0.98]"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create AI Tool</span>
            </button>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-sm">
            <span className="text-[11px] font-medium text-slate-400 block">
              Available Tools
            </span>
            <span className="text-2xl font-bold text-white mt-1 block">
              {totalTools}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-sm">
            <span className="text-[11px] font-medium text-slate-400 block">
              HITL Governed
            </span>
            <span className="text-2xl font-bold text-amber-400 mt-1 block">
              {hitlCount}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-sm">
            <span className="text-[11px] font-medium text-slate-400 block">
              OAuth Connected
            </span>
            <span className="text-2xl font-bold text-purple-400 mt-1 block">
              {oauthCount}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-sm">
            <span className="text-[11px] font-medium text-slate-400 block">
              Session Identity
            </span>
            {isSignedIn ? (
              <span className="text-xs font-mono text-emerald-400 mt-2 block truncate">
                {user?.primaryEmailAddress?.emailAddress || 'Clerk Verified'}
              </span>
            ) : (
              <span className="text-xs font-mono text-slate-500 mt-2 block truncate">
                Guest (Public Browsing)
              </span>
            )}
          </div>
        </div>

        {/* Search & Tabs Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2">
          {/* Tab Selector */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/80 border border-slate-800 w-fit">
            <button
              onClick={() => setActiveTab('marketplace')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'marketplace'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Marketplace
            </button>
            <button
              onClick={() => setActiveTab('my_tools')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'my_tools'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              My Created Tools
            </button>
          </div>

          {/* Server-Side Debounced Search Field */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools by title or description..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-[10px] text-slate-400 hover:text-white absolute right-3 top-1/2 -translate-y-1/2"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Signed Out Warning when viewing My Created Tools */}
        {activeTab === 'my_tools' && !isSignedIn && isUserLoaded && (
          <div className="p-8 rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
              <LogIn className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Sign in to view your tools
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Your private tools, personal webhook deployments, and custom configurations are secured by your account.
              </p>
            </div>
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 py-2 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
            >
              <LogIn className="w-4 h-4" />
              <span>Log In to Your Account</span>
            </Link>
          </div>
        )}

        {/* Tools Grid or State Feedback */}
        {activeTab === 'my_tools' && !isSignedIn && isUserLoaded ? null : error ? (
          <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
            <div className="text-sm font-semibold text-rose-200">
              Failed to load tools from backend
            </div>
            <p className="text-xs text-rose-300 max-w-md mx-auto">
              {error}
            </p>
            <button
              onClick={fetchTools}
              className="inline-flex items-center gap-1.5 py-1.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Request</span>
            </button>
          </div>
        ) : isLoading ? (
          /* Skeletons */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3, 4, 5, 6].map((idx) => (
              <div
                key={idx}
                className="h-64 rounded-2xl bg-slate-900/40 border border-slate-800/60 p-5 space-y-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3.5 bg-slate-800 rounded w-3/4" />
                    <div className="h-2.5 bg-slate-850 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 bg-slate-800 rounded w-full" />
                  <div className="h-2.5 bg-slate-800 rounded w-5/6" />
                </div>
                <div className="h-8 bg-slate-800/60 rounded-xl mt-6" />
              </div>
            ))}
          </div>
        ) : tools.length === 0 ? (
          /* Empty State */
          <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
              <Wrench className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {debouncedQuery
                  ? `No tools matched "${debouncedQuery}"`
                  : activeTab === 'marketplace'
                  ? 'No public tools in marketplace'
                  : 'You have not created any tools yet'}
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {debouncedQuery
                  ? 'Try searching with different keywords or clear your query.'
                  : 'Describe your idea to the AI engine to generate an agentic tool with schema in seconds.'}
              </p>
            </div>

            {!debouncedQuery && (
              <button
                onClick={handleOpenCreateTool}
                className="inline-flex items-center gap-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create Your First Tool</span>
              </button>
            )}
          </div>
        ) : (
          /* Active Tools Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                onRun={handleRunTool}
                onDeploy={handleDeployTool}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateToolModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => {
          fetchTools();
        }}
      />

      <ToolExecuteModal
        tool={executingTool}
        isOpen={!!executingTool}
        onClose={() => setExecutingTool(null)}
      />

      <ToolDeployModal
        tool={deployingTool}
        isOpen={!!deployingTool}
        onClose={() => setDeployingTool(null)}
      />
    </AppShell>
  );
}
