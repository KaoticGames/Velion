import { loadStripe } from '@stripe/stripe-js';

const pk = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim();

/**
 * Single Stripe.js client for the publishable key. Multiple `loadStripe()` calls (especially
 * with different option objects) can produce separate instances and break Elements mounting.
 * Browser SDK API version follows the loaded stripe.js — do not pin `apiVersion` here unless
 * Stripe documents it for your stripe-js major version.
 */
export const stripeBrowserPromise = pk ? loadStripe(pk) : null;
