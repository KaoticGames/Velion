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
    // Pin to Dashboard / webhook version. Installed `stripe` types may not list this literal yet.
    _stripe = new Stripe(key, {
      apiVersion: '2026-03-25.dahlia' as unknown as Stripe.StripeConfig['apiVersion'],
    });
  }
  return _stripe;
};

const envPrice = (name: string): string => (process.env[name] ?? '').trim();

/** Stripe price IDs for Checkout / webhook tier mapping (player vs DM × month vs year). */
export const PRICE_IDS = {
  get playerMonth() { return envPrice('STRIPE_PLAYER_PRICE_ID_MONTH'); },
  get playerYear()  { return envPrice('STRIPE_PLAYER_PRICE_ID_YEAR'); },
  get dmMonth()     { return envPrice('STRIPE_DM_PRICE_ID_MONTH'); },
  get dmYear()      { return envPrice('STRIPE_DM_PRICE_ID_YEAR'); },
};

export const allowedCheckoutPriceIds = (): string[] =>
  [PRICE_IDS.playerMonth, PRICE_IDS.playerYear, PRICE_IDS.dmMonth, PRICE_IDS.dmYear].filter(Boolean);

export const isAllowedCheckoutPriceId = (priceId: string): boolean =>
  priceId.length > 0 && allowedCheckoutPriceIds().includes(priceId);

export const tierFromPriceId = (priceId: string): 'player' | 'dm' | 'free' => {
  if (!priceId) return 'free';
  if (priceId === PRICE_IDS.playerMonth || priceId === PRICE_IDS.playerYear) return 'player';
  if (priceId === PRICE_IDS.dmMonth || priceId === PRICE_IDS.dmYear) return 'dm';
  return 'free';
};

/**
 * Creates an incomplete subscription so the client can collect payment with Stripe Elements
 * (Payment Element + confirmPayment). Webhooks finalize tier when the subscription becomes active.
 */
export const createSubscriptionForElementsPayment = async (
  customerId: string,
  priceId: string,
): Promise<{ clientSecret: string; subscriptionId: string }> => {
  const subscription = await getStripe().subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior:         'default_incomplete',
    payment_settings:         { save_default_payment_method: 'on_subscription' },
    // Newer Stripe API: invoice → PaymentIntent is exposed via confirmation_secret (payment_intent on invoice is often null).
    expand:                   ['latest_invoice.confirmation_secret'],
  });

  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === 'string') {
    throw new Error('Could not load subscription invoice from Stripe.');
  }

  /** Basil+ API: client secret lives on invoice confirmation_secret (types may lag Stripe API). */
  type InvoiceWithSecret = Stripe.Invoice & {
    confirmation_secret?: { client_secret?: string | null } | null;
  };
  const inv  = invoice as InvoiceWithSecret;
  const conf = inv.confirmation_secret;
  if (conf && typeof conf === 'object' && conf.client_secret) {
    return { clientSecret: conf.client_secret, subscriptionId: subscription.id };
  }

  const piRaw = invoice.payment_intent;
  const pi    = typeof piRaw === 'string'
    ? await getStripe().paymentIntents.retrieve(piRaw)
    : piRaw;

  if (!pi?.client_secret) {
    throw new Error(
      'No payment client secret on subscription invoice. Expand confirmation_secret on the invoice or check the price / customer.',
    );
  }

  return { clientSecret: pi.client_secret, subscriptionId: subscription.id };
};

export const setSubscriptionCancelAtPeriodEnd = async (
  subscriptionId:     string,
  cancelAtPeriodEnd: boolean,
): Promise<Stripe.Subscription> =>
  getStripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancelAtPeriodEnd });

export const createSetupIntentForCustomer = async (customerId: string): Promise<{ clientSecret: string }> => {
  const si = await getStripe().setupIntents.create({
    customer:             customerId,
    payment_method_types: ['card'],
    usage:                'off_session',
  });
  if (!si.client_secret) throw new Error('Stripe did not return a setup intent client secret.');
  return { clientSecret: si.client_secret };
};

/**
 * Single-use secret for Elements so the Payment Element can **list** saved payment methods for this customer.
 * Without this, checkout only shows “add new card” even when the same `customer` is on the PaymentIntent.
 */
export const createCustomerSessionForPaymentElement = async (
  customerId: string,
): Promise<{ clientSecret: string }> => {
  const session = await getStripe().customerSessions.create({
    customer: customerId,
    components: {
      payment_element: {
        enabled: true,
        features: {
          payment_method_redisplay:             'enabled',
          payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
        },
      },
    },
  });
  if (!session.client_secret) {
    throw new Error('Stripe did not return a customer session client secret.');
  }
  return { clientSecret: session.client_secret };
};

/** Swap the subscription’s single item to a new catalog price (prorates). */
export const updateSubscriptionPrice = async (
  subscriptionId: string,
  newPriceId:       string,
): Promise<Stripe.Subscription> => {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error('Subscription has no line items.');
  return getStripe().subscriptions.update(subscriptionId, {
    items:              [{ id: itemId, price: newPriceId }],
    proration_behavior: 'create_prorations',
  });
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
