type Props = {
  disabled?: boolean;
};

/** Opens Twitch OAuth in a popup; parent completes login via `useGoogleOAuthCompletion` + `refreshSession`. */
export function TwitchSignInButton({ disabled }: Props) {
  const openPopup = () => {
    const base = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');
    const origin = encodeURIComponent(window.location.origin);
    const url = `${base}/auth/oauth/twitch/start?popup=1&origin=${origin}`;
    const w = 520;
    const h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(url, 'velion_twitch_oauth', `width=${w},height=${h},left=${left},top=${top}`);
  };

  return (
    <button
      type="button"
      onClick={openPopup}
      disabled={disabled}
      style={{
        width:           '100%',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             '12px',
        padding:         '12px 16px',
        borderRadius:    '3px',
        border:          '1px solid #5c3d9e',
        background:      '#9146ff',
        color:           '#fff',
        fontFamily:      "'Roobert', 'Helvetica Neue', system-ui, sans-serif",
        fontSize:        '14px',
        fontWeight:      600,
        letterSpacing:   '0.02em',
        cursor:          disabled ? 'not-allowed' : 'pointer',
        opacity:         disabled ? 0.55 : 1,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M11.571 4.714h1.715v5.143H11.57V4.714zM4.714 0 0 4.714v15.429h5.143V24l4.714-4.714h3.857L24 12.429V0H4.714zm17.143 11.143-3.857 3.857h-3.857l-3 3v-3H7.286V2.571h14.571v8.572z" />
      </svg>
      Sign on with Twitch
    </button>
  );
}
