import { Router, Request, Response } from 'express';
import { db }                        from '../db';
import { earlyAccessSignups }        from '../db/schema';
import { eq }                        from 'drizzle-orm';

const router = Router();

// ── POST /early-access ────────────────────────────────────────────────────
// Public — no auth required. Collects email (+ optional name) for waitlist.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { email, name, source } = req.body as { email?: string; name?: string; source?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(422).json({ error: { code: 'INVALID_EMAIL', message: 'A valid email address is required.', status: 422 } });
    return;
  }

  try {
    await db.insert(earlyAccessSignups).values({
      email:  email.trim().toLowerCase(),
      name:   name?.trim() || null,
      source: source?.trim() || 'landing',
    });

    res.json({ success: true });
  } catch (err: any) {
    // Unique constraint violation → already signed up
    if (err?.code === '23505') {
      // Still return success so we don't leak whether the email exists
      res.json({ success: true, already_registered: true });
      return;
    }
    console.error('[early-access] signup error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', status: 500 } });
  }
});

// ── GET /early-access/count ───────────────────────────────────────────────
// Public — returns total signup count for social proof on landing page
router.get('/count', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select({ id: earlyAccessSignups.id }).from(earlyAccessSignups);
    res.json({ count: rows.length });
  } catch {
    res.json({ count: 0 });
  }
});

export default router;