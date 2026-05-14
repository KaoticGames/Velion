import { Router, Request, Response } from 'express';
import { eq }                        from 'drizzle-orm';
import { db }                        from '../db';
import { users, subscriptions, stripeEvents } from '../db/schema';
import { requireAuth }               from '../middleware/auth';
import { stripe, createSetupIntentForCustomer, createSubscriptionForElementsPayment, constructWebhookEvent, tierFromPriceId, isAllowedCheckoutPriceId, PRICE_IDS, setSubscriptionCancelAtPeriodEnd, updateSubscriptionPrice } from '../lib/stripe';

const router = Router();

async function ensureStripeCustomerId(userId: string): Promise<{ customerId: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error('User not found');
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create({ email: user.email, name: user.display_name });
    customerId = customer.id;
    await db.update(users).set({ stripe_customer_id: customerId }).where(eq(users.id, userId));
  }
  return { customerId };
}

// ── GET /billing/prices (public — Stripe price IDs are not secret) ─────────
router.get('/prices', (_req: Request, res: Response): void => {
  res.json({
    prices: {
      player_month: PRICE_IDS.playerMonth || null,
      player_year:  PRICE_IDS.playerYear || null,
      dm_month:     PRICE_IDS.dmMonth || null,
      dm_year:      PRICE_IDS.dmYear || null,
    },
  });
});

// ── POST /billing/elements-subscription (Payment Element client secret) ───
router.post('/elements-subscription', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { price_id } = req.body as { price_id: string };
  const userId = req.user!.user_id;

  if (!price_id || typeof price_id !== 'string' || !isAllowedCheckoutPriceId(price_id)) {
    res.status(400).json({
      error: {
        code:    'INVALID_PRICE_ID',
        message: 'Unknown or disallowed subscription price.',
        status:  400,
      },
    });
    return;
  }

  const { customerId } = await ensureStripeCustomerId(userId);

  try {
    const { clientSecret, subscriptionId } = await createSubscriptionForElementsPayment(customerId, price_id);
    res.json({ client_secret: clientSecret, subscription_id: subscriptionId });
  } catch (err) {
    console.error('[billing] elements-subscription failed:', err);
    res.status(502).json({
      error: {
        code:    'STRIPE_SUBSCRIPTION_ERROR',
        message: 'Unable to start subscription checkout. Please try again or contact support.',
        status:  502,
      },
    });
  }
});

// ── POST /billing/setup-intent (add / update card via Elements) ───────────
router.post('/setup-intent', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  try {
    const { customerId } = await ensureStripeCustomerId(userId);
    const { clientSecret } = await createSetupIntentForCustomer(customerId);
    res.json({ client_secret: clientSecret });
  } catch (err) {
    console.error('[billing] setup-intent failed:', err);
    res.status(502).json({
      error: {
        code:    'STRIPE_SETUP_ERROR',
        message: 'Could not start card setup. Please try again.',
        status:  502,
      },
    });
  }
});

// ── POST /billing/payment-methods/default ───────────────────────────────────
router.post('/payment-methods/default', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { payment_method_id } = req.body as { payment_method_id?: string };
  const userId = req.user!.user_id;
  if (!payment_method_id || typeof payment_method_id !== 'string') {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: 'payment_method_id is required.', status: 400 } });
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.stripe_customer_id) {
    res.status(400).json({ error: { code: 'NO_STRIPE_CUSTOMER', message: 'No billing account found.', status: 400 } });
    return;
  }
  try {
    const pm = await stripe().paymentMethods.retrieve(payment_method_id);
    if (pm.customer !== user.stripe_customer_id) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'That payment method does not belong to your account.', status: 403 } });
      return;
    }
    await stripe().customers.update(user.stripe_customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });
    const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).limit(1);
    const ended = new Set(['canceled', 'unpaid', 'incomplete_expired']);
    if (subRow && !ended.has(subRow.status)) {
      try {
        await stripe().subscriptions.update(subRow.stripe_subscription_id, {
          default_payment_method: payment_method_id,
        });
      } catch (e) {
        console.error('[billing] subscription default PM update:', e);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[billing] payment-methods/default failed:', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Could not set default payment method.', status: 502 } });
  }
});

