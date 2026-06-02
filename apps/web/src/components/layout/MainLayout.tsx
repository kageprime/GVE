import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { MetaHeader } from './MetaHeader';
import { useChatStore } from '../../stores';
import { useAuth } from '../../lib/clerk';
import { setAuthTokenProvider } from '../../api';
import { useServerStateSync } from '../../hooks/useServerStateSync';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const initialize = useChatStore((state) => state.initialize);
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const isWorkspaceRoute = pathname.startsWith('/chat')
    || pathname.startsWith('/scenes')
    || pathname.startsWith('/tasks')
    || pathname.startsWith('/sessions');
  const isChatRoute = pathname.startsWith('/chat');

  // Sync TanStack Query session data into Zustand for legacy components
  useServerStateSync();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    // Register the token provider so every API request carries the Clerk JWT.
    setAuthTokenProvider(() => getToken());

    // Clear any stale auth error before retrying initialization.
    useChatStore.setState({ sessionsError: null });

    // Initialize WebSocket and providers (sessions now load via React Query)
    void initialize();
  }, [isLoaded, isSignedIn, getToken, initialize]);

  return (
    <div className={`relative z-10 flex h-[100dvh] w-screen flex-row text-meta-text ${isChatRoute ? 'bg-[#18181B]' : 'bg-surface'}`}>
      <Sidebar />
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isWorkspaceRoute ? "relative isolate" : ""}`}>
        <MetaHeader />
        <main className={`flex min-h-0 w-full flex-1 ${isWorkspaceRoute ? 'max-w-none flex-col' : ''}`}>
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
