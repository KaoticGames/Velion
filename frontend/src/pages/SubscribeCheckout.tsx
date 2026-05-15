import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import api, { extractApiError } from '@/lib/api';
import { stripeBillingReturnUrl, pathAccountBilling } from '@/lib/accountUrls';
import { stripeBrowserPromise } from '@/lib/stripeBrowser';
import { velionStripeElementsAppearance } from '@/lib/stripeVelionAppearance';
import { useAuthStore } from '@/store/authStore';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', textDim: '#504538', danger: '#c8503a', rp: '#4a9de8',
};

function SubscribePaymentForm() {
  const stripe   = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const userEmail = useAuthStore((s) => s.user?.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setErr('');
    const { error: submitErr } = await elements.submit();
    if (submitErr) {
      setErr(submitErr.message ?? 'Check your payment details.');
      setBusy(false);
      return;
    }
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: stripeBillingReturnUrl('success'),
      },
    });
    if (error) {
      if (error.type === 'card_error' || error.type === 'validation_error') {
        setErr(error.message ?? 'Payment failed.');
      } else {
        setErr('Payment could not be completed. You can try again or use a different method.');
      }
      setBusy(false);
      return;
    }
    navigate(pathAccountBilling({ checkout: 'success' }), { replace: true });
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{
        padding: '16px',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: '6px',
        minHeight: '280px',
        width:     '100%',
        boxSizing: 'border-box',
      }}>
        <PaymentElement
          options={{
            layout:             'tabs',
            paymentMethodOrder: ['card'],
            wallets:            { applePay: 'never', googlePay: 'never' },
            fields: {
              billingDetails: {
                name:    'auto',
                email:   userEmail ? 'never' : 'auto',
                phone:   'never',
                address: 'auto',
              },
            },
          }}
        />
      </div>
      {err && (
        <div style={{
          color: T.danger, fontSize: '16px', padding: '12px 14px',
          background: '#1a0604', border: `1px solid ${T.danger}44`, borderRadius: '4px',
        }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <button
          type="submit"
          disabled={!stripe || busy}
          style={{
            fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.14em',
            background: busy ? T.textDim : T.gold, color: '#06070c', border: 'none',
            padding: '12px 22px', borderRadius: '3px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 700,
          }}
        >
          {busy ? 'Processing…' : 'Pay and subscribe'}
        </button>
        <Link to="/pricing" style={{ color: T.rp, fontSize: '17px', textDecoration: 'none' }}>
          ← Back to pricing
        </Link>
      </div>
    </form>
  );
}

export default function SubscribeCheckout() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const user            = useAuthStore((s) => s.user);
  const isReady         = useAuthStore((s) => s.isReady);
  const accessToken     = useAuthStore((s) => s.accessToken);
  const priceId        = searchParams.get('price_id')?.trim() ?? '';
  const mockAuth        = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  /** From Customer Session — required for Payment Element to list saved cards for this Stripe customer. */
  const [customerSessionClientSecret, setCustomerSessionClientSecret] = useState<string | null>(null);
  const [bootErr, setBootErr]           = useState('');
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (!priceId) {
      setBootErr('No plan was selected.');
      setLoading(false);
      const t = setTimeout(() => navigate('/pricing', { replace: true }), 1800);
      return () => clearTimeout(t);
    }
    if (!stripeBrowserPromise) {
      setBootErr('Stripe is not configured for this app build (missing publishable key).');
      setLoading(false);
      return;
    }

    if (!mockAuth) {
      if (!isReady) return;
      if (!accessToken) {
        setBootErr('Your session is not available. Sign in again, then return to checkout.');
        setLoading(false);
        return;
      }
    }

    const ac = new AbortController();
    setLoading(true);
    setBootErr('');
    setClientSecret(null);
    setCustomerSessionClientSecret(null);

    void (async () => {
      try {
        const { data } = await api.post<{
          client_secret: string;
          customer_session_client_secret?: string | null;
        }>(
          '/billing/elements-subscription',
          { price_id: priceId },
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        if (!data.client_secret) setBootErr('Could not start checkout.');
        else {
          setClientSecret(data.client_secret);
          setCustomerSessionClientSecret(
            typeof data.customer_session_client_secret === 'string' && data.customer_session_client_secret
              ? data.customer_session_client_secret
              : null,
          );
        }
      } catch (e) {
        if (axios.isAxiosError(e) && e.code === 'ERR_CANCELED') return;
        if (!ac.signal.aborted) setBootErr(extractApiError(e).message);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [priceId, navigate, isReady, accessToken, mockAuth]);

  return (
    <div className="page-enter-opacity" style={{
      background: T.bg, color: T.text, minHeight: 'calc(100vh - 75px)',
      fontFamily: "'EB Garamond', serif", padding: '40px 24px 64px',
    }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.35em', color: T.textDim, marginBottom: '10px' }}>
          CHECKOUT
        </div>
        <h1 style={{
          fontFamily: "'Cinzel', serif", fontSize: 'clamp(22px, 3vw, 28px)',
          color: T.gold, letterSpacing: '0.1em', fontWeight: 600, margin: '0 0 12px',
        }}>
          Complete subscription
        </h1>
        {user && (
          <div style={{
            marginBottom: '22px', padding: '14px 16px',
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: '6px',
            fontSize: '17px', color: T.textMuted, lineHeight: 1.55,
          }}>
            <span>Signed in as </span>
            <strong style={{ color: T.text }}>{user.email}</strong>
            <span> — current tier </span>
            <strong style={{ color: user.subscription_tier === 'dm' ? T.gold : T.text }}>
              {user.subscription_tier === 'dm' ? 'DM' : user.subscription_tier === 'player' ? 'Player' : 'Free'}
            </strong>
            .{' '}
            <Link to={pathAccountBilling()} style={{ color: T.rp, textDecoration: 'none', borderBottom: `1px solid ${T.rp}44` }}>
              Billing & invoices
            </Link>
          </div>
        )}
        <p style={{ color: T.textMuted, fontSize: '17px', lineHeight: 1.65, margin: '0 0 28px' }}>
          Use a card you already saved on Velion, or add a new one. After a successful charge you will return to Account → Billing, where you can manage your plan, cards, and invoice history.
        </p>

        {loading && (
          <p style={{ color: T.textMuted, fontStyle: 'italic' }}>Preparing secure checkout…</p>
        )}
        {!loading && bootErr && (
          <div style={{ color: T.danger, marginBottom: '16px' }}>{bootErr}</div>
        )}
        {/* Mount Elements under document.body so Stripe iframes are not inside Layout <main> (scroll/stacking)
            or other ancestors that break iframe focus / sizing in some browsers. */}
        {!loading && clientSecret && stripeBrowserPromise && typeof document !== 'undefined' && createPortal(
          <div
            style={{
              position:       'fixed',
              top:            '75px',
              left:           0,
              right:          0,
              bottom:         0,
              zIndex:         26000,
              overflowY:      'auto',
              WebkitOverflowScrolling: 'touch',
              background:     T.bg,
              padding:        '28px 24px 48px',
              boxSizing:      'border-box',
            }}
          >
            <div style={{ maxWidth: '560px', margin: '0 auto' }}>
              <Elements
                key={`${clientSecret}:${customerSessionClientSecret ?? ''}`}
                stripe={stripeBrowserPromise}
                options={{
                  clientSecret,
                  ...(customerSessionClientSecret
                    ? { customerSessionClientSecret: customerSessionClientSecret }
                    : {}),
                  loader:     'auto',
                  appearance: velionStripeElementsAppearance,
                  ...(user?.email
                    ? { defaultValues: { billingDetails: { email: user.email } } }
                    : {}),
                }}
              >
                <SubscribePaymentForm />
              </Elements>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
