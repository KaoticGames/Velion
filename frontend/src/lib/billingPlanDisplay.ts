import type { MergedStripePrices } from '@/hooks/useBillingPriceCatalog';

/** Marketing amounts — keep in sync with public pricing copy. */
export const BILLING_PLAN_USD = {
  player: { monthly: 5, annual: 50 },
  dm:     { monthly: 10, annual: 100 },
} as const;

export type PaidSubscribeTier = 'player' | 'dm';

export function paidPlanStripePriceId(
  tier: PaidSubscribeTier,
  annual: boolean,
  catalog: MergedStripePrices,
): string | null {
  if (tier === 'player') return annual ? catalog.player_annual : catalog.player_monthly;
  return annual ? catalog.dm_annual : catalog.dm_monthly;
}

export function displayPlanPriceLabel(tier: PaidSubscribeTier, annual: boolean): string {
  const v   = BILLING_PLAN_USD[tier][annual ? 'annual' : 'monthly'];
  const usd = new Intl.NumberFormat(undefined, {
    style:                 'currency',
    currency:              'USD',
    maximumFractionDigits: 0,
  }).format(v);
  return annual ? `${usd} / year` : `${usd} / month`;
}
