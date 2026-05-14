/** Billing area under Account (uses `section=billing`; legacy `sub=billing` is normalized on the Account page). */
export function pathAccountBilling(extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  p.set('section', 'billing');
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== '') p.set(k, v);
    }
  }
  return `/account?${p.toString()}`;
}

/** Absolute return URL for Stripe (e.g. Payment Element after redirect). */
export function stripeBillingReturnUrl(checkout: 'success' | 'canceled'): string {
  const p = new URLSearchParams();
  p.set('section', 'billing');
  p.set('checkout', checkout);
  return `${window.location.origin}/account?${p.toString()}`;
}
