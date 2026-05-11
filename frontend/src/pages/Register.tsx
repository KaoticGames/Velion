import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/lib/api';
import { SocialAuthIconRow } from '@/components/SocialAuthIconRow';
import { useGoogleOAuthCompletion } from '@/hooks/useGoogleOAuthCompletion';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', danger: '#c8503a',
};

export default function Register() {
  const [displayName, setDisplayName] = useState('');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);

  const { register, refreshSession, bootstrapSession } = useAuthStore();
  const navigate = useNavigate();

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
        navigate('/home', { replace: true });
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
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      await register(email, password, displayName);
      navigate('/home', { replace: true });
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
  const lbl = {
    fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.14em',
    color: T.textMuted, display: 'block', marginBottom: '6px',
  };

  return (
    <div className="page-enter" style={{
      minHeight: 'calc(100vh - 52px)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{
        width: '100%', maxWidth: '440px', background: T.card,
        border: `1px solid ${T.border}`, borderTop: `2px solid ${T.gold}`,
        borderRadius: '4px', padding: '40px 36px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.3em', color: T.textMuted, marginBottom: '10px' }}>
            VELION MYTHERA
          </div>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: '25px', color: T.gold, letterSpacing: '0.14em', fontWeight: '600' }}>
            BEGIN YOUR LEGEND
          </h1>
          <SocialAuthIconRow disabled={loading} />
        </div>

        <div style={{ height: 1, background: T.border, margin: '20px 0' }} />

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '18px' }}>
            <label style={lbl}>DISPLAY NAME</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              required autoComplete="nickname" style={inp} />
          </div>
          <div style={{ marginBottom: '18px' }}>
            <label style={lbl}>EMAIL</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required autoComplete="email" style={inp} />
          </div>
          <div style={{ marginBottom: '18px' }}>
            <label style={lbl}>PASSWORD</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="new-password" style={inp} />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={lbl}>CONFIRM PASSWORD</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              required autoComplete="new-password" style={inp} />
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

          <button type="submit" disabled={loading} style={{
            width: '100%', background: loading ? T.textMuted : T.gold,
            border: 'none', color: '#06070c', fontFamily: "'Cinzel', serif",
            fontSize: '15px', letterSpacing: '0.18em', padding: '13px',
            borderRadius: '3px', cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '700', opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
          </button>
        </form>

        <p style={{ fontSize: '15px', color: T.textMuted, textAlign: 'center', marginTop: '16px', fontFamily: "'EB Garamond', serif" }}>
          Free accounts include 3 characters. Upgrade anytime.
        </p>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <span style={{ color: T.textMuted, fontSize: '17px', fontFamily: "'EB Garamond', serif" }}>
            Already have an account?{' '}
          </span>
          <Link to="/login" style={{ color: T.gold, fontFamily: "'Cinzel', serif", fontSize: '14px', letterSpacing: '0.1em', textDecoration: 'none' }}>
            ENTER
          </Link>
        </div>
      </div>
    </div>
  );
}
