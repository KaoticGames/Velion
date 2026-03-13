import { Router, Request, Response } from 'express';
import { eq }                        from 'drizzle-orm';
import { db }                        from '../db';
import { users, subscriptions, stripeEvents } from '../db/schema';
import { requireAuth }               from '../middleware/auth';
import { stripe, createCheckoutSession, createPortalSession, constructWebhookEvent, tierFromPriceId } from '../lib/stripe';

const router = Router();
const FRONTEND = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// ── POST /billing/checkout ────────────────────────────────────────────────
router.post('/checkout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { price_id } = req.body as { price_id: string };
  const userId = req.user!.user_id;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  // Create Stripe customer if they don't have one
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create({ email: user.email, name: user.display_name });
    customerId = customer.id;
    await db.update(users).set({ stripe_customer_id: customerId }).where(eq(users.id, userId));
  }

  const url = await createCheckoutSession(
    customerId,
    price_id,
    `${FRONTEND}/account/subscription?success=true`,
    `${FRONTEND}/account/subscription?canceled=true`,
  );

  res.json({ checkout_url: url });
});

// ── POST /billing/portal ──────────────────────────────────────────────────
router.post('/portal', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.user_id)).limit(1);
  if (!user.stripe_customer_id) {
    res.status(400).json({ error: { code: 'NO_STRIPE_CUSTOMER', message: 'No billing account found.', status: 400 } });
    return;
  }
  const url = await createPortalSession(user.stripe_customer_id, `${FRONTEND}/account/subscription`);
  res.json({ portal_url: url });
});

// ── GET /billing/subscription ─────────────────────────────────────────────
router.get('/subscription', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.user_id)).limit(1);
  const [sub]  = await db.select().from(subscriptions).where(eq(subscriptions.user_id, user.id)).limit(1);
  res.json({
    tier:               user.subscription_tier,
    subscription:       sub ?? null,
    stripe_customer_id: user.stripe_customer_id,
  });
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