import { useEffect, useMemo, useState } from 'react';
import api, { extractApiError } from '@/lib/api';

export type MergedStripePrices = {
  player_monthly: string | null;
  player_annual:  string | null;
  dm_monthly:     string | null;
  dm_annual:      string | null;
};

type ApiPrices = {
  player_month: string | null;
  player_year:  string | null;
  dm_month:     string | null;
  dm_year:      string | null;
};

const emptyCatalog = (): MergedStripePrices => ({
  player_monthly: null,
  player_annual:  null,
  dm_monthly:     null,
  dm_annual:      null,
});

function fromApi(api: ApiPrices | null): MergedStripePrices {
  if (!api) return emptyCatalog();
  return {
    player_monthly: api.player_month || null,
    player_annual:  api.player_year || null,
    dm_monthly:     api.dm_month || null,
    dm_annual:      api.dm_year || null,
  };
}

export const isCatalogComplete = (p: MergedStripePrices): boolean =>
  !!(p.player_monthly && p.player_annual && p.dm_monthly && p.dm_annual);

/**
 * Loads public Stripe price IDs from GET /billing/prices (server env STRIPE_*_PRICE_ID_*).
 */
export function useBillingPriceCatalog(): {
  merged:    MergedStripePrices;
  ready:     boolean;
  complete:  boolean;
  loadError: string | null;
} {
  const [apiPrices, setApiPrices] = useState<ApiPrices | null>(null);
  const [ready, setReady]         = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await api.get<{ prices: ApiPrices }>('/billing/prices');
        if (!cancelled) {
          setApiPrices(data.prices);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setApiPrices(null);
          setLoadError(extractApiError(e).message);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const merged = useMemo(() => fromApi(apiPrices), [apiPrices]);
  const complete = isCatalogComplete(merged);

  return { merged, ready, complete, loadError };
}
