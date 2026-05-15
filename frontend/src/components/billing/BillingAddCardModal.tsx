import { type FormEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { stripeBrowserPromise } from '@/lib/stripeBrowser';
import { velionStripeElementsAppearance } from '@/lib/stripeVelionAppearance';

export const billingStripePromise = stripeBrowserPromise;

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', textDim: '#504538', danger: '#c8503a',
};

function SetupForm({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const stripe   = useStripe();
  const elements = useElements();
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
    const { error } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });
    if (error) {
      setErr(error.message ?? 'Could not save this card.');
      setBusy(false);
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{
        padding: '16px',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: '6px',
        minHeight: '220px',
        width: '100%',
        boxSizing: 'border-box',
      }}>
        <PaymentElement
          options={{
            layout:               'tabs',
            paymentMethodOrder:   ['card'],
            wallets:              { applePay: 'never', googlePay: 'never' },
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          style={{
            fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.1em',
            background: 'transparent', color: T.textMuted, border: `1px solid ${T.border}`,
            padding: '10px 16px', borderRadius: '3px', cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || busy}
          style={{
            fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.14em',
            background: busy ? T.textDim : T.gold, color: '#06070c', border: 'none',
            padding: '10px 20px', borderRadius: '3px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 700,
          }}
        >
          {busy ? 'Saving…' : 'Save card'}
        </button>
      </div>
    </form>
  );
}

type Props = {
  clientSecret: string;
  onClose:      () => void;
  onSuccess:    () => void;
};

export default function BillingAddCardModal({ clientSecret, onClose, onSuccess }: Props) {
  if (!billingStripePromise || typeof document === 'undefined') return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-add-card-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        minHeight: '100dvh',
        zIndex: 26000,
        boxSizing: 'border-box',
        background: 'rgba(6,7,12,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        overflow: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: '480px',
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: '8px',
          padding: '24px 22px 22px',
          boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute', top: '12px', right: '12px',
            width: '36px', height: '36px', borderRadius: '4px',
            border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted,
            cursor: 'pointer', fontSize: '20px', lineHeight: 1,
          }}
        >
          ×
        </button>
        <h2
          id="billing-add-card-title"
          style={{
            fontFamily: "'Cinzel', serif", fontSize: '16px', letterSpacing: '0.14em',
            color: T.gold, margin: '0 0 8px', fontWeight: 600,
          }}
        >
          Add payment method
        </h2>
        <p style={{ color: T.textMuted, fontSize: '16px', lineHeight: 1.55, margin: '0 0 20px' }}>
          Card details are processed securely by Stripe on this page — Velion never stores your full card number.
        </p>
        <Elements
          key={clientSecret}
          stripe={billingStripePromise}
          options={{
            clientSecret,
            loader: 'auto',
            appearance: velionStripeElementsAppearance,
          }}
        >
          <SetupForm onSuccess={onSuccess} onClose={onClose} />
        </Elements>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