// ── POST /billing/payment-methods/detach ───────────────────────────────────
router.post('/payment-methods/detach', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { payment_method_id } = req.body as { payment_method_id?: string };
  const userId = req.user!.user_id;
  if (!payment_method_id || typeof payment_method_id !== 'string') {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: 'payment_method_id is required.', status: 400 } });
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.stripe_customer_id) {
    res.status(400).json({ error: { code: 'NO_STRIPE_CUSTOMER', message: 'No billing account found.', status: 400 } });
    return;
  }
  try {
    const pm = await stripe().paymentMethods.retrieve(payment_method_id);
    if (pm.customer !== user.stripe_customer_id) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'That payment method does not belong to your account.', status: 403 } });
      return;
    }
    await stripe().paymentMethods.detach(payment_method_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[billing] payment-methods/detach failed:', err);
    const msg = err instanceof Error ? err.message : 'Could not remove card.';
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: msg, status: 502 } });
  }
});

// ── POST /billing/subscription/change-price ────────────────────────────────
router.post('/subscription/change-price', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { price_id } = req.body as { price_id?: string };
  const userId = req.user!.user_id;
  if (!price_id || typeof price_id !== 'string' || !isAllowedCheckoutPriceId(price_id)) {
    res.status(400).json({
      error: { code: 'INVALID_PRICE_ID', message: 'Unknown or disallowed subscription price.', status: 400 },
    });
    return;
  }
  const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).limit(1);
  if (!subRow) {
    res.status(400).json({ error: { code: 'NO_SUBSCRIPTION', message: 'No subscription found for this account.', status: 400 } });
    return;
  }
  const ended = new Set(['canceled', 'unpaid', 'incomplete_expired']);
  if (ended.has(subRow.status)) {
    res.status(400).json({ error: { code: 'SUBSCRIPTION_ENDED', message: 'This subscription has already ended.', status: 400 } });
    return;
  }
  const manageable = new Set(['active', 'trialing', 'past_due']);
  if (!manageable.has(subRow.status)) {
    res.status(400).json({
      error: { code: 'SUBSCRIPTION_NOT_READY', message: 'Finish setting up payment before changing plans.', status: 400 },
    });
    return;
  }
  if (subRow.stripe_price_id === price_id) {
    res.json({ ok: true, unchanged: true });
    return;
  }
  try {
    const updated = await updateSubscriptionPrice(subRow.stripe_subscription_id, price_id);
    const item0     = updated.items.data[0];
    const newPriceId =
      typeof item0?.price === 'string'
        ? item0.price
        : (item0?.price as { id?: string } | undefined)?.id ?? price_id;
    const tier = tierFromPriceId(newPriceId);
    const periodEnd = updated.current_period_end;
    await db.update(users).set({ subscription_tier: tier }).where(eq(users.id, userId));
    await db.update(subscriptions).set({
      stripe_price_id:    newPriceId,
      status:             updated.status,
      current_period_end: typeof periodEnd === 'number' ? new Date(periodEnd * 1000) : subRow.current_period_end,
      updated_at:         new Date(),
    }).where(eq(subscriptions.user_id, userId));
    res.json({
      ok:                 true,
      status:             updated.status,
      stripe_price_id:    newPriceId,
      current_period_end: typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : subRow.current_period_end.toISOString(),
    });
  } catch (err) {
    console.error('[billing] subscription/change-price failed:', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Could not update subscription plan.', status: 502 } });
  }
});

