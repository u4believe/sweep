// Measured on each network (testnet): how long until a crypto deposit is credited
// ("Completed") and until a withdrawal lands. Deposits show up on the dashboard as
// pending well before that. Update these when timings change (e.g. on mainnet).

/** Minutes until a deposit is credited to the balance. */
const DEPOSIT_MIN: Record<string, number> = {
  "ARC-TESTNET":  1,
  "BASE-SEPOLIA": 6,
  "ARB-SEPOLIA":  4,
  "OP-SEPOLIA":   4,
  "MATIC-AMOY":   1,
  "AVAX-FUJI":    1,
  "SOL-DEVNET":   1,
};

/** Minutes until a withdrawal is completed. Chains without a measurement show no estimate. */
const WITHDRAWAL_MIN: Record<string, number> = {
  "ARC-TESTNET":      1,
  "BASE-SEPOLIA":     1,
  "ARB-SEPOLIA":      1,
  "OP-SEPOLIA":       1,
  "MATIC-AMOY":       1,
  "AVAX-FUJI":        1,
  "UNICHAIN-SEPOLIA": 1,
  "SOL-DEVNET":       1,
};

/** Deposits appear on the dashboard (as pending) within this many seconds. */
export const DEPOSIT_SHOWS_UP = "Within 30 seconds";

const about = (min: number | undefined) => (min ? `About ${min} min` : null);

export const depositCreditTime   = (chainKey: string) => about(DEPOSIT_MIN[chainKey]);
export const withdrawalArriveTime = (chainKey: string) => about(WITHDRAWAL_MIN[chainKey]);
