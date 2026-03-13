import Stripe from 'stripe';

// Lazy singleton — only instantiated when a billing route is actually called.
// Prevents crash on startup when STRIPE_SECRET_KEY is not yet configured.
let _stripe: Stripe | null = null;

const getStripe = (): Stripe => {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key.includes('REPLACE')) {
      throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in .env.development to use billing features.');
    }
    _stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  }
  return _stripe;
};

export const PRICE_IDS = {
  get player() { return process.env.STRIPE_PLAYER_PRICE_ID ?? ''; },
  get dm()     { return process.env.STRIPE_DM_PRICE_ID ?? ''; },
};

export const tierFromPriceId = (priceId: string): 'player' | 'dm' | 'free' => {
  if (priceId === PRICE_IDS.player) return 'player';
  if (priceId === PRICE_IDS.dm)     return 'dm';
  return 'free';
};

export const createCheckoutSession = async (
  customerId: string,
  priceId:    string,
  successUrl: string,
  cancelUrl:  string,
): Promise<string> => {
  const session = await getStripe().checkout.sessions.create({
    customer:    customerId,
    mode:        'subscription',
    line_items:  [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });
  return session.url!;
};

export const createPortalSession = async (
  customerId: string,
  returnUrl:  string,
): Promise<string> => {
  const session = await getStripe().billingPortal.sessions.create({
    customer:   customerId,
    return_url: returnUrl,
  });
  return session.url;
};

export const constructWebhookEvent = (
  payload:   Buffer,
  signature: string,
): Stripe.Event =>
  getStripe().webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );

// For direct use in billing route (customer creation etc.)
export { getStripe as stripe };