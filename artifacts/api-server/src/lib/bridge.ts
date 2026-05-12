/**
 * Standard Transfer + Forwarding bridge — Arc Testnet → BASE-SEPOLIA.
 *
 * Used only when moving USDC from an Arc address to BASE-SEPOLIA.
 * Arc Testnet has both `bridge` AND `adapter` kitContracts, so the Circle
 * Wallets adapter can sign CCTP source transactions from Arc.
 *
 * ⚠️  BASE-SEPOLIA → Arc Testnet via Circle App Kit is NOT supported here.
 *     Base Sepolia's kitContracts has no `adapter` contract, so the Circle
 *     Wallets adapter cannot sign from Base Sepolia. Use cctpBridge.ts
 *     (cctpDepositForBurnFromBase) for Base → Arc transfers instead.
 *
 * Arc Testnet CCTP V2 contracts:
 *   tokenMessenger:      0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
 *   messageTransmitter:  0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
 *   kitContracts.bridge: 0xC5567a5E3370d4DBfB0540025078e283e36A363d
 *   kitContracts.adapter:0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b
 *
 * Gas: Arc USDC is the native token — Circle Gas Station covers it.
 */

import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { getPlatformWalletAddress } from "./circle.js";
import { logger } from "./logger.js";

export interface BridgeResult {
  steps: unknown[];
}

let _kit: AppKit | null = null;
function getKit(): AppKit {
  if (!_kit) _kit = new AppKit();
  return _kit;
}

/**
 * Forward USDC from an Arc Testnet address to the BASE-SEPOLIA platform
 * treasury using the Standard Transfer + Forwarding path (useForwarder: true).
 * Intended for both user wallet sweeps and platform treasury consolidation.
 *
 * @param sourceAddress  EVM address on Arc Testnet (user wallet or platform treasury).
 * @param amount         Human-readable USDC amount, e.g. "10.000000".
 */
export async function bridgeArcToBaseTreasury(
  sourceAddress: string,
  amount: string,
): Promise<BridgeResult> {
  const apiKey       = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const treasury     = getPlatformWalletAddress();

  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set to run CCTP bridge");
  }
  if (!treasury) {
    throw new Error("CIRCLE_PLATFORM_WALLET_ADDRESS must be set — it is the BASE-SEPOLIA treasury");
  }

  // Circle Wallets adapter signs CCTP transactions on behalf of the user's
  // Circle DCW wallet — no private key required.
  const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });

  logger.info(
    { sourceAddress, amount, treasury },
    "[bridge] Starting Standard Transfer + Forwarding: Arc Testnet → BASE-SEPOLIA treasury",
  );

  // useForwarder: true — Standard Transfer + Forwarding path.
  // Circle's Forwarding Service accepts a standard ERC-20 transfer to the kit
  // bridge contract on Arc, handles CCTP V2 attestation, and mints on BASE-SEPOLIA.
  // Arc Testnet has forwarderSupported.source=true (CCTP domain 26).
  // Testnet CCTP + forwarder attestation can take several minutes.
  const BRIDGE_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

  let result: any;
  try {
    result = await Promise.race([
      (getKit() as any).bridge({
        from: {
          adapter,
          chain:   "Arc_Testnet",
          address: sourceAddress,
        },
        to: {
          chain:            "Base_Sepolia",
          recipientAddress: treasury,
          useForwarder:     true,
        },
        amount,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Standard Transfer + Forwarding timed out after 8 minutes")), BRIDGE_TIMEOUT_MS),
      ),
    ]);
  } catch (bridgeErr: any) {
    const msg = bridgeErr?.response?.data?.message
      ?? bridgeErr?.errors?.[0]?.message
      ?? bridgeErr?.message
      ?? String(bridgeErr);
    logger.error({ err: msg }, "[bridge] Standard Transfer + Forwarding failed");
    throw new Error(`Standard Transfer + Forwarding failed: ${msg}`);
  }

  const steps: any[] = result?.steps ?? [];
  const overallState: string = result?.state ?? "unknown";

  for (const step of steps) {
    logger.info(
      { name: step.name, state: step.state, txHash: step.txHash, forwarded: step.forwarded },
      `[bridge] Step: ${step.name} → ${step.state}`,
    );
  }

  logger.info(
    { amount, overallState, stepCount: steps.length },
    "[bridge] Standard Transfer + Forwarding Arc → Base overall result",
  );

  if (overallState === "error" || steps.some((s) => s.state === "error")) {
    const failedStep = steps.find((s) => s.state === "error");
    throw new Error(`Standard Transfer + Forwarding step failed: ${failedStep?.name ?? "unknown"}`);
  }

  return { steps };
}

