import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/lib/api';
import { SocialAuthIconRow } from '@/components/SocialAuthIconRow';
import { useGoogleOAuthCompletion } from '@/hooks/useGoogleOAuthCompletion';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', danger: '#c8503a',
};

export default function Login() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const { login, refreshSession, bootstrapSession, user } = useAuthStore();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/home';

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [from, navigate, user]);

  useGoogleOAuthCompletion(
    async (msg) => {
      setError('');
      setLoading(true);
      try {
        if (msg.access_token && msg.user) {
          bootstrapSession(msg.access_token, msg.user);
        } else {
          await refreshSession();
        }
        navigate(from, { replace: true });
      } catch (err) {
        setError(extractApiError(err).message);
      } finally {
        setLoading(false);
      }
    },
    (msg) => setError(msg),
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    background: T.surface, border: `1px solid ${T.border}`, color: T.text,
    borderRadius: '3px', padding: '10px 14px', fontSize: '18px',
    fontFamily: "'EB Garamond', serif", width: '100%', outline: 'none',
  };

  return (
    <div className="page-enter" style={{
      minHeight:      'calc(100vh - 52px)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        '40px 24px',
    }}>
      <div style={{
        width:        '100%',
        maxWidth:     '420px',
        background:   T.card,
        border:       `1px solid ${T.border}`,
        borderTop:    `2px solid ${T.gold}`,
        borderRadius: '4px',
        padding:      '40px 36px',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.3em', color: T.textMuted, marginBottom: '10px' }}>
            VELION MYTHERA
          </div>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: '25px', color: T.gold, letterSpacing: '0.14em', fontWeight: '600' }}>
            ENTER THE WORLD
          </h1>
          <SocialAuthIconRow disabled={loading} />
        </div>

        <div style={{ height: 1, background: T.border, margin: '20px 0' }} />

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '18px' }}>
            <label style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.14em', color: T.textMuted, display: 'block', marginBottom: '6px' }}>
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inp}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.14em', color: T.textMuted, display: 'block', marginBottom: '6px' }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inp}
            />
          </div>

          {error && (
            <div style={{
              color: T.danger, background: '#1a0604', border: `1px solid ${T.danger}44`,
              borderRadius: '3px', padding: '10px 14px', fontSize: '16px',
              fontFamily: "'EB Garamond', serif", marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width:         '100%',
              background:    loading ? T.textMuted : T.gold,
              border:        'none',
              color:         '#06070c',
              fontFamily:    "'Cinzel', serif",
              fontSize: '15px',
              letterSpacing: '0.18em',
              padding:       '13px',
              borderRadius:  '3px',
              cursor:        loading ? 'not-allowed' : 'pointer',
              fontWeight:    '700',
              opacity:       loading ? 0.6 : 1,
            }}
          >
            {loading ? 'ENTERING...' : 'ENTER'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <span style={{ color: T.textMuted, fontSize: '17px', fontFamily: "'EB Garamond', serif" }}>
            No account?{' '}
          </span>
          <Link to="/register" style={{
            color: T.gold, fontFamily: "'Cinzel', serif",
            fontSize: '14px', letterSpacing: '0.1em', textDecoration: 'none',
          }}>
            REGISTER
          </Link>
        </div>
      </div>
    </div>
  );
}
