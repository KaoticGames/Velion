import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router }       from './router';
import { useAuthStore } from './store/authStore';
import GlobalDiceOverlay from '@/components/GlobalDiceOverlay';

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

  useEffect(() => {
    // In dev mock mode, skip the refresh call (no backend required)
    if (mockAuth) {
      useAuthStore.setState({ isLoading: false, isReady: true });
      return;
    }
    hydrate();
  }, [hydrate, mockAuth]);

  return (
    <>
      <RouterProvider router={router} />
      <GlobalDiceOverlay />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}
