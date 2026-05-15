import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', textDim: '#504538', danger: '#c8503a',
};

type BillingPaymentMethodRow = {
  id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  paymentMethods: BillingPaymentMethodRow[];
  busy: boolean;
  defaultingPm: string | null;
  detachingPm: string | null;
  stripeReady: boolean;
  onAddCard: () => void;
  onSetDefault: (paymentMethodId: string) => void;
  onDetach: (paymentMethodId: string) => void;
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

export default function BillingPaymentMethodsModal({
  open,
  onClose,
  paymentMethods,
  busy,
  defaultingPm,
  detachingPm,
  stripeReady,
  onAddCard,
  onSetDefault,
  onDetach,
}: Props) {
  if (!open || typeof document === 'undefined') return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-payment-methods-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        minHeight: '100dvh',
        zIndex: 25990,
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
          width: '100%', maxWidth: '640px', maxHeight: 'min(90vh, 720px)',
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: '8px',
          padding: '24px 22px 22px',
          boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
          position: 'relative',
          overflow: 'auto',
          boxSizing: 'border-box',
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
          id="billing-payment-methods-title"
          style={{
            fontFamily: "'Cinzel', serif", fontSize: '16px', letterSpacing: '0.14em',
            color: T.gold, margin: '0 44px 8px 0', fontWeight: 600, paddingRight: '40px',
          }}
        >
          Change payment method
        </h2>
        <p style={{ color: T.textMuted, fontSize: '16px', lineHeight: 1.55, margin: '0 0 18px' }}>
          Choose which card is charged by default for renewals, or remove cards you no longer use. Add a new card with the button below — details are handled securely by Stripe.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '18px' }}>
          <button
            type="button"
            disabled={busy || !stripeReady}
            onClick={() => void onAddCard()}
            style={primaryBtn}
          >
            Add new card
          </button>
          {!stripeReady && (
            <span style={{ color: T.textDim, fontSize: '15px' }}>Publishable key missing — card form unavailable.</span>
          )}
        </div>

        {paymentMethods.length === 0 ? (
          <p style={{ color: T.textMuted, margin: '0 0 12px', fontSize: '17px' }}>
            No cards on file yet. Add one above, or save a card when you subscribe.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
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
                {paymentMethods.map((pm) => (
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
                            onClick={() => void onSetDefault(pm.id)}
                            style={{ ...secondaryBtn, padding: '6px 10px', fontSize: '11px' }}
                          >
                            {defaultingPm === pm.id ? '…' : 'Set default'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(defaultingPm) || Boolean(detachingPm)}
                          onClick={() => void onDetach(pm.id)}
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
          </div>
        )}

        <p style={{ color: T.textDim, fontSize: '15px', marginTop: '14px', fontStyle: 'italic', marginBottom: 0 }}>
          Default is used for subscription renewals. Removing a card cannot undo pending invoices — check invoice history if a charge is due.
        </p>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
