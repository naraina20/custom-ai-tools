'use client';

import React from 'react';
import { CustomTool } from '@/lib/types';
import {
  Wrench,
  Play,
  Share2,
  ShieldAlert,
  KeyRound,
  ExternalLink,
  Layers,
  Sparkles,
  GitBranch,
} from 'lucide-react';

interface ToolCardProps {
  tool: CustomTool;
  onRun: (tool: CustomTool) => void;
  onDeploy: (tool: CustomTool) => void;
}

export function ToolCard({ tool, onRun, onDeploy }: ToolCardProps) {
  const propertyCount = Object.keys(tool.form_schema?.properties || {}).length;

  return (
    <div className="group relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/40 hover:bg-slate-900/70 hover:shadow-xl hover:shadow-indigo-500/10">
      {/* Top Accent Gradient Border Glow */}
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div>
        {/* Header Badges & Icon */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-transparent border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:text-indigo-300 group-hover:scale-105 transition-all">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-100 group-hover:text-white transition-colors">
                {tool.title}
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                {tool.slug}
              </p>
            </div>
          </div>

          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
              tool.is_public
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-slate-800 text-slate-400 border-slate-700/60'
            }`}
          >
            {tool.is_public ? 'Marketplace' : 'Private'}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed mb-4">
          {tool.description || 'No description provided for this AI tool.'}
        </p>

        {/* Capability Tags */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          {/* Schema inputs badge */}
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300 border border-slate-700/50">
            <Layers className="w-3 h-3 text-slate-400" />
            {propertyCount} {propertyCount === 1 ? 'input' : 'inputs'}
          </span>

          {/* HITL badge */}
          {tool.requires_hitl && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/25">
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              HITL Approval
            </span>
          )}

          {/* OAuth badge */}
          {tool.requires_oauth && tool.oauth_provider !== 'none' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/25 capitalize">
              <KeyRound className="w-3 h-3 text-purple-400" />
              {tool.oauth_provider} OAuth
            </span>
          )}

          {/* Webhook support indicator */}
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
            <GitBranch className="w-3 h-3 text-cyan-400" />
            Webhook Ingest
          </span>
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-3 border-t border-slate-800/60 flex items-center gap-2">
        <button
          onClick={() => onRun(tool)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition-all active:scale-[0.98]"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Execute</span>
        </button>

        <button
          onClick={() => onDeploy(tool)}
          className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 hover:text-white font-medium text-xs border border-slate-700/60 transition-all active:scale-[0.98]"
          title="Deploy personal instance & get webhook endpoint"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Deploy</span>
        </button>
      </div>
    </div>
  );
}
