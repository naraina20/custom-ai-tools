'use client';

import React from 'react';
import Link from 'next/link';
import { useUser, UserButton } from '@clerk/nextjs';
import {
  Wrench,
  Bot,
  Zap,
  ArrowRight,
  ShieldCheck,
  Scale,
  Sparkles,
  GitBranch,
  Layers,
  CheckCircle2,
  Lock,
  LogIn,
  ArrowUpRight,
} from 'lucide-react';

export default function LandingPage() {
  const { user, isSignedIn } = useUser();

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-indigo-500/30 selection:text-indigo-200 relative overflow-hidden">
      {/* Background Subtle Gradient Blobs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-b from-indigo-600/15 via-purple-600/10 to-transparent blur-3xl pointer-events-none -z-10" />

      {/* Top Navigation Bar */}
      <header className="h-16 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl px-6 md:px-12 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform duration-200">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Gravita AI
            </span>
            <span className="block text-[10px] text-indigo-400 font-medium -mt-1 tracking-wider uppercase">
              Gateway &amp; Tax
            </span>
          </div>
        </Link>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
          <Link
            href="/tools"
            className="hover:text-white transition-colors flex items-center gap-1.5"
          >
            <Wrench className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Tools Platform</span>
            <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
              Auth
            </span>
          </Link>
          <Link
            href="/chat"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors flex items-center gap-1.5"
          >
            <Scale className="w-3.5 h-3.5 text-purple-400" />
            <span>GST &amp; Tax Copilot</span>
            <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded">
              New Tab
            </span>
          </Link>
        </nav>

        {/* Right Action Controls */}
        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <div className="flex items-center gap-3">
              <Link
                href="/tools"
                className="hidden sm:inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all"
              >
                <span>Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <UserButton />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/sign-in"
                className="py-1.5 px-3.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                Log In
              </Link>
              <Link
                href="/sign-up"
                className="py-1.5 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/25 transition-all"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Main Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 md:py-24 max-w-6xl mx-auto text-center space-y-12">
        {/* Hero Tagline */}
        <div className="space-y-4 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Autonomous Agentic Gateway &amp; Statutory Tax Intelligence</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Build AI Tools in Seconds.{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-indigo-200 bg-clip-text text-transparent">
              Run Autonomous Operations
            </span>{' '}
            with Total Control.
          </h1>

          <p className="text-sm md:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Welcome to Gravita AI. Access our enterprise-grade <b>AI Tools Gateway</b> to create, govern, and deploy autonomous workflows, or launch our standalone <b>Indian Tax &amp; GST Copilot</b> for statutory legal intelligence.
          </p>

          {/* Action Call To Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/tools"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 py-3 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs md:text-sm shadow-xl shadow-indigo-600/30 border border-indigo-400/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Wrench className="w-4 h-4" />
              <span>Explore AI Tools Platform</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <Link
              href="/chat"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 py-3 px-6 rounded-2xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white font-semibold text-xs md:text-sm border border-slate-700/80 hover:border-indigo-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Scale className="w-4 h-4 text-purple-400" />
              <span>Launch GST &amp; Tax Copilot</span>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </Link>
          </div>
        </div>

        {/* Dual Product Showcase Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left pt-6">
          {/* Product 1: AI Tools Platform */}
          <div className="group rounded-3xl border border-slate-800/80 bg-slate-900/40 p-6 md:p-8 backdrop-blur-xl hover:border-indigo-500/40 hover:bg-slate-900/60 transition-all duration-300 relative flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                  <Wrench className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>Login Restricted</span>
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-white group-hover:text-indigo-200 transition-colors">
                  AI Tools &amp; Agent Gateway
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  Turn natural language descriptions into verified JSON form schemas. Deploy isolated webhook ingestion endpoints with async queueing and LangGraph human-in-the-loop safety approvals.
                </p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>3-step AI schema generation and field customization</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Async webhook ingestion with idempotency &amp; rate limiting</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Human-in-the-Loop decision gate for safe executions</span>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-slate-800/60">
              <Link
                href="/tools"
                className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors"
              >
                <span>Go to Tools Platform</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>

          {/* Product 2: GST & Tax Copilot */}
          <div className="group rounded-3xl border border-slate-800/80 bg-slate-900/40 p-6 md:p-8 backdrop-blur-xl hover:border-purple-500/40 hover:bg-slate-900/60 transition-all duration-300 relative flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
                  <Scale className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Fine-Tuned Qwen3-1.7B
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-white group-hover:text-purple-200 transition-colors">
                  GST &amp; Indian Tax Intelligence
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  A standalone specialist AI product fine-tuned on the Indian Income Tax Act 1961, Section 115BAC regime comparisons, Section 16/17(5) ITC eligibility, and CGST/SGST compliance.
                </p>
              </div>

              <div className="space-y-2 pt-2 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Section 115BAC Old vs New Tax Regime math &amp; calculations</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Input Tax Credit (ITC) eligibility &amp; blocked credit clauses</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Persistent multi-turn consultation history in clean UI</span>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-slate-800/60">
              <Link
                href="/chat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs font-semibold text-purple-400 group-hover:text-purple-300 transition-colors"
              >
                <span>Launch Tax Copilot</span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </div>

        {/* Technical Architecture Highlights */}
        <div className="w-full pt-8 grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
          <div className="p-4 rounded-2xl bg-slate-900/30 border border-slate-800/60">
            <ShieldCheck className="w-5 h-5 text-indigo-400 mb-2" />
            <h4 className="text-xs font-bold text-white">Clerk JWT Verified</h4>
            <p className="text-[11px] text-slate-400 mt-1">
              End-to-end token verification in Next.js proxy &amp; Django.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/30 border border-slate-800/60">
            <GitBranch className="w-5 h-5 text-emerald-400 mb-2" />
            <h4 className="text-xs font-bold text-white">Universal Webhooks</h4>
            <p className="text-[11px] text-slate-400 mt-1">
              Ingestion engine with DB queue and idempotency deduplication.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/30 border border-slate-800/60">
            <Layers className="w-5 h-5 text-amber-400 mb-2" />
            <h4 className="text-xs font-bold text-white">HITL Governance</h4>
            <p className="text-[11px] text-slate-400 mt-1">
              Safe execution checkpoints before external API invocations.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/30 border border-slate-800/60">
            <Scale className="w-5 h-5 text-purple-400 mb-2" />
            <h4 className="text-xs font-bold text-white">Statutory Tax Engine</h4>
            <p className="text-[11px] text-slate-400 mt-1">
              Specialized LoRA adapter on Qwen3-1.7B for accurate Indian tax.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-8 px-6 text-center text-xs text-slate-500 space-y-2">
        <p>© 2026 Gravita AI. Autonomous Agent Systems &amp; Statutory Tax Intelligence.</p>
        <div className="flex items-center justify-center gap-4 text-[11px]">
          <Link href="/tools" className="hover:text-slate-300 transition-colors">
            AI Tools Gateway
          </Link>
          <span>•</span>
          <Link href="/chat" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">
            GST &amp; Tax Copilot
          </Link>
          <span>•</span>
          <Link href="/sign-in" className="hover:text-slate-300 transition-colors">
            Account Log In
          </Link>
        </div>
      </footer>
    </div>
  );
}
