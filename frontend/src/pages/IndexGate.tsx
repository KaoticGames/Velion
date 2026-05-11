import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import Landing from '@/pages/Landing';
import LandingLive from '@/pages/Landing-live';

const betaGate = import.meta.env.VITE_BETA_GATE_ENABLED !== 'false';
const PublicLanding = betaGate ? Landing : LandingLive;

/**
 * `/` — public marketing landing when logged out; redirects authenticated users to `/home`.
 */
export default function IndexGate() {
  const { user, isLoading, isReady } = useAuthStore();
  const mockAuth = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';

  if (!mockAuth && isLoading && !isReady) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 'calc(100vh - 75px)', background: '#06070c',
        fontFamily: "'Cinzel', serif", color: '#c4922a',
        fontSize: '16px', letterSpacing: '0.2em',
      }}>
        VELION MYTHERA
      </div>
    );
  }

  if (user && !mockAuth) {
    return <Navigate to="/home" replace />;
  }

  return <PublicLanding />;
}
