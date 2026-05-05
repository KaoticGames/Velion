import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

// ── Campaigns page stub ─────────────────────────────────────────────────────
export function Campaigns() {
  return <ComingSoon icon="🏰" label="CAMPAIGNS" desc="Campaign management, session scheduling, and the DM encounter builder are coming in the next build phase." />;
}

// ── Library page stub ────────────────────────────────────────────────────────
export function Library() {
  return <ComingSoon icon="📚" label="LIBRARY" desc="Searchable weapon, armor, spell gem, and enemy bestiary libraries are coming in the next build phase." />;
}

// ── Compendium page stub ─────────────────────────────────────────────────────
export function Compendium() {
  return <ComingSoon icon="📖" label="COMPENDIUM" desc="The full inline rules reference with formula calculator is coming in the next build phase." />;
}

// ── 404 ──────────────────────────────────────────────────────────────────────
export function NotFound() {
  const { user, isReady, isLoading } = useAuthStore();
  const location = useLocation();
  const mockAuthEnabled = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';
  if (!mockAuthEnabled && isReady && !isLoading && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <ComingSoon icon="✦" label="LOST IN THE VOID" desc="This page does not exist. Perhaps it never did." />;
}

// ── Shared stub component ─────────────────────────────────────────────────────
const T = {
  card: '#0d1018', border: '#1c2030', gold: '#c4922a', goldDim: '#5a3e10',
  text: '#e4d8c0', textMuted: '#706858',
};

function ComingSoon({ icon, label, desc }: { icon: string; label: string; desc: string }) {
  return (
    <div className="page-enter" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 52px)', padding: '40px 24px',
    }}>
      <div style={{
        background: T.card, border: `1px solid ${T.border}`, borderTop: `2px solid ${T.goldDim}`,
        borderRadius: '4px', padding: '48px 40px', textAlign: 'center', maxWidth: '480px',
      }}>
        <div style={{ fontSize: '36px', marginBottom: '16px' }}>{icon}</div>
        <div style={{
          fontFamily: "'Cinzel', serif", fontSize: '14px', letterSpacing: '0.2em',
          color: T.gold, marginBottom: '12px',
        }}>
          {label}
        </div>
        <p style={{ color: T.textMuted, fontSize: '15px', lineHeight: '1.7', fontFamily: "'EB Garamond', serif" }}>
          {desc}
        </p>
      </div>
    </div>
  );
}
