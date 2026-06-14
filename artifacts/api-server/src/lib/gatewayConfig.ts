// ─── Circle Gateway Configuration ────────────────────────────────────────────
// Single source of truth for all supported chains, USDC addresses,
// Gateway contract addresses, and the per-chain fee structure.

// ─── Gateway contract addresses (identical across all EVM testnets) ──────────
export const GATEWAY_WALLET_ADDRESS_EVM  = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER_ADDRESS_EVM  = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

// ─── Solana Gateway program addresses (devnet) ───────────────────────────────
export const SOLANA_GATEWAY_WALLET_PROGRAM = "GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu";
export const SOLANA_GATEWAY_MINTER_PROGRAM = "GATEmKK2ECL1brEngQZWCgMWPbvrEYqsV6u29dAaHavr";

// ─── Gateway API base URL ─────────────────────────────────────────────────────
export const GATEWAY_API_BASE = "https://gateway-api-testnet.circle.com";

// ─── ABI fragments needed for EVM sweep ──────────────────────────────────────
// approve(spender, amount) — standard ERC-20, called on USDC contract
export const ABI_APPROVE =
  "function approve(address spender, uint256 amount) returns (bool)";

// depositFor(token, depositor, value) — Gateway contract, credits depositor's
// Unified Balance. Called from user SCA with treasury address as depositor.
export const ABI_DEPOSIT_FOR =
  "function depositFor(address token, address depositor, uint256 value)";

// addDelegate(token, delegate) — Gateway contract, authorizes an EOA delegate
// to sign burn intents on behalf of a depositor's Unified Balance for a token.
// Required for SCA treasury wallets because Gateway only accepts EOA signatures.
export const ABI_ADD_DELEGATE =
  "function addDelegate(address token, address delegate)";

// ─── Chain type ───────────────────────────────────────────────────────────────
export type ChainType = "evm" | "solana";

// ─── Supported chain keys (Circle API identifiers) ───────────────────────────
export type ChainKey =
  | "ARC-TESTNET"
  | "BASE-SEPOLIA"
  | "ARB-SEPOLIA"
  | "OP-SEPOLIA"
  | "MATIC-AMOY"
  | "AVAX-FUJI"
  | "UNICHAIN-SEPOLIA"
  | "ETH-SEPOLIA"
  | "HYPEREVM-TESTNET"
  | "SOL-DEVNET";

// ─── Per-chain configuration ──────────────────────────────────────────────────
export interface ChainConfig {
  key:               ChainKey;
  label:             string;      // display name shown in UI
  type:              ChainType;
  usdcAddress:       string;      // USDC contract (EVM) or mint address (Solana)
  explorerUrl:       string;      // block explorer base URL — used by explorerTxUrl()
  depositsEnabled:   boolean;
  withdrawalsEnabled: boolean;
  minWithdrawal:     number;      // USD minimum
  platformFee:       number;      // flat USDC fee deducted from withdrawal amount
  gasStationCovered: boolean;     // Gas Station sponsors sweep txs on this chain
}

