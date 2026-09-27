// Measured on each network (testnet). Update these when timings change (e.g. on mainnet).
//   arrival:    a crypto deposit shows up on the dashboard (as pending)
//   completion: the deposit is credited ("Completed")
//   withdrawal: a withdrawal is completed

const DEPOSIT: Record<string, { arrival: string; completion: string }> = {
  "ARC-TESTNET":  { arrival: "Within 15s", completion: "~30s" },
  "AVAX-FUJI":    { arrival: "Within 15s", completion: "~30s" },
  "SOL-DEVNET":   { arrival: "Within 15s", completion: "~30s" },
  "BASE-SEPOLIA": { arrival: "Within 20s", completion: "~6 min" },
  "ARB-SEPOLIA":  { arrival: "Within 20s", completion: "~4 min" },
  "OP-SEPOLIA":   { arrival: "Within 20s", completion: "~4 min" },
  "MATIC-AMOY":   { arrival: "Within 30s", completion: "~1 min" },
};

/** Chains without a measurement show no estimate. */
const WITHDRAWAL: Record<string, string> = {
  "ARC-TESTNET":      "~1 min",
  "BASE-SEPOLIA":     "~1 min",
  "ARB-SEPOLIA":      "~1 min",
  "OP-SEPOLIA":       "~1 min",
  "MATIC-AMOY":       "~1 min",
  "AVAX-FUJI":        "~1 min",
  "UNICHAIN-SEPOLIA": "~1 min",
  "SOL-DEVNET":       "~1 min",
};

export const depositArrival    = (chainKey: string) => DEPOSIT[chainKey]?.arrival ?? null;
export const depositCompletion = (chainKey: string) => DEPOSIT[chainKey]?.completion ?? null;
export const withdrawalTime    = (chainKey: string) => WITHDRAWAL[chainKey] ?? null;
