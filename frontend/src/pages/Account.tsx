import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { extractApiError } from '@/lib/api';
import { useAuthStore, type AuthUser } from '@/store/authStore';
import { SocialAuthIconRow } from '@/components/SocialAuthIconRow';
import { useGoogleOAuthCompletion } from '@/hooks/useGoogleOAuthCompletion';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', text: '#e4d8c0', textMuted: '#706858', textDim: '#504538',
  danger: '#c8503a', ok: '#5a9e6f', rp: '#4a9de8',
};

const STRIPE_PLAYER_PRICE = import.meta.env.VITE_STRIPE_PLAYER_PRICE_ID as string | undefined;
const STRIPE_DM_PRICE     = import.meta.env.VITE_STRIPE_DM_PRICE_ID as string | undefined;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type AccountPayload = {
  user:            AuthUser;
  has_password:    boolean;
  oauth_providers: string[];
};

type BillingPayload = {
  tier:               string;
  stripe_customer_id: string | null;
  subscription:       {
    status:             string;
    stripe_price_id:    string;
    current_period_end: string;
  } | null;
};

type Section = 'account' | 'profile' | 'notifications';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'profile', label: 'Profile' },
  { id: 'notifications', label: 'Notifications' },
];

function capTier(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function formatProvider(p: string): string {
  const m: Record<string, string> = { google: 'Google', twitch: 'Twitch', discord: 'Discord' };
  return m[p] ?? p;
}

function parseSection(raw: string | null): Section {
  if (raw === 'profile' || raw === 'notifications') return raw;
  return 'account';
}

export default function Account() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setAuth = useAuthStore.setState;
  const bootstrapSession = useAuthStore((s) => s.bootstrapSession);
  const refreshSession   = useAuthStore((s) => s.refreshSession);

  const section = parseSection(searchParams.get('section'));

  const setSection = (next: Section) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'account') nextParams.delete('section');
    else nextParams.set('section', next);
    setSearchParams(nextParams, { replace: true });
  };

  const [account, setAccount]     = useState<AccountPayload | null>(null);
  const [billing, setBilling]     = useState<BillingPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy]           = useState(false);

  const checkoutFlash = searchParams.get('checkout');
  const [dismissCheckout, setDismissCheckout] = useState(false);

  const loadAccount = useCallback(async () => {
    const { data } = await api.get<AccountPayload>('/auth/account');
    setAccount(data);
    setAuth({ user: data.user });
  }, [setAuth]);

  const loadBilling = useCallback(async () => {
    const { data } = await api.get<BillingPayload>('/billing/subscription');
    setBilling(data);
  }, []);

  const reloadAll = useCallback(async () => {
    setLoadError('');
    try {
      await Promise.all([loadAccount(), loadBilling()]);
    } catch (e) {
      setLoadError(extractApiError(e).message);
    }
  }, [loadAccount, loadBilling]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useGoogleOAuthCompletion(
    async (msg) => {
      try {
        if (msg.access_token && msg.user) {
          bootstrapSession(msg.access_token, msg.user);
        } else {
          await refreshSession();
        }
        await loadAccount();
      } catch (e) {
        setLoadError(extractApiError(e).message);
      }
    },
    (msg) => setLoadError(msg),
  );

  const clearCheckoutParam = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
    setDismissCheckout(true);
  };

  const showCheckoutOk = checkoutFlash === 'success' && !dismissCheckout;
  const showCheckoutCanceled = checkoutFlash === 'canceled' && !dismissCheckout;

  const mergeUser = (u: AuthUser) => {
    setAccount((a) => (a ? { ...a, user: u } : a));
    setAuth({ user: u });
    setLoadError('');
  };

  if (loadError && !account) {
    return (
      <div className="page-enter" style={{ color: T.text, fontFamily: "'EB Garamond', serif", padding: '40px 28px', maxWidth: '720px', margin: '0 auto' }}>
        <p style={{ color: T.danger }}>{loadError}</p>
        <button type="button" onClick={() => void reloadAll()} style={secondaryBtn}>Retry</button>
      </div>
    );
  }

  if (!account || !billing) {
    return (
      <div className="page-enter" style={{ color: T.textMuted, fontFamily: "'EB Garamond', serif", padding: '48px 28px', textAlign: 'center' }}>
        Loading account…
      </div>
    );
  }

  const tier = billing.tier as AuthUser['subscription_tier'];

  return (
    <div className="page-enter" style={{
      color: T.text,
      fontFamily: "'EB Garamond', serif",
      padding: '40px 28px 64px',
      maxWidth: '960px',
      margin: '0 auto',
    }}>
      <header style={{ marginBottom: '28px' }}>
        <div style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '13px',
          letterSpacing: '0.28em',
          color: T.textMuted,
          marginBottom: '10px',
        }}>
          YOUR ACCOUNT
        </div>
        <h1 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: 'clamp(24px, 3.5vw, 32px)',
          color: T.gold,
          letterSpacing: '0.1em',
          fontWeight: 600,
          margin: '0 0 10px',
        }}>
          Settings
        </h1>
        <p style={{ color: T.textMuted, fontSize: '18px', lineHeight: 1.65, maxWidth: '680px', margin: 0 }}>
          Account security and billing, public profile, and notification preferences.
        </p>
        <div style={{ marginTop: '14px' }}>
          <Link to="/home" style={{ color: T.rp, fontSize: '17px', textDecoration: 'none' }}>← Back to home</Link>
        </div>
      </header>

      <nav
        aria-label="Account sections"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '28px',
          paddingBottom: '16px',
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        {SECTIONS.map(({ id, label }) => {
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '13px',
                letterSpacing: '0.16em',
                padding: '10px 18px',
                borderRadius: '4px',
                border: `1px solid ${active ? T.gold : T.border}`,
                background: active ? `${T.gold}18` : 'transparent',
                color: active ? T.gold : T.textMuted,
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s, background 0.15s',
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {showCheckoutOk && (
        <CheckoutBanner kind="ok" onDismiss={clearCheckoutParam} message="Checkout completed. Your tier may take a moment to update; refresh if needed." />
      )}
      {showCheckoutCanceled && (
        <CheckoutBanner kind="canceled" onDismiss={clearCheckoutParam} message="Checkout was canceled. No changes were made." />
      )}
      {loadError && (
        <div style={{ ...bannerBase, borderColor: `${T.danger}55`, color: T.danger, marginBottom: '20px' }}>{loadError}</div>
      )}

      {section === 'account' && (
        <AccountSections
          account={account}
          billing={billing}
          tier={tier}
          busy={busy}
          setBusy={setBusy}
          navigate={navigate}
          loadAccount={loadAccount}
          mergeUser={mergeUser}
          onError={(m) => setLoadError(m)}
          refreshSession={refreshSession}
        />
      )}

      {section === 'profile' && (
        <PublicProfileSection
          user={account.user}
          busy={busy}
          setBusy={setBusy}
          mergeUser={mergeUser}
          onError={(m) => setLoadError(m)}
        />
      )}

      {section === 'notifications' && <NotificationsPlaceholder />}
    </div>
  );
}

function AccountSections(props: {
  account:       AccountPayload;
  billing:       BillingPayload;
  tier:          AuthUser['subscription_tier'];
  busy:          boolean;
  setBusy:       (v: boolean) => void;
  navigate:      ReturnType<typeof useNavigate>;
  loadAccount:   () => Promise<void>;
  mergeUser:     (u: AuthUser) => void;
  onError:       (m: string) => void;
  refreshSession: () => Promise<void>;
}) {
  const {
    account, billing, tier, busy, setBusy, navigate, loadAccount, mergeUser, onError, refreshSession,
  } = props;

  return (
    <>
      <section style={sectionBox}>
        <h2 style={sectionTitle}>Email address</h2>
        <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.6, marginTop: 0 }}>
          Your email is used for sign-in and billing receipts. Changing it requires your current password.
        </p>
        <div style={{ ...inputLike, marginBottom: '14px', color: T.textMuted, maxWidth: '420px' }}>
          {account.user.email}
        </div>
        {account.has_password ? (
          <EmailChangeForm busy={busy} setBusy={setBusy} mergeUser={mergeUser} onError={onError} refreshSession={refreshSession} />
        ) : (
          <p style={{ color: T.textDim, fontSize: '16px', fontStyle: 'italic', margin: 0 }}>
            Add a password below to enable email changes on this account.
          </p>
        )}
      </section>

      <section style={{ ...sectionBox, marginTop: '22px' }}>
        <h2 style={sectionTitle}>Sign-in & linked accounts</h2>
        <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.6, marginTop: 0 }}>
          {account.has_password
            ? 'You can sign in with email and password.'
            : 'This account has no password yet — sign in with a linked provider, or create a password below.'}
        </p>
        {account.oauth_providers.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '8px' }}>
              LINKED PROVIDERS
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', color: T.textMuted, fontSize: '17px' }}>
              {account.oauth_providers.map((p) => (
                <li key={p}>{formatProvider(p)}</li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '8px' }}>
            LINK ANOTHER PROVIDER
          </div>
          <SocialAuthIconRow disabled={busy} />
          <p style={{ color: T.textDim, fontSize: '15px', fontStyle: 'italic', marginTop: '10px', marginBottom: 0 }}>
            The provider must use the same email as this Velion account, or a separate account may be created.
          </p>
        </div>
        {account.has_password ? (
          <ChangePasswordForm
            busy={busy}
            setBusy={setBusy}
            onSuccess={() => {
              useAuthStore.getState()._clearAuth();
              navigate('/login', { replace: true });
            }}
            onError={onError}
          />
        ) : (
          <CreatePasswordForm
            busy={busy}
            setBusy={setBusy}
            onSuccess={async () => {
              onError('');
              await loadAccount();
            }}
            onError={onError}
          />
        )}
      </section>

      <section style={{ ...sectionBox, marginTop: '22px' }}>
        <h2 style={sectionTitle}>Subscription & payment</h2>
        <p style={{ marginTop: 0, color: T.textMuted, fontSize: '18px' }}>
          Current tier:{' '}
          <strong style={{ color: tier === 'dm' ? T.gold : T.text }}>{capTier(tier)}</strong>
        </p>
        {billing.subscription && (
          <ul style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.6, paddingLeft: '20px', margin: '12px 0 0' }}>
            <li>Status: {billing.subscription.status}</li>
            <li>
              Renews or ends:{' '}
              {new Date(billing.subscription.current_period_end).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </li>
          </ul>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '20px' }}>
          {tier === 'free' && STRIPE_PLAYER_PRICE && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startCheckout(STRIPE_PLAYER_PRICE, setBusy, onError)}
              style={primaryBtn}
            >
              Upgrade to Player
            </button>
          )}
          {tier !== 'dm' && STRIPE_DM_PRICE && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startCheckout(STRIPE_DM_PRICE, setBusy, onError)}
              style={primaryBtn}
            >
              {tier === 'free' ? 'Upgrade to DM' : 'Switch to DM'}
            </button>
          )}
          {billing.stripe_customer_id && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void openPortal(setBusy, onError)}
              style={secondaryBtn}
            >
              Manage billing & payment methods
            </button>
          )}
        </div>
        {(!STRIPE_PLAYER_PRICE || !STRIPE_DM_PRICE) && (
          <p style={{ color: T.textDim, fontSize: '15px', marginTop: '14px', fontStyle: 'italic' }}>
            Stripe price IDs are not set in this frontend build (<code style={{ color: T.textMuted }}>VITE_STRIPE_*_PRICE_ID</code>).
            Upgrades still work if your deployment defines them.
          </p>
        )}
        {tier === 'free' && !billing.stripe_customer_id && (
          <p style={{ color: T.textDim, fontSize: '15px', marginTop: '12px' }}>
            After you subscribe, you can open the billing portal to update cards and download invoices.
          </p>
        )}
      </section>
    </>
  );
}

function PublicProfileSection(props: {
  user:      AuthUser;
  busy:      boolean;
  setBusy:   (v: boolean) => void;
  mergeUser: (u: AuthUser) => void;
  onError:   (m: string) => void;
}) {
  const { user, busy, setBusy, mergeUser, onError } = props;
  const [displayName, setDisplayName] = useState(user.display_name);
  const [bio, setBio]                 = useState(user.bio ?? '');
  const [social, setSocial]           = useState(user.social_handle ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user.display_name);
    setBio(user.bio ?? '');
    setSocial(user.social_handle ?? '');
    setAvatarPreview(user.avatar_url);
  }, [user.display_name, user.bio, user.social_handle, user.avatar_url]);

  const applyAvatarUrl = async (url: string | null) => {
    onError('');
    setBusy(true);
    try {
      const { data } = await api.patch<{ user: AuthUser }>('/auth/profile', { avatar_url: url });
      mergeUser(data.user);
      setAvatarPreview(data.user.avatar_url);
    } catch (err) {
      onError(extractApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!f) return;
    let contentType = f.type || 'image/jpeg';
    if (contentType === 'image/jpg') contentType = 'image/jpeg';
    if (!IMAGE_TYPES.has(contentType)) {
      onError('Use PNG, JPEG, or WEBP for your avatar.');
      return;
    }
    setAvatarUploading(true);
    onError('');
    try {
      const { data: presign } = await api.post<{ upload_url: string; public_url: string }>(
        '/auth/avatar/upload-url',
        { filename: f.name || 'avatar.jpg', content_type: contentType },
      );
      const putRes = await fetch(presign.upload_url, {
        method:  'PUT',
        body:    f,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      const pub = presign.public_url?.trim() || '';
      if (!pub) throw new Error('No avatar URL returned from storage.');
      const { data } = await api.patch<{ user: AuthUser }>('/auth/profile', { avatar_url: pub });
      mergeUser(data.user);
      setAvatarPreview(data.user.avatar_url);
    } catch (err) {
      onError(extractApiError(err).message);
    } finally {
      setAvatarUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError('');
    setBusy(true);
    try {
      const { data } = await api.patch<{ user: AuthUser }>('/auth/profile', {
        display_name:   displayName.trim(),
        bio:            bio.trim() || null,
        social_handle:  social.trim() || null,
      });
      mergeUser(data.user);
    } catch (err) {
      onError(extractApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={sectionBox}>
      <h2 style={sectionTitle}>Public profile</h2>
      <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, marginTop: 0 }}>
        These details can be shown to other players and DMs where Velion supports profiles (more surfaces coming later).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', marginBottom: '24px', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '8px' }}>
            AVATAR
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => !avatarUploading && !busy && fileRef.current?.click()}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                fileRef.current?.click();
              }
            }}
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: T.card,
              border: `1px solid ${T.border}`,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: busy || avatarUploading ? 'wait' : 'pointer',
              opacity: busy || avatarUploading ? 0.75 : 1,
            }}
          >
            {avatarPreview
              ? <img src={avatarPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (
                <span style={{ color: T.textDim, fontSize: '13px', textAlign: 'center', padding: '8px', fontFamily: "'Cinzel', serif", letterSpacing: '0.08em' }}>
                  ADD PHOTO
                </span>
              )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(ev) => void onAvatarFile(ev)} />
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
            <button type="button" disabled={busy || avatarUploading} onClick={() => fileRef.current?.click()} style={secondaryBtn}>
              Upload
            </button>
            {avatarPreview && (
              <button
                type="button"
                disabled={busy || avatarUploading}
                onClick={() => void applyAvatarUrl(null)}
                style={secondaryBtn}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ flex: '1 1 280px', minWidth: '260px' }}>
          <label style={labelStyle}>Username (display name)</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={1}
            maxLength={120}
            style={{ ...inputLike, marginBottom: '14px', width: '100%', boxSizing: 'border-box' }}
          />
          <label style={labelStyle}>Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="A short introduction…"
            style={{
              ...inputLike,
              marginBottom: '14px',
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              minHeight: '100px',
            }}
          />
          <label style={labelStyle}>Social handle</label>
          <input
            value={social}
            onChange={(e) => setSocial(e.target.value)}
            maxLength={80}
            placeholder="@you or link slug"
            style={{ ...inputLike, marginBottom: '16px', width: '100%', boxSizing: 'border-box' }}
          />
          <button type="submit" disabled={busy || avatarUploading} style={primaryBtn}>Save profile</button>
        </form>
      </div>
    </section>
  );
}

function NotificationsPlaceholder() {
  const rows = [
    { id: 'marketing', label: 'News & product updates', desc: 'Occasional announcements and release notes.' },
    { id: 'social', label: 'Social & invitations', desc: 'Campaign invites, table activity, and friend requests.' },
    { id: 'billing', label: 'Billing & account', desc: 'Receipts, failed payments, and subscription changes.' },
  ] as const;

  return (
    <section style={sectionBox}>
      <h2 style={sectionTitle}>Email notifications</h2>
      <p style={{ color: T.textMuted, fontSize: '18px', lineHeight: 1.65, marginTop: 0 }}>
        Choose what we send to your inbox. Delivery is not wired up yet — these options are a preview of upcoming settings.
      </p>
      <div
        style={{
          border: `1px dashed ${T.goldDim}`,
          background: `${T.card}99`,
          borderRadius: '4px',
          padding: '12px 16px',
          marginBottom: '22px',
          color: T.textDim,
          fontSize: '16px',
        }}
      >
        Coming soon — preferences will be saved here once transactional email is enabled.
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((row) => (
          <li
            key={row.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '14px',
              padding: '16px 0',
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            <input type="checkbox" disabled style={{ marginTop: '4px', opacity: 0.45, cursor: 'not-allowed' }} />
            <div>
              <div style={{ color: T.text, fontSize: '18px', marginBottom: '4px' }}>{row.label}</div>
              <div style={{ color: T.textMuted, fontSize: '16px', lineHeight: 1.5 }}>{row.desc}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmailChangeForm(props: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  mergeUser: (u: AuthUser) => void;
  onError: (m: string) => void;
  refreshSession: () => Promise<void>;
}) {
  const [next, setNext] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    props.onError('');
    props.setBusy(true);
    try {
      const { data } = await api.patch<{ user: AuthUser }>('/auth/email', {
        new_email:         next.trim(),
        current_password:  password,
      });
      props.mergeUser(data.user);
      setNext('');
      setPassword('');
      await props.refreshSession();
    } catch (err) {
      props.onError(extractApiError(err).message);
    } finally {
      props.setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ maxWidth: '440px' }}>
      <label style={labelStyle}>New email</label>
      <input
        type="email"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="email"
        style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }}
      />
      <label style={labelStyle}>Current password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '14px' }}
      />
      <button type="submit" disabled={props.busy || !next.trim()} style={primaryBtn}>Update email</button>
    </form>
  );
}

function CheckoutBanner(props: { kind: 'ok' | 'canceled'; message: string; onDismiss: () => void }) {
  const { kind, message, onDismiss } = props;
  const border = kind === 'ok' ? `${T.ok}55` : `${T.textMuted}44`;
  const color  = kind === 'ok' ? T.ok : T.textMuted;
  return (
    <div style={{ ...bannerBase, borderColor: border, color, marginBottom: '22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
      <span>{message}</span>
      <button type="button" onClick={onDismiss} style={{ ...secondaryBtn, flexShrink: 0 }}>Dismiss</button>
    </div>
  );
}

async function startCheckout(priceId: string, setBusy: (v: boolean) => void, onErr: (m: string) => void) {
  setBusy(true);
  try {
    const { data } = await api.post<{ checkout_url: string }>('/billing/checkout', { price_id: priceId });
    window.location.href = data.checkout_url;
  } catch (e) {
    onErr(extractApiError(e).message);
  } finally {
    setBusy(false);
  }
}

async function openPortal(setBusy: (v: boolean) => void, onErr: (m: string) => void) {
  setBusy(true);
  try {
    const { data } = await api.post<{ portal_url: string }>('/billing/portal');
    window.location.href = data.portal_url;
  } catch (e) {
    onErr(extractApiError(e).message);
  } finally {
    setBusy(false);
  }
}

function CreatePasswordForm(props: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    props.onError('');
    if (a.length < 8) {
      props.onError('Password must be at least 8 characters.');
      return;
    }
    if (a !== b) {
      props.onError('Passwords do not match.');
      return;
    }
    props.setBusy(true);
    try {
      await api.post('/auth/password/create', { new_password: a });
      setA('');
      setB('');
      await props.onSuccess();
    } catch (err) {
      props.onError(extractApiError(err).message);
    } finally {
      props.setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ maxWidth: '400px' }}>
      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '12px' }}>
        CREATE PASSWORD
      </div>
      <label style={labelStyle}>New password</label>
      <input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }} />
      <label style={labelStyle}>Confirm</label>
      <input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '14px' }} />
      <button type="submit" disabled={props.busy} style={primaryBtn}>Save password</button>
    </form>
  );
}

function ChangePasswordForm(props: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    props.onError('');
    if (next.length < 8) {
      props.onError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      props.onError('New passwords do not match.');
      return;
    }
    props.setBusy(true);
    try {
      await api.patch('/auth/password', { current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      props.onSuccess();
    } catch (err) {
      props.onError(extractApiError(err).message);
    } finally {
      props.setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ maxWidth: '400px' }}>
      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '12px' }}>
        CHANGE PASSWORD
      </div>
      <p style={{ color: T.textDim, fontSize: '15px', marginTop: 0 }}>You will be signed out on all devices after changing your password.</p>
      <label style={labelStyle}>Current password</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }} />
      <label style={labelStyle}>New password</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }} />
      <label style={labelStyle}>Confirm new password</label>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" style={{ ...inputLike, width: '100%', boxSizing: 'border-box', marginBottom: '14px' }} />
      <button type="submit" disabled={props.busy} style={primaryBtn}>Update password</button>
    </form>
  );
}

const sectionBox: CSSProperties = {
  background: T.surface,
  border:     `1px solid ${T.border}`,
  borderTop:  `2px solid ${T.goldDim}`,
  borderRadius: '4px',
  padding:    '24px 26px',
};

const sectionTitle: CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: '14px',
  letterSpacing: '0.2em',
  color: T.gold,
  margin: '0 0 16px',
};

const labelStyle: CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: '12px',
  letterSpacing: '0.14em',
  color: T.textMuted,
  display: 'block',
  marginBottom: '6px',
};

const inputLike: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: '3px',
  padding: '10px 14px',
  fontSize: '17px',
  fontFamily: "'EB Garamond', serif",
  outline: 'none',
};

const primaryBtn: CSSProperties = {
  background: T.gold,
  border: 'none',
  color: '#06070c',
  fontFamily: "'Cinzel', serif",
  fontSize: '13px',
  letterSpacing: '0.14em',
  padding: '10px 18px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontWeight: 700,
};

const secondaryBtn: CSSProperties = {
  background: 'transparent',
  border: `1px solid ${T.border}`,
  color: T.textMuted,
  fontFamily: "'Cinzel', serif",
  fontSize: '12px',
  letterSpacing: '0.1em',
  padding: '8px 14px',
  borderRadius: '3px',
  cursor: 'pointer',
};

const bannerBase: CSSProperties = {
  border: '1px solid',
  borderRadius: '4px',
  padding: '14px 18px',
  fontSize: '17px',
};