// ── GET /billing/invoices ─────────────────────────────────────────────────
router.get('/invoices', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.user_id)).limit(1);
  if (!user.stripe_customer_id) {
    res.json({ invoices: [] });
    return;
  }
  try {
    const list = await stripe().invoices.list({
      customer: user.stripe_customer_id,
      limit:    30,
    });
    res.json({
      invoices: list.data.map((inv) => ({
        id:                   inv.id,
        number:               inv.number,
        status:               inv.status,
        amount_due:           inv.amount_due,
        amount_paid:          inv.amount_paid,
        currency:             inv.currency,
        created:              new Date(inv.created * 1000).toISOString(),
        hosted_invoice_url:   inv.hosted_invoice_url,
        invoice_pdf:          inv.invoice_pdf,
        description:          inv.description,
      })),
    });
  } catch (err) {
    console.error('[billing] invoices list failed:', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Could not load invoices.', status: 502 } });
  }
});

// ── GET /billing/payment-profile (customer + saved cards) ────────────────
router.get('/payment-profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.user_id)).limit(1);
  if (!user.stripe_customer_id) {
    res.json({
      customer_email:           user.email,
      stripe_balance_cents:     0,
      stripe_balance_currency:  null as string | null,
      default_payment_method_id: null as string | null,
      payment_methods:          [] as Array<{
        id: string; brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null; is_default: boolean;
      }>,
    });
    return;
  }
  try {
    const customer = await stripe().customers.retrieve(user.stripe_customer_id, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if (typeof customer === 'string' || customer.deleted) {
      res.status(400).json({ error: { code: 'NO_CUSTOMER', message: 'Stripe customer not found.', status: 400 } });
      return;
    }

    let defaultPmId: string | null = null;
    const dpm = customer.invoice_settings?.default_payment_method;
    if (typeof dpm === 'string') defaultPmId = dpm;
    else if (dpm && typeof dpm === 'object' && 'id' in dpm) defaultPmId = (dpm as { id: string }).id;

    const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, user.id)).limit(1);
    if (!defaultPmId && subRow) {
      try {
        const ss = await stripe().subscriptions.retrieve(subRow.stripe_subscription_id, {
          expand: ['default_payment_method'],
        });
        const spm = ss.default_payment_method;
        if (typeof spm === 'string') defaultPmId = spm;
        else if (spm && typeof spm === 'object' && 'id' in spm) defaultPmId = (spm as { id: string }).id;
      } catch { /* ignore */ }
    }

    const pmList = await stripe().paymentMethods.list({
      customer: user.stripe_customer_id,
      type:     'card',
    });

    res.json({
      customer_email:            customer.email ?? user.email,
      stripe_balance_cents:      customer.balance ?? 0,
      stripe_balance_currency:   customer.currency ?? null,
      default_payment_method_id: defaultPmId,
      payment_methods: pmList.data.map((pm) => ({
        id:         pm.id,
        brand:      pm.card?.brand ?? null,
        last4:      pm.card?.last4 ?? null,
        exp_month:  pm.card?.exp_month ?? null,
        exp_year:   pm.card?.exp_year ?? null,
        is_default: pm.id === defaultPmId,
      })),
    });
  } catch (err) {
    console.error('[billing] payment-profile failed:', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Could not load payment profile.', status: 502 } });
  }
});

// ── GET /billing/subscription ─────────────────────────────────────────────
router.get('/subscription', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.user_id)).limit(1);
  const [sub]  = await db.select().from(subscriptions).where(eq(subscriptions.user_id, user.id)).limit(1);

  let cancel_at_period_end = false;
  if (sub) {
    try {
      const ss = await stripe().subscriptions.retrieve(sub.stripe_subscription_id);
      cancel_at_period_end = Boolean(ss.cancel_at_period_end);
    } catch (err) {
      console.error('[billing] Stripe subscription retrieve failed:', err);
    }
  }

  res.json({
    tier:               user.subscription_tier,
    subscription:       sub
      ? {
          status:               sub.status,
          stripe_price_id:      sub.stripe_price_id,
          current_period_end:   sub.current_period_end.toISOString(),
          cancel_at_period_end,
        }
      : null,
    stripe_customer_id: user.stripe_customer_id,
  });
});

