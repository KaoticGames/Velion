type Props = {
  disabled?: boolean;
};

function openOAuthPopup(provider: 'google' | 'twitch' | 'discord') {
  const base = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');
  const origin = encodeURIComponent(window.location.origin);
  const url = `${base}/auth/oauth/${provider}/start?popup=1&origin=${origin}`;
  const w = 520;
  const h = 640;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  window.open(url, `velion_${provider}_oauth`, `width=${w},height=${h},left=${left},top=${top}`);
}

function IconButton(props: {
  disabled?: boolean;
  label: string;
  iconSrc: string;
  onClick?: () => void;
  title?: string;
}) {
  const { disabled, label, iconSrc, onClick, title } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      style={{
        width:  44,
        height: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <img
        src={iconSrc}
        alt=""
        aria-hidden
        width={35}
        height={35}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    </button>
  );
}

/**
 * Uses public/ assets:
 * - /google_logo.svg
 * - /twitch_logo.svg
 * - /discord_logo.svg
 */
export function SocialAuthIconRow({ disabled }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
        marginTop: '14px',
      }}
    >
      <IconButton
        disabled={disabled}
        label="Sign in with Google"
        iconSrc="/google_logo.svg"
        onClick={() => openOAuthPopup('google')}
      />
      <IconButton
        disabled={disabled}
        label="Sign in with Twitch"
        iconSrc="/twitch_logo.svg"
        onClick={() => openOAuthPopup('twitch')}
      />
      <IconButton
        disabled={disabled}
        label="Sign in with Discord"
        iconSrc="/discord_logo.svg"
        onClick={() => openOAuthPopup('discord')}
        title="Sign in with Discord"
      />
    </div>
  );
}

