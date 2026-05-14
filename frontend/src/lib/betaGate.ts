/** Default true unless `VITE_BETA_GATE_ENABLED=false` — closed-beta marketing and access rules. */
export const BETA_GATE_ENABLED =
  import.meta.env.VITE_BETA_GATE_ENABLED !== 'false';
