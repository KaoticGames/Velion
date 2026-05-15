import type { Appearance } from '@stripe/stripe-js';

/** Shared Elements skin for Velion checkout and billing (avoid invalid nested font strings). */
export const velionStripeElementsAppearance: Appearance = {
  /** `night` is Stripe’s dark preset; pairs reliably with Payment Element iframes. */
  theme: 'night',
  variables: {
    colorPrimary:    '#c4922a',
    colorBackground: '#0d1018',
    colorText:       '#e4d8c0',
    colorDanger:     '#c8503a',
    fontFamily:      'ui-sans-serif, system-ui, sans-serif',
    borderRadius:    '6px',
  },
};