// Returns a clickable block-explorer transaction URL for a given chain and hash/signature.
export function explorerTxUrl(chain: ChainConfig, txHash: string): string {
  const base = chain.explorerUrl.replace(/\/$/, "");
  return chain.type === "solana"
    ? `${base}/tx/${txHash}`
    : `${base}/tx/${txHash}`;
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  "ARC-TESTNET": {
    key:               "ARC-TESTNET",
    label:             "Arc",
    type:              "evm",
    usdcAddress:       "0x3600000000000000000000000000000000000000",
    explorerUrl:       "https://testnet.arcscan.app",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     1,
    platformFee:       0.10,
    gasStationCovered: true,
  },
  "BASE-SEPOLIA": {
    key:               "BASE-SEPOLIA",
    label:             "Base",
    type:              "evm",
    usdcAddress:       "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerUrl:       "https://sepolia.basescan.org",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     1,
    platformFee:       0.21,
    gasStationCovered: true,
  },
  "ARB-SEPOLIA": {
    key:               "ARB-SEPOLIA",
    label:             "Arbitrum",
    type:              "evm",
    usdcAddress:       "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorerUrl:       "https://sepolia.arbiscan.io",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     1,
    platformFee:       0.21,
    gasStationCovered: true,
  },
  "OP-SEPOLIA": {
    key:               "OP-SEPOLIA",
    label:             "Optimism",
    type:              "evm",
    usdcAddress:       "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    explorerUrl:       "https://testnet-explorer.optimism.io",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     1,
    platformFee:       0.21,
    gasStationCovered: true,
  },
  "MATIC-AMOY": {
    key:               "MATIC-AMOY",
    label:             "Polygon",
    type:              "evm",
    usdcAddress:       "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    explorerUrl:       "https://amoy.polygonscan.com",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     1,
    platformFee:       0.21,
    gasStationCovered: true,
  },
  "AVAX-FUJI": {
    key:               "AVAX-FUJI",
    label:             "Avalanche",
    type:              "evm",
    usdcAddress:       "0x5425890298aed601595a70AB815c96711a31Bc65",
    explorerUrl:       "https://testnet.avascan.info",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     5,
    platformFee:       0.35,
    gasStationCovered: true,
  },
  "UNICHAIN-SEPOLIA": {
    key:               "UNICHAIN-SEPOLIA",
    label:             "Unichain",
    type:              "evm",
    usdcAddress:       "0x31d0220469e10c4E71834a79b1f276d740d3768F",
    explorerUrl:       "https://unichain-sepolia.blockscout.com",
    depositsEnabled:   false,
    withdrawalsEnabled: true,
    minWithdrawal:     1,
    platformFee:       0.21,
    gasStationCovered: true,
  },
  "HYPEREVM-TESTNET": {
    key:               "HYPEREVM-TESTNET",
    label:             "HyperEVM",
    type:              "evm",
    usdcAddress:       process.env.HYPEREVM_USDC_ADDRESS ?? "0x",
    explorerUrl:       "https://testnet.hyperliquid.xyz",
    depositsEnabled:   false,
    withdrawalsEnabled: false, // disabled — withdrawals to HyperEVM were erroring
    minWithdrawal:     1,
    platformFee:       0.21,
    gasStationCovered: true,
  },
  "ETH-SEPOLIA": {
    key:               "ETH-SEPOLIA",
    label:             "Ethereum",
    type:              "evm",
    usdcAddress:       "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorerUrl:       "https://sepolia.etherscan.io",
    depositsEnabled:   false,
    withdrawalsEnabled: false, // disabled — withdrawals to Ethereum were erroring
    minWithdrawal:     20,
    platformFee:       2.75,
    gasStationCovered: true,
  },
  "SOL-DEVNET": {
    key:               "SOL-DEVNET",
    label:             "Solana",
    type:              "solana",
    usdcAddress:       "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    explorerUrl:       "https://explorer.solana.com/?cluster=devnet",
    depositsEnabled:   true,
    withdrawalsEnabled: true,
    minWithdrawal:     5,
    platformFee:       0.40,
    gasStationCovered: true,
  },
};

// ─── Derived lists ────────────────────────────────────────────────────────────
export const ALL_CHAINS        = Object.values(CHAINS);
export const DEPOSIT_CHAINS    = ALL_CHAINS.filter(c => c.depositsEnabled);
export const WITHDRAWAL_CHAINS = ALL_CHAINS.filter(c => c.withdrawalsEnabled);
export const EVM_CHAINS        = ALL_CHAINS.filter(c => c.type === "evm");
export const SOLANA_CHAINS     = ALL_CHAINS.filter(c => c.type === "solana");

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getChain(key: string): ChainConfig {
  const chain = CHAINS[key as ChainKey];
  if (!chain) throw new Error(`Unsupported chain: ${key}`);
  return chain;
}

export function isDepositChain(key: string): boolean {
  return CHAINS[key as ChainKey]?.depositsEnabled ?? false;
}

export function isWithdrawalChain(key: string): boolean {
  return CHAINS[key as ChainKey]?.withdrawalsEnabled ?? false;
}

// Returns net amount user receives after platform fee is deducted
export function netWithdrawalAmount(chain: ChainConfig, grossAmount: number): number {
  return Math.max(0, grossAmount - chain.platformFee);
}

// Validates a withdrawal request against chain rules
export function validateWithdrawal(
  chainKey: string,
  amount: number,
): { valid: boolean; error?: string } {
  const chain = CHAINS[chainKey as ChainKey];
  if (!chain)             return { valid: false, error: `Unsupported chain: ${chainKey}` };
  if (!chain.withdrawalsEnabled) return { valid: false, error: `Withdrawals not available on ${chain.label}` };
  if (amount < chain.minWithdrawal)
    return { valid: false, error: `Minimum withdrawal on ${chain.label} is $${chain.minWithdrawal.toFixed(2)} USDC` };
  if (amount <= chain.platformFee)
    return { valid: false, error: `Amount must exceed the $${chain.platformFee.toFixed(2)} platform fee` };
  return { valid: true };
}
