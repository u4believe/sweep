/**
 * One-shot script: provision platform treasury wallets for all supported chains.
 *
 * Run from the api-server directory:
 *   node --env-file=.env scripts/provision-treasury-wallets.mjs
 *
 * What it does:
 *   1. Creates SCA wallets for all missing EVM chains in the treasury wallet set.
 *      (All EVM SCA wallets in the same wallet set share the same on-chain address.)
 *   2. Creates an EOA wallet for SOL-DEVNET (Solana has a separate base58 address).
 *   3. Prints the .env entries to copy-paste.
 *
 * Existing entries already in .env are skipped automatically.
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { randomUUID } from "node:crypto";

const API_KEY        = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET  = process.env.CIRCLE_ENTITY_SECRET;
const WALLET_SET_ID  = process.env.CIRCLE_WALLET_SET_ID;

if (!API_KEY || !ENTITY_SECRET || !WALLET_SET_ID) {
  console.error("CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID must be set in .env");
  process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey:       API_KEY,
  entitySecret: ENTITY_SECRET,
});

// EVM chains that need a treasury wallet ID
const MISSING_EVM_CHAINS = [
  { key: "ARB-SEPOLIA",      envVar: "CIRCLE_PLATFORM_WALLET_ID_ARB_SEPOLIA"      },
  { key: "OP-SEPOLIA",       envVar: "CIRCLE_PLATFORM_WALLET_ID_OP_SEPOLIA"       },
  { key: "MATIC-AMOY",       envVar: "CIRCLE_PLATFORM_WALLET_ID_MATIC_AMOY"       },
  { key: "AVAX-FUJI",        envVar: "CIRCLE_PLATFORM_WALLET_ID_AVAX_FUJI"        },
  { key: "UNICHAIN-SEPOLIA", envVar: "CIRCLE_PLATFORM_WALLET_ID_UNICHAIN_SEPOLIA" },
  { key: "ETH-SEPOLIA",      envVar: "CIRCLE_PLATFORM_WALLET_ID_ETH_SEPOLIA"      },
  { key: "MONAD-TESTNET",    envVar: "CIRCLE_PLATFORM_WALLET_ID_MONAD_TESTNET"    },
];

const SOL = {
  idVar:   "CIRCLE_PLATFORM_WALLET_ID_SOL",
  addrVar: "CIRCLE_PLATFORM_WALLET_ADDRESS_SOL",
};

async function main() {
  const results = {}; // chain key → { id, address }

  // ── EVM chains ──────────────────────────────────────────────────────────────
  const chainsToCreate = MISSING_EVM_CHAINS.filter((c) => !process.env[c.envVar]);

  if (chainsToCreate.length > 0) {
    console.log(`\nProvisioning EVM wallets one chain at a time …\n`);

    for (const { key } of chainsToCreate) {
      process.stdout.write(`  ${key.padEnd(20)} … `);
      try {
        const res     = await client.createWallets({
          idempotencyKey: randomUUID(),
          blockchains:    [key],
          count:          1,
          walletSetId:    WALLET_SET_ID,
          accountType:    "SCA",
        });
        const wallets = res.data?.wallets ?? [];
        const w       = wallets.find((x) => (x.blockchain ?? x.chain) === key);
        if (w) {
          results[key] = { id: w.id, address: w.address };
          console.log(`✓  id=${w.id}`);
        } else {
          console.log("✗  no wallet in response");
        }
      } catch (err) {
        console.log(`✗  skipped (${err.message ?? err})`);
      }
    }
  } else {
    console.log("\nAll EVM chains already provisioned — skipping.");
  }

  // ── Solana ─────────────────────────────────────────────────────────────────
  if (!process.env[SOL.idVar]) {
    console.log("\nCreating EOA wallet for SOL-DEVNET …");

    const res     = await client.createWallets({
      idempotencyKey: randomUUID(),
      blockchains:    ["SOL-DEVNET"],
      count:          1,
      walletSetId:    WALLET_SET_ID,
      accountType:    "EOA",
    });

    const wallets = res.data?.wallets ?? [];
    const sol     = wallets.find((w) => (w.blockchain ?? w.chain) === "SOL-DEVNET");
    if (sol) results["SOL-DEVNET"] = { id: sol.id, address: sol.address };
  } else {
    console.log(`\nSOL-DEVNET already set (${SOL.idVar}) — skipping.`);
  }

  // ── Print .env lines ────────────────────────────────────────────────────────
  if (Object.keys(results).length === 0) {
    console.log("\nNothing to add — all chains already provisioned.\n");
    return;
  }

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("  Paste these into  api-server/.env");
  console.log("────────────────────────────────────────────────────────────────\n");

  for (const { key, envVar } of MISSING_EVM_CHAINS) {
    const w = results[key];
    if (!w) continue;
    console.log(`# ${key} (address: ${w.address})`);
    console.log(`${envVar}=${w.id}\n`);
  }

  const sol = results["SOL-DEVNET"];
  if (sol) {
    console.log("# SOL-DEVNET treasury wallet");
    console.log(`${SOL.idVar}=${sol.id}`);
    console.log(`${SOL.addrVar}=${sol.address}\n`);
  }

  console.log("────────────────────────────────────────────────────────────────");
  console.log(`\nExpected EVM address (all chains): ${process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "(check .env)"}`);
  console.log("The SOL-DEVNET address above is new — add it to the Gateway");
  console.log("webhook alongside your EVM treasury address.\n");
}

main().catch((err) => {
  console.error("\nScript failed:", err.message ?? err);
  process.exit(1);
});
