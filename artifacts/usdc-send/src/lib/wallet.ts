// Shared wallet/history helpers used by both the desktop dashboard and the mobile shell.

// Block explorer TX-page prefixes, matched against the network/source field.
// Ordered from most-specific to least-specific to avoid "arc" matching "arbitrum".
const EXPLORER_BASE: Array<{ match: string; url: string; solana?: boolean }> = [
  { match: "arb",              url: "https://sepolia.arbiscan.io/tx/" },
  { match: "optimism",         url: "https://testnet-explorer.optimism.io/tx/" },
  { match: "op-sepolia",       url: "https://testnet-explorer.optimism.io/tx/" },
  { match: "polygon",          url: "https://amoy.polygonscan.com/tx/" },
  { match: "matic",            url: "https://amoy.polygonscan.com/tx/" },
  { match: "avalanche",        url: "https://testnet.avascan.info/blockchain/c/tx/" },
  { match: "avax",             url: "https://testnet.avascan.info/blockchain/c/tx/" },
  { match: "ethereum",         url: "https://sepolia.etherscan.io/tx/" },
  { match: "eth-sepolia",      url: "https://sepolia.etherscan.io/tx/" },
  { match: "unichain",         url: "https://unichain-sepolia.blockscout.com/tx/" },
  { match: "hyperevm",         url: "https://testnet.hyperliquid.xyz/tx/" },
  { match: "base",             url: "https://sepolia.basescan.org/tx/" },
  { match: "arc",              url: "https://testnet.arcscan.app/tx/" },
  { match: "solana",           url: "https://explorer.solana.com/tx/", solana: true },
  { match: "sol-devnet",       url: "https://explorer.solana.com/tx/", solana: true },
];

// EVM: 0x + 64 hex chars.  Solana: base58, 87–88 chars (no 0x prefix).
const isEvmHash    = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);
const isSolanaHash = (h: string) => /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(h);
export const isOnChainHash = (h: string) => isEvmHash(h) || isSolanaHash(h);

export function getExplorerUrl(network: string, txHash: string): string | null {
  if (!txHash || !isOnChainHash(txHash)) return null;
  const lower = network.toLowerCase().replace(/[-_]/g, " ");
  const entry  = EXPLORER_BASE.find((e) => lower.includes(e.match.replace(/-/g, " ")));
  if (!entry) return null;
  // Solana explorer needs ?cluster=devnet appended after the signature
  return entry.solana
    ? `${entry.url}${txHash}?cluster=devnet`
    : `${entry.url}${txHash}`;
}

export interface UnifiedTx {
  id: string;
  category: "deposit" | "withdrawal" | "escrow";
  currency: "USDC" | "USD";
  direction: "in" | "out";
  amount: string;
  status: string;
  network: string;
  txHash: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  description: string;
  createdAt: string;
  completedAt: string | null;
}

export interface HistoryPage {
  transactions: UnifiedTx[];
  total: number;
  page: number;
  totalPages: number;
}

export interface FullBalance {
  onChainUsdcBalance: string;
  onChainLastUpdated: string | null;
  claimedBalance: string;
  pendingBalance: string;
  usdBalance: string;
  usdEquivalent: string;
}

export const WITHDRAWAL_CHAINS = [
  { key: "ARC-TESTNET",       label: "Arc",       type: "evm",    minWithdrawal: 1,  platformFee: 0.10 },
  { key: "BASE-SEPOLIA",      label: "Base",      type: "evm",    minWithdrawal: 1,  platformFee: 0.21 },
  { key: "ARB-SEPOLIA",       label: "Arbitrum",  type: "evm",    minWithdrawal: 1,  platformFee: 0.21 },
  { key: "OP-SEPOLIA",        label: "Optimism",  type: "evm",    minWithdrawal: 1,  platformFee: 0.21 },
  { key: "MATIC-AMOY",        label: "Polygon",   type: "evm",    minWithdrawal: 1,  platformFee: 0.21 },
  { key: "AVAX-FUJI",         label: "Avalanche", type: "evm",    minWithdrawal: 5,  platformFee: 0.35 },
  { key: "UNICHAIN-SEPOLIA",  label: "Unichain",  type: "evm",    minWithdrawal: 1,  platformFee: 0.21 },
  { key: "SOL-DEVNET",        label: "Solana",    type: "solana", minWithdrawal: 5,  platformFee: 0.40 },
] as const;

export type WithdrawalChain = typeof WITHDRAWAL_CHAINS[number];

export const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
export const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const authHeaders = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  const jwt = localStorage.getItem("token");
  if (jwt) h["Authorization"] = `Bearer ${jwt}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
};
