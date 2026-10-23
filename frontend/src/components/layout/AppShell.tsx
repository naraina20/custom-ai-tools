'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton, useUser } from '@clerk/nextjs';
import {
  Wrench,
  Bot,
  PlusCircle,
  Menu,
  X,
  Sparkles,
  ShieldCheck,
  Zap,
  LogIn,
  UserPlus,
  Scale,
  ArrowUpRight,
  Home,
} from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  onOpenCreateTool?: () => void;
}

export function AppShell({ children, onOpenCreateTool }: AppShellProps) {
  const pathname = usePathname();
  const { user, isSignedIn } = useUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    {
      name: 'AI Tools & Workflows',
      href: '/tools',
      icon: Wrench,
      active: pathname.startsWith('/tools'),
      badge: 'Hub',
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-800/80 bg-slate-950/60 backdrop-blur-xl shrink-0">
        {/* Brand Area */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/80">
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
        </div>

        {/* Quick Action Button */}
        {onOpenCreateTool && (
          <div className="p-4 pb-2">
            <button
              onClick={onOpenCreateTool}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/35 transition-all duration-200 border border-indigo-400/20 active:scale-[0.98]"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create AI Tool</span>
            </button>
          </div>
        )}

        {/* Navigation Items */}
        <div className="flex-1 flex flex-col justify-between overflow-y-auto">
          <nav className="px-3 py-4 space-y-1.5">
            <div className="px-3 pb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Platform Services
            </div>

            <Link
              href="/"
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 group ${
                pathname === '/'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Home className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                <span>Home / Overview</span>
              </div>
            </Link>

            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 group ${
                    item.active
                      ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        item.active
                          ? 'text-indigo-400'
                          : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span>{item.name}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                        item.active
                          ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/40'
                          : 'bg-slate-800/80 text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Highlighted Standalone Product Banner (GST & Tax Copilot) */}
          <div className="px-3 pt-2 pb-3">
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-950/70 via-purple-950/40 to-slate-900 border border-indigo-500/30 shadow-lg shadow-indigo-500/10 space-y-2.5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 -mr-2 -mt-2 w-16 h-16 bg-indigo-500/10 rounded-full blur-xl group-hover:scale-150 transition-transform" />
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-full border border-indigo-500/30">
                  Separate Product
                </span>
                <Scale className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-indigo-200 transition-colors">
                  GST &amp; Tax Copilot
                </div>
                <p className="text-[11px] text-slate-400 leading-snug mt-1">
                  Fine-tuned Qwen3-1.7B statutory compliance assistant with dedicated UI.
                </p>
              </div>
              <Link
                href="/chat"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/20 border border-indigo-400/30 transition-all duration-200"
              >
                <span>Launch Tax Copilot</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom User Profile Section: isSignedIn vs Guest */}
        {isSignedIn ? (
          <div className="p-3 border-t border-slate-800/80 bg-slate-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: 'w-8 h-8 rounded-full ring-2 ring-indigo-500/30',
                  },
                }}
              />
              <div className="truncate text-left">
                <p className="text-xs font-medium text-slate-200 truncate">
                  {user?.fullName || user?.username || 'Authenticated User'}
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  {user?.primaryEmailAddress?.emailAddress || 'Clerk Session Active'}
                </p>
              </div>
            </div>
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
        ) : (
          <div className="p-3 border-t border-slate-800/80 bg-slate-900/30 space-y-2">
            <Link
              href="/sign-in"
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition-all"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Log In</span>
            </Link>
            <Link
              href="/sign-up"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5 text-slate-400" />
              <span>Sign Up</span>
            </Link>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-slate-950/80 backdrop-blur-md flex">
          <div className="w-72 bg-slate-900 border-r border-slate-800 h-full p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                    <Zap className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-slate-100">Gravita AI</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {onOpenCreateTool && (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenCreateTool();
                  }}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-xs"
                >
                  <PlusCircle className="w-4 h-4" />
                  Create AI Tool
                </button>
              )}

              <nav className="mt-4 space-y-2">
                <Link
                  href="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between p-2.5 rounded-xl text-sm ${
                    pathname === '/'
                      ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                      : 'text-slate-400'
                  }`}
                >
                  <span>Home / Overview</span>
                </Link>

                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between p-2.5 rounded-xl text-sm ${
                      item.active
                        ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                        : 'text-slate-400'
                    }`}
                  >
                    <span>{item.name}</span>
                    <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  </Link>
                ))}
              </nav>

              {/* Mobile GST & Tax Highlight Card */}
              <div className="mt-6 p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold text-indigo-300 uppercase">
                  <span>Standalone Product</span>
                  <Scale className="w-3.5 h-3.5" />
                </div>
                <div className="text-xs font-semibold text-white">
                  GST &amp; Indian Tax AI
                </div>
                <Link
                  href="/chat"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium w-full"
                >
                  <span>Launch Copilot</span>
                  <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800">
              {isSignedIn ? (
                <div className="flex items-center gap-3">
                  <UserButton />
                  <div className="truncate">
                    <p className="text-xs text-slate-200">
                      {user?.fullName || 'Active User'}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {user?.primaryEmailAddress?.emailAddress}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Link
                    href="/sign-in"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Log In</span>
                  </Link>
                  <Link
                    href="/sign-up"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full flex items-center justify-center py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>
          </div>
          <div
            className="flex-1"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header Bar */}
        <header className="md:hidden h-14 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 text-slate-400 hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-semibold text-sm text-slate-100">
              Gravita AI
            </span>
          </div>

          {isSignedIn ? (
            <UserButton />
          ) : (
            <Link
              href="/sign-in"
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
            >
              Log In
            </Link>
          )}
        </header>

        {/* Primary Page Canvas */}
        <main className="flex-1 overflow-y-auto min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
