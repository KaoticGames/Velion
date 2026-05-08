import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

const T = {
  bg: '#06070c', border: '#1c2030', gold: '#c4922a',
  text: '#e4d8c0', textMuted: '#706858',
};

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  fontFamily:     "'Cinzel', serif",
  fontSize:       '11px',
  letterSpacing:  '0.14em',
  textDecoration: 'none',
  color:          isActive ? T.gold : T.textMuted,
  borderBottom:   isActive ? `1px solid ${T.gold}` : '1px solid transparent',
  paddingBottom:  '2px',
  transition:     'color 0.15s, border-color 0.15s',
});

export default function NavBar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const mockAuth  = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav style={{
      background:    T.bg,
      borderBottom:  `1px solid ${T.border}`,
      padding:       '0 24px',
      height:        '52px',
      display:       'flex',
      alignItems:    'center',
      justifyContent:'space-between',
      position:      'sticky',
      top:            0,
      zIndex:        100,
      flexShrink:    0,
    }}>
      {/* Logo */}
      <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
        <img
          src="/velion_wordmark.png"
          alt="Velion Mythera"
          style={{ display: 'block', height: '50px', width: 'auto' }}
        />
      </Link>

      {/* Nav links — only shown when authenticated or mock mode */}
      {(user || mockAuth) && (
        <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
          <NavLink to="/characters" style={navLinkStyle}>CHARACTERS</NavLink>
          <NavLink to="/campaigns"  style={navLinkStyle}>CAMPAIGNS</NavLink>
          <NavLink to="/library/weapons" style={navLinkStyle}>LIBRARY</NavLink>
          <NavLink to="/homebrew"   style={navLinkStyle}>WORKSHOP</NavLink>
          <NavLink to="/compendium" style={navLinkStyle}>COMPENDIUM</NavLink>
        </div>
      )}

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {!user && (
          <Link to="/login" style={{
            fontFamily:     "'Cinzel', serif",
            fontSize:       '11px',
            letterSpacing:  '0.16em',
            textDecoration: 'none',
            color:          T.gold,
            border:         `1px solid ${T.gold}55`,
            padding:        '5px 14px',
            borderRadius:   '3px',
            transition:     'background 0.15s',
          }}>
            ENTER
          </Link>
        )}
        {mockAuth && !user && (
          <span style={{
            fontFamily:    "'Cinzel', serif",
            fontSize:      '9px',
            letterSpacing: '0.12em',
            color:         '#cc9020',
            border:        '1px solid #cc902055',
            padding:       '2px 7px',
            borderRadius:  '3px',
          }}>
            DEV MODE
          </span>
        )}
        {user && (
          <>
            <span style={{
              fontFamily:    "'Cinzel', serif",
              fontSize:      '10px',
              letterSpacing: '0.1em',
              color:         T.textMuted,
            }}>
              {user.display_name}
            </span>
            <span style={{
              fontFamily:    "'Cinzel', serif",
              fontSize:      '9px',
              letterSpacing: '0.1em',
              color:         user.subscription_tier === 'dm' ? T.gold : '#706858',
              textTransform: 'uppercase',
              border:        `1px solid ${user.subscription_tier === 'dm' ? T.gold + '55' : '#1c2030'}`,
              padding:       '2px 7px',
              borderRadius:  '3px',
            }}>
              {user.subscription_tier}
            </span>
            <button
              onClick={handleLogout}
              style={{
                background:    'transparent',
                border:        `1px solid ${T.border}`,
                color:         T.textMuted,
                fontFamily:    "'Cinzel', serif",
                fontSize:      '10px',
                letterSpacing: '0.1em',
                padding:       '4px 12px',
                borderRadius:  '3px',
                cursor:        'pointer',
              }}
            >
              LOGOUT
            </button>
          </>
        )}

      </div>
    </nav>
  );
}