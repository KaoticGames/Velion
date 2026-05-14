import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { extractApiError } from '@/lib/api';
import { displayPlanPriceLabel, paidPlanStripePriceId, type PaidSubscribeTier } from '@/lib/billingPlanDisplay';
import BillingAddCardModal, { billingStripePromise } from '@/components/billing/BillingAddCardModal';
import { useBillingPriceCatalog } from '@/hooks/useBillingPriceCatalog';
import { useAuthStore, type AuthUser } from '@/store/authStore';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', text: '#e4d8c0', textMuted: '#706858', textDim: '#504538',
  danger: '#c8503a', ok: '#5a9e6f', rp: '#4a9de8',
};

type BillingPayload = {
  tier:               string;
  stripe_customer_id: string | null;
  subscription:       {
    status:                 string;
    stripe_price_id:        string;
    current_period_end:     string;
    cancel_at_period_end?: boolean;
  } | null;
};

type InvoiceRow = {
  id:                 string;
  number:             string | null;
  status:             string | null;
  amount_due:         number;
  amount_paid:        number;
  currency:           string;
  created:            string;
  hosted_invoice_url: string | null;
  invoice_pdf:        string | null;
  description:        string | null;
};

type PaymentProfile = {
  customer_email:             string;
  stripe_balance_cents:       number;
  stripe_balance_currency:    string | null;
  default_payment_method_id:  string | null;
  payment_methods: Array<{
    id: string;
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
    is_default: boolean;
  }>;
};

function capTier(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function formatMoney(cents: number, currency: string): string {
  if (cents === 0) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const sectionBox: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: '6px',
  padding: '22px 20px',
  marginBottom: '20px',
};

const sectionTitle: CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: '15px',
  letterSpacing: '0.18em',
  color: T.gold,
  margin: '0 0 14px',
  fontWeight: 600,
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

const dangerOutlineBtn: CSSProperties = {
  ...secondaryBtn,
  color: T.danger,
  border: `1px solid ${T.danger}`,
};

export default function Billing({ embedded = false }: { embedded?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate   = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore.setState;
  const refreshSession = useAuthStore((s) => s.refreshSession);

  const [billing, setBilling]     = useState<BillingPayload | null>(null);
  const [invoices, setInvoices]     = useState<InvoiceRow[]>([]);
  const [profile, setProfile]       = useState<PaymentProfile | null>(null);
  const [loadErr, setLoadErr]       = useState('');
  const [busy, setBusy]             = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [defaultingPm, setDefaultingPm]           = useState<string | null>(null);
  const [detachingPm, setDetachingPm]             = useState<string | null>(null);
  const [planSelectPriceId, setPlanSelectPriceId] = useState<string>('');
  const [planBusy, setPlanBusy]                   = useState(false);
  const [subscribePaidTier, setSubscribePaidTier] = useState<PaidSubscribeTier>('player');
  const [subscribeAnnual, setSubscribeAnnual]     = useState(false);

  const { merged: priceCatalog, complete: catalogComplete, ready: catalogReady, loadError: catalogErr } =
    useBillingPriceCatalog();

  const checkoutOk = searchParams.get('checkout') === 'success';

  const dismissCheckout = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
  };

  const reload = useCallback(async () => {
    setLoadErr('');
    try {
      const [subRes, invRes, profRes] = await Promise.all([
        api.get<BillingPayload>('/billing/subscription'),
        api.get<{ invoices: InvoiceRow[] }>('/billing/invoices'),
        api.get<PaymentProfile>('/billing/payment-profile'),
      ]);
      setBilling(subRes.data);
      setInvoices(invRes.data.invoices ?? []);
      setProfile(profRes.data);
      const u = useAuthStore.getState().user;
      if (u && subRes.data.tier !== u.subscription_tier) {
        setAuth({ user: { ...u, subscription_tier: subRes.data.tier as AuthUser['subscription_tier'] } });
      }
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    }
  }, [setAuth]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const cur = billing?.subscription?.stripe_price_id;
    if (cur) setPlanSelectPriceId(cur);
  }, [billing?.subscription?.stripe_price_id]);

  const tier = (billing?.tier ?? user?.subscription_tier ?? 'free') as AuthUser['subscription_tier'];

  const subActiveStates = new Set(['active', 'trialing', 'past_due']);
  const canManageStripeSubscription = Boolean(
    billing?.subscription && subActiveStates.has(billing.subscription.status),
  );
  const cancelScheduled = Boolean(billing?.subscription?.cancel_at_period_end);
  const showResumeButton  = canManageStripeSubscription && cancelScheduled;
  const showCancelFlow    = canManageStripeSubscription && !cancelScheduled;

  const refreshAfterMutation = async () => {
    await reload();
    await refreshSession();
  };

  const startAddCard = async () => {
    if (!billingStripePromise) {
      setLoadErr('Stripe publishable key is not configured for this build.');
      return;
    }
    setBusy(true);
    setLoadErr('');
    try {
      const { data } = await api.post<{ client_secret: string }>('/billing/setup-intent');
      if (!data.client_secret) {
        setLoadErr('Could not start card setup.');
        return;
      }
      setSetupClientSecret(data.client_secret);
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const setDefaultPm = async (paymentMethodId: string) => {
    setDefaultingPm(paymentMethodId);
    setLoadErr('');
    try {
      await api.post('/billing/payment-methods/default', { payment_method_id: paymentMethodId });
      await refreshAfterMutation();
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    } finally {
      setDefaultingPm(null);
    }
  };

  const detachPm = async (paymentMethodId: string) => {
    if (!window.confirm('Remove this card from your account?')) return;
    setDetachingPm(paymentMethodId);
    setLoadErr('');
    try {
      await api.post('/billing/payment-methods/detach', { payment_method_id: paymentMethodId });
      await refreshAfterMutation();
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    } finally {
      setDetachingPm(null);
    }
  };

  const planOptions = [
    priceCatalog.player_monthly && { id: priceCatalog.player_monthly, label: 'Player — monthly' },
    priceCatalog.player_annual && { id: priceCatalog.player_annual, label: 'Player — annual' },
    priceCatalog.dm_monthly && { id: priceCatalog.dm_monthly, label: 'DM — monthly' },
    priceCatalog.dm_annual && { id: priceCatalog.dm_annual, label: 'DM — annual' },
  ].filter(Boolean) as { id: string; label: string }[];

  const selectedSubscribePriceId =
    catalogComplete ? paidPlanStripePriceId(subscribePaidTier, subscribeAnnual, priceCatalog) : null;
  const newCheckoutDisabled =
    busy || !selectedSubscribePriceId || canManageStripeSubscription;

  const changeSubscriptionPrice = async () => {
    if (!planSelectPriceId || !billing?.subscription) return;
    setPlanBusy(true);
    setLoadErr('');
    try {
      await api.post('/billing/subscription/change-price', { price_id: planSelectPriceId });
      await refreshAfterMutation();
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    } finally {
      setPlanBusy(false);
    }
  };

  const scheduleCancel = async () => {
    setBusy(true);
    setLoadErr('');
    try {
      await api.post('/billing/cancel-subscription');
      setShowCancelConfirm(false);
      await refreshAfterMutation();
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const resumeSub = async () => {
    setBusy(true);
    setLoadErr('');
    try {
      await api.post('/billing/resume-subscription');
      await refreshAfterMutation();
    } catch (e) {
      setLoadErr(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="page-enter" style={{
      color: T.text,
      fontFamily: "'EB Garamond', serif",
      padding: embedded ? '0 0 48px' : '40px 24px 64px',
      maxWidth: '900px',
      margin: '0 auto',
    }}>
      <header style={{ marginBottom: embedded ? '20px' : '28px' }}>
        {!embedded && (
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.35em', color: T.textDim, marginBottom: '10px' }}>
            MEMBERSHIP
          </div>
        )}
        <h1 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: embedded ? 'clamp(20px, 2.5vw, 26px)' : 'clamp(24px, 3vw, 32px)',
          color: T.gold, letterSpacing: '0.1em', fontWeight: 600, margin: '0 0 10px',
        }}>
          Billing & subscription
        </h1>
        <p style={{ color: T.textMuted, fontSize: embedded ? '17px' : '18px', lineHeight: 1.65, margin: 0, maxWidth: '640px' }}>
          Your plan, saved cards, and invoices — all managed here with Velion styling. Payments still run through Stripe.
        </p>
        <div style={{ marginTop: '14px' }}>
          <Link to="/account" style={{ color: T.rp, fontSize: '17px', textDecoration: 'none' }}>
            {embedded ? '← Account overview' : '← Account settings'}
          </Link>
          {' · '}
          <Link to="/pricing" style={{ color: T.rp, fontSize: '17px', textDecoration: 'none' }}>View plans & upgrade</Link>
        </div>
      </header>

      {checkoutOk && (
        <div style={{
          marginBottom: '20px', padding: '14px 18px',
          border: `1px solid ${T.ok}55`, borderRadius: '4px', color: T.ok, fontSize: '17px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        }}>
          <span>Payment received. Your tier may take a moment to update — refresh if needed.</span>
          <button type="button" onClick={dismissCheckout} style={{ ...secondaryBtn, flexShrink: 0 }}>Dismiss</button>
        </div>
      )}

      {catalogReady && catalogErr && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px',
          border: `1px solid ${T.border}`, borderRadius: '4px', color: T.textMuted, fontSize: '16px',
        }}>
          Could not load plan catalog: {catalogErr}
        </div>
      )}

      {loadErr && (
        <div style={{
          marginBottom: '20px', padding: '14px 18px',
          border: `1px solid ${T.danger}55`, borderRadius: '4px', color: T.danger, fontSize: '17px',
        }}>
          {loadErr}
        </div>
      )}

      {!billing || !profile ? (
        <p style={{ color: T.textMuted }}>Loading…</p>
      ) : (
        <>
          <section style={sectionBox}>
            <h2 style={sectionTitle}>Plan & subscription</h2>
            <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, marginTop: 0 }}>
              Your tier, billing period, plan changes, and cancellation — proration applies when you switch prices on an active subscription. To start a new paid plan from scratch, use checkout below.
            </p>

            <div style={{ marginTop: '20px' }}>
              <div style={{ ...sectionTitle, marginBottom: '10px', fontSize: '12px' }}>CURRENT PLAN</div>
              <p style={{ margin: '0 0 8px', fontSize: '20px', color: T.text }}>
                Tier:{' '}
                <strong style={{ color: tier === 'dm' ? T.gold : T.text }}>{capTier(tier)}</strong>
              </p>
              {billing.subscription ? (
                <ul style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, paddingLeft: '20px', margin: '12px 0 0' }}>
                  <li>Status: {billing.subscription.status}</li>
                  {billing.subscription.cancel_at_period_end && (
                    <li style={{ color: T.goldDim }}>
                      Cancellation scheduled — access continues until the period end date below.
                    </li>
                  )}
                  <li>
                    Current period ends:{' '}
                    {new Date(billing.subscription.current_period_end).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </li>
                </ul>
              ) : (
                <p style={{ color: T.textMuted, fontSize: '17px', margin: '12px 0 0' }}>
                  You are on the free tier. Choose Player or DM and monthly or yearly below, then continue to checkout.
                </p>
              )}
            </div>

            {canManageStripeSubscription && catalogComplete && planOptions.length > 0 && billing.subscription && (
              <div style={{ marginTop: '22px', paddingTop: '22px', borderTop: `1px solid ${T.border}` }}>
                <div style={{ ...sectionTitle, marginBottom: '10px', fontSize: '12px' }}>CHANGE BILLING PLAN</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                  <label htmlFor="billing-plan-select" style={{ color: T.textDim, fontSize: '14px', letterSpacing: '0.06em' }}>
                    Plan
                  </label>
                  <select
                    id="billing-plan-select"
                    value={planSelectPriceId}
                    onChange={(e) => setPlanSelectPriceId(e.target.value)}
                    disabled={planBusy || busy}
                    style={{
                      flex: '1 1 220px', minWidth: '200px', maxWidth: '360px',
                      background: T.surface, color: T.text, border: `1px solid ${T.border}`,
                      borderRadius: '4px', padding: '10px 12px', fontSize: '16px', fontFamily: "'EB Garamond', serif",
                    }}
                  >
                    {planOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={
                      planBusy || busy || !planSelectPriceId || planSelectPriceId === billing.subscription.stripe_price_id
                    }
                    onClick={() => void changeSubscriptionPrice()}
                    style={primaryBtn}
                  >
                    {planBusy ? 'Updating…' : 'Update plan'}
                  </button>
                </div>
              </div>
            )}

            {canManageStripeSubscription && catalogReady && !catalogComplete && (
              <p style={{ color: T.textDim, fontSize: '16px', marginTop: '18px', fontStyle: 'italic' }}>
                Plan changes require all four Stripe prices to be configured on the server. You can still add and manage cards in Payment methods below.
              </p>
            )}

            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${T.border}` }}>
              <div style={{ ...sectionTitle, marginBottom: '10px', fontSize: '12px' }}>NEW SUBSCRIPTION</div>
              <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, marginTop: 0 }}>
                Pick a tier and billing interval. Price updates as you change options. Checkout runs on the next page with Stripe.
              </p>

              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginTop: '16px', marginBottom: '8px' }}>
                TIER
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {(['player', 'dm'] as const).map((t) => {
                  const active = subscribePaidTier === t;
                  const accent = t === 'dm' ? T.gold : T.rp;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSubscribePaidTier(t)}
                      style={{
                        fontFamily: "'Cinzel', serif",
                        fontSize: '13px',
                        letterSpacing: '0.12em',
                        padding: '10px 20px',
                        borderRadius: '4px',
                        border: `1px solid ${active ? accent : T.border}`,
                        background: active ? `${accent}22` : 'transparent',
                        color: active ? accent : T.textMuted,
                        cursor: 'pointer',
                      }}
                    >
                      {t === 'player' ? 'Player' : 'Dungeon Master'}
                    </button>
                  );
                })}
              </div>

              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginTop: '18px', marginBottom: '8px' }}>
                BILLING
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '12px',
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: '4px', padding: '6px 14px',
              }}>
                <span style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.1em', color: subscribeAnnual ? T.textDim : T.text }}>
                  Monthly
                </span>
                <button
                  type="button"
                  aria-pressed={subscribeAnnual}
                  onClick={() => setSubscribeAnnual((a) => !a)}
                  disabled={busy}
                  style={{
                    width: '40px', height: '20px', borderRadius: '10px', border: 'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    background: subscribeAnnual ? T.gold : T.border,
                    position: 'relative', transition: 'background 0.2s ease',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: '2px',
                    left: subscribeAnnual ? '20px' : '2px',
                    width: '16px', height: '16px', borderRadius: '50%',
                    background: T.bg, transition: 'left 0.2s ease',
                    display: 'block',
                  }} />
                </button>
                <span style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.1em', color: subscribeAnnual ? T.text : T.textDim }}>
                  Annual
                </span>
              </div>

              <p style={{
                fontSize: 'clamp(20px, 2.5vw, 26px)',
                color: T.gold,
                margin: '18px 0 4px',
                fontFamily: "'Cinzel', serif",
                letterSpacing: '0.06em',
                fontWeight: 600,
              }}>
                {catalogComplete ? displayPlanPriceLabel(subscribePaidTier, subscribeAnnual) : '—'}
              </p>
              {catalogReady && !catalogComplete && (
                <p style={{ color: T.textDim, fontSize: '15px', fontStyle: 'italic', margin: '0 0 12px' }}>
                  All four Stripe price IDs must be configured on the server before checkout is available.
                </p>
              )}

              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  disabled={newCheckoutDisabled}
                  onClick={() => {
                    if (!selectedSubscribePriceId) return;
                    navigate(`/subscribe?price_id=${encodeURIComponent(selectedSubscribePriceId)}`);
                  }}
                  style={primaryBtn}
                >
                  Continue to checkout
                </button>
              </div>
              {canManageStripeSubscription && (
                <p style={{ color: T.textDim, fontSize: '15px', marginTop: '12px', fontStyle: 'italic', marginBottom: 0 }}>
                  You already have an active subscription. Use Change billing plan above to switch your price — starting checkout again may create a second subscription in Stripe.
                </p>
              )}
            </div>

            <div style={{ marginTop: '22px', paddingTop: '22px', borderTop: `1px solid ${T.border}` }}>
              <div style={{ ...sectionTitle, marginBottom: '10px', fontSize: '12px' }}>CANCEL SUBSCRIPTION</div>
              <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, marginTop: 0 }}>
                Cancelling schedules the end of your paid access at the close of the current billing period (you are not charged again for that plan).
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '14px' }}>
                {showResumeButton && (
                  <button type="button" disabled={busy} onClick={() => void resumeSub()} style={primaryBtn}>
                    Keep subscription
                  </button>
                )}
                {showCancelFlow && !showCancelConfirm && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setShowCancelConfirm(true); setLoadErr(''); }}
                    style={dangerOutlineBtn}
                  >
                    Cancel subscription
                  </button>
                )}
              </div>
              {showCancelFlow && showCancelConfirm && billing.subscription && (
                <div style={{
                  marginTop: '16px', padding: '16px 18px',
                  background: T.surface, border: `1px solid ${T.danger}44`, borderRadius: '4px',
                }}>
                  <p style={{ margin: '0 0 12px', fontSize: '17px', lineHeight: 1.55 }}>
                    End your paid plan after{' '}
                    <strong>{new Date(billing.subscription.current_period_end).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>?
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    <button type="button" disabled={busy} onClick={() => void scheduleCancel()} style={{ ...primaryBtn, background: T.danger, color: T.text }}>
                      Yes, cancel at period end
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setShowCancelConfirm(false); setLoadErr(''); }} style={secondaryBtn}>
                      Never mind
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section style={sectionBox}>
            <h2 style={sectionTitle}>Billing profile</h2>
            <dl style={{ margin: 0, display: 'grid', gap: '10px', fontSize: '17px', color: T.textMuted }}>
              <div><dt style={{ display: 'inline', color: T.textDim }}>Receipt email</dt>{' '}
                <dd style={{ display: 'inline', margin: 0, color: T.text }}>{profile.customer_email}</dd></div>
              {profile.stripe_balance_cents !== 0 && profile.stripe_balance_currency && (
                <div><dt style={{ display: 'inline', color: T.textDim }}>Account balance</dt>{' '}
                  <dd style={{ display: 'inline', margin: 0, color: T.text }}>
                    {formatMoney(profile.stripe_balance_cents, profile.stripe_balance_currency)}
                  </dd></div>
              )}
            </dl>
          </section>

          <section style={sectionBox}>
            <h2 style={sectionTitle}>Payment methods</h2>
            <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, marginTop: 0 }}>
              Add a card, choose which one is charged by default for renewals, or remove cards you no longer use.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '16px', marginBottom: '18px' }}>
              <button type="button" disabled={busy || !billingStripePromise} onClick={() => void startAddCard()} style={primaryBtn}>
                Add card
              </button>
              {!billingStripePromise && (
                <span style={{ color: T.textDim, fontSize: '15px' }}>Publishable key missing — card form unavailable.</span>
              )}
            </div>
            {profile.payment_methods.length === 0 ? (
              <p style={{ color: T.textMuted, margin: '0 0 8px' }}>No cards on file yet. Add one with the button above, or save a card when you subscribe.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '16px', color: T.textMuted }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}`, textAlign: 'left' }}>
                    <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>CARD</th>
                    <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>EXPIRES</th>
                    <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>DEFAULT</th>
                    <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.payment_methods.map((pm) => (
                    <tr key={pm.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '10px 6px', color: T.text }}>
                        {(pm.brand ?? 'Card').toUpperCase()} ···· {pm.last4 ?? '—'}
                      </td>
                      <td style={{ padding: '10px 6px' }}>
                        {pm.exp_month && pm.exp_year ? `${pm.exp_month}/${pm.exp_year}` : '—'}
                      </td>
                      <td style={{ padding: '10px 6px' }}>{pm.is_default ? 'Yes' : '—'}</td>
                      <td style={{ padding: '10px 6px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {!pm.is_default && (
                            <button
                              type="button"
                              disabled={Boolean(defaultingPm) || Boolean(detachingPm)}
                              onClick={() => void setDefaultPm(pm.id)}
                              style={{ ...secondaryBtn, padding: '6px 10px', fontSize: '11px' }}
                            >
                              {defaultingPm === pm.id ? '…' : 'Set default'}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={Boolean(defaultingPm) || Boolean(detachingPm)}
                            onClick={() => void detachPm(pm.id)}
                            style={{ ...dangerOutlineBtn, padding: '6px 10px', fontSize: '11px' }}
                          >
                            {detachingPm === pm.id ? '…' : 'Remove'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ color: T.textDim, fontSize: '15px', marginTop: '14px', fontStyle: 'italic', marginBottom: 0 }}>
              Default is used for subscription renewals. Removing a card cannot undo pending invoices — check invoice history if a charge is due.
            </p>
          </section>

          <section style={sectionBox}>
            <h2 style={sectionTitle}>Invoice history</h2>
            {invoices.length === 0 ? (
              <p style={{ color: T.textMuted, margin: 0 }}>No invoices yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', color: T.textMuted, minWidth: '520px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}`, textAlign: 'left' }}>
                      <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>DATE</th>
                      <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>INVOICE</th>
                      <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>STATUS</th>
                      <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>AMOUNT</th>
                      <th style={{ padding: '8px 6px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.12em', color: T.textDim }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const when = new Date(inv.created).toLocaleString(undefined, { dateStyle: 'medium' });
                      const total  = inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due;
                      const amount = formatMoney(total, inv.currency);
                      return (
                        <tr key={inv.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: '10px 6px', color: T.text }}>{when}</td>
                          <td style={{ padding: '10px 6px' }}>{inv.number ?? inv.id.slice(0, 12)}</td>
                          <td style={{ padding: '10px 6px' }}>{inv.status ?? '—'}</td>
                          <td style={{ padding: '10px 6px' }}>{amount}</td>
                          <td style={{ padding: '10px 6px' }}>
                            {inv.hosted_invoice_url && (
                              <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" style={{ color: T.rp, marginRight: '10px' }}>View</a>
                            )}
                            {inv.invoice_pdf && (
                              <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer" style={{ color: T.rp }}>PDF</a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {setupClientSecret && (
        <BillingAddCardModal
          clientSecret={setupClientSecret}
          onClose={() => { setSetupClientSecret(null); setLoadErr(''); }}
          onSuccess={async () => {
            setSetupClientSecret(null);
            await refreshAfterMutation();
          }}
        />
      )}
    </div>
  );
}
