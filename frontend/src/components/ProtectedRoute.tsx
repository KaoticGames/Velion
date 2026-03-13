import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

interface Props {
  children: React.ReactNode;
  requireDM?: boolean;
}

/**
 * Wraps routes that require authentication.
 * During the initial hydration (app boot), shows nothing to avoid flash.
 * After hydration, redirects unauthenticated users to /login.
 *
 * In DEV mode with VITE_ENABLE_MOCK_AUTH=true, auth is bypassed so the
 * character sheet can be developed without a running backend.
 */
export default function ProtectedRoute({ children, requireDM = false }: Props) {
  const { user, isReady, isLoading } = useAuthStore();
  const location = useLocation();

  const mockAuthEnabled = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';

  // Still hydrating — render nothing to prevent flash
  if (isLoading && !isReady && !mockAuthEnabled) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#06070c',
        fontFamily: "'Cinzel', serif", color: '#c4922a',
        fontSize: '13px', letterSpacing: '0.2em',
      }}>
        VELION MYTHERA
      </div>
    );
  }

  // DEV bypass — skip auth check entirely
  if (mockAuthEnabled) return <>{children}</>;

  // Not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // DM-gated route
  if (requireDM && user.subscription_tier !== 'dm') {
    return <Navigate to="/campaigns" replace />;
  }

  return <>{children}</>;
}