// ── POST /billing/cancel-subscription (end after current period) ───────────
router.post('/cancel-subscription', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).limit(1);
  if (!subRow) {
    res.status(400).json({ error: { code: 'NO_SUBSCRIPTION', message: 'No subscription found for this account.', status: 400 } });
    return;
  }
  const ended = new Set(['canceled', 'unpaid', 'incomplete_expired']);
  if (ended.has(subRow.status)) {
    res.status(400).json({ error: { code: 'SUBSCRIPTION_ENDED', message: 'This subscription has already ended.', status: 400 } });
    return;
  }
  try {
    const updated = await setSubscriptionCancelAtPeriodEnd(subRow.stripe_subscription_id, true);
    res.json({
      cancel_at_period_end: updated.cancel_at_period_end,
      current_period_end:   new Date((updated.current_period_end as number) * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[billing] cancel-subscription failed:', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Unable to update subscription with Stripe.', status: 502 } });
  }
});

// ── POST /billing/resume-subscription (undo scheduled cancellation) ─────
router.post('/resume-subscription', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).limit(1);
  if (!subRow) {
    res.status(400).json({ error: { code: 'NO_SUBSCRIPTION', message: 'No subscription found for this account.', status: 400 } });
    return;
  }
  try {
    const updated = await setSubscriptionCancelAtPeriodEnd(subRow.stripe_subscription_id, false);
    res.json({
      cancel_at_period_end: updated.cancel_at_period_end,
      current_period_end:   new Date((updated.current_period_end as number) * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[billing] resume-subscription failed:', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Unable to update subscription with Stripe.', status: 502 } });
  }
});

// ── POST /billing/webhook (no auth — Stripe signature instead) ─────────────
router.post('/webhook',
  // Raw body required for Stripe signature verification (set in index.ts)
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'] as string;

    let event;
    try {
      event = constructWebhookEvent(req.body as Buffer, sig);
    } catch (err) {
      console.error('[stripe webhook] Signature verification failed:', err);
      res.status(400).send('Webhook signature invalid.');
      return;
    }

    // Idempotency: skip already-processed events
    const existing = await db.select().from(stripeEvents).where(eq(stripeEvents.stripe_id, event.id)).limit(1);
    if (existing.length > 0) { res.json({ received: true }); return; }

    await db.insert(stripeEvents).values({ stripe_id: event.id, event_type: event.type, payload: event as unknown as Record<string, unknown> });

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as { id: string; customer: string; items: { data: { price: { id: string } }[] }; status: string; current_period_end: number };
        const priceId  = sub.items.data[0]?.price?.id ?? '';
        const tier     = tierFromPriceId(priceId);
        const [user]   = await db.select().from(users).where(eq(users.stripe_customer_id, sub.customer as string)).limit(1);
        if (user) {
          await db.update(users).set({ subscription_tier: tier }).where(eq(users.id, user.id));
          await db.insert(subscriptions).values({
            user_id:                user.id,
            stripe_subscription_id: sub.id,
            stripe_price_id:        priceId,
            status:                 sub.status,
            current_period_end:     new Date(sub.current_period_end * 1000),
          }).onConflictDoUpdate({
            target: subscriptions.user_id,
            set: { stripe_price_id: priceId, status: sub.status, current_period_end: new Date(sub.current_period_end * 1000), updated_at: new Date() },
          });
        }
        break;
      }
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const sub    = event.data.object as { customer: string };
        const [user] = await db.select().from(users).where(eq(users.stripe_customer_id, sub.customer as string)).limit(1);
        if (user) {
          await db.update(users).set({ subscription_tier: 'free' }).where(eq(users.id, user.id));
        }
        break;
      }
    }

    res.json({ received: true });
  }
);

export default router;