import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router }       from './router';
import { useAuthStore } from './store/authStore';
import GlobalDiceOverlay from '@/components/GlobalDiceOverlay';
import { useSessionActivityExtend } from '@/hooks/useSessionActivityExtend';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:              1,
      refetchOnWindowFocus: false,
      staleTime:          30_000,
    },
  },
});

function AuthGate() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const mockAuth = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';
  useSessionActivityExtend();

  useEffect(() => {
    // In dev mock mode, skip the refresh call (no backend required)
    if (mockAuth) {
      useAuthStore.setState({ isLoading: false, isReady: true });
      return;
    }
    hydrate();
  }, [hydrate, mockAuth]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <RouterProvider router={router} />
      <GlobalDiceOverlay />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <AuthGate />
      </div>
    </QueryClientProvider>
  );
}
