'use client';

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { AppNotification } from './types';

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  isConnected: boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  latestToast: AppNotification | null;
  dismissToast: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, isSignedIn } = useUser();
  const currentUserId = user?.id || (isSignedIn ? 'authenticated_user' : 'guest_user');

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [latestToast, setLatestToast] = useState<AppNotification | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load cached notifications from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`nexus_notifications_${currentUserId}`);
      if (stored) {
        setNotifications(JSON.parse(stored));
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [currentUserId]);

  // Persist to localStorage whenever notifications change
  const saveNotifications = (items: AppNotification[]) => {
    setNotifications(items);
    try {
      localStorage.setItem(`nexus_notifications_${currentUserId}`, JSON.stringify(items.slice(0, 50)));
    } catch (e) {
      // ignore storage errors
    }
  };

  const connectWebSocket = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    // Determine correct WS host
    const isDev = process.env.NODE_ENV !== 'production';
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsHost = '127.0.0.1:8000';
    if (!isDev) {
      wsHost = window.location.host;
    }

    const wsUrl = `${wsProto}//${wsHost}/ws/notifications/${currentUserId}/`;

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log(`[Notification Gateway] Connected to ${wsUrl}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'CONNECTION_ESTABLISHED' || data.type === 'pong') {
            return;
          }

          const newNotif: AppNotification = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            type: data.type || 'INFO',
            tool_title: data.tool_title || 'Agent System',
            step_name: data.step_name || (data.type === 'HITL_REQUEST' ? 'Approval Required' : 'Status Update'),
            details: data.details || data.summary || data.message || '',
            status: data.status || 'completed',
            timestamp: data.timestamp || new Date().toISOString(),
            read: false,
            step_index: data.step_index,
            total_steps: data.total_steps,
            thread_id: data.thread_id,
            data,
          };

          setNotifications((prev) => {
            // Deduplicate if identical type and thread_id received within 15 seconds
            if (
              newNotif.thread_id &&
              prev.some(
                (n) =>
                  n.type === newNotif.type &&
                  n.thread_id === newNotif.thread_id &&
                  Math.abs(Date.now() - new Date(n.timestamp).getTime()) < 15000
              )
            ) {
              return prev;
            }
            const nextList = [newNotif, ...prev].slice(0, 50);
            try {
              localStorage.setItem(`nexus_notifications_${currentUserId}`, JSON.stringify(nextList));
            } catch (err) {}
            // Trigger toast alert only if not duplicate
            setLatestToast(newNotif);
            return nextList;
          });
        } catch (err) {
          console.warn('[Notification Gateway] Error parsing WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        socketRef.current = null;
        // Auto-reconnect with 3.5s delay
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3500);
      };

      ws.onerror = () => {
        setIsConnected(false);
      };
    } catch (err) {
      console.warn('[Notification Gateway] Failed to instantiate WebSocket:', err);
    }
  }, [currentUserId]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connectWebSocket]);

  // Keep alive ping every 30 seconds
  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    return () => clearInterval(pingInterval);
  }, []);

  const markAsRead = (id: string) => {
    const updated = notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
    saveNotifications(updated);
  };

  const markAllAsRead = () => {
    const updated = notifications.map((n) => ({ ...n, read: true }));
    saveNotifications(updated);
  };

  const clearAll = () => {
    saveNotifications([]);
  };

  const dismissToast = () => {
    setLatestToast(null);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isConnected,
        markAsRead,
        markAllAsRead,
        clearAll,
        latestToast,
        dismissToast,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
