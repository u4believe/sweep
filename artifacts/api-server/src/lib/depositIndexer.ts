/**
 * Multi-chain USDC deposit indexer.
 *
 * Polls ERC-20 Transfer events on BASE-SEPOLIA and ARC-TESTNET where `to`
 * matches a known user wallet address. On detection:
 *   1. Credits user's claimedBalance (idempotent via txHash).
 *   2. Enqueues a bridge_job so the USDC is automatically swept to the
 *      BASE-SEPOLIA platform treasury.
 *
 * Circle webhook (deposit.ts) is the primary notification path. This indexer
 * acts as a reliable fallback for any events the webhook misses.
 */

import { ethers }  from "ethers";
import {
  db, usersTable, depositsTable, indexerStateTable, bridgeJobsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  SUPPORTED_SOURCE_CHAINS,
  CHAIN_RPC_URLS,
  CHAIN_USDC_ADDRESSES,
  getDcwClient,
  type SourceChain,
} from "./circle.js";
import { triggerBridgeWorker } from "./bridgeWorker.js";

// Human-readable network labels for deposit records (used in history display + explorer URL matching).
const CHAIN_LABELS: Record<string, string> = {
  "BASE-SEPOLIA": "Base Sepolia USDC",
  "ARC-TESTNET":  "Arc Testnet USDC",
};

// ─── Network configuration ────────────────────────────────────────────────────

interface NetworkConfig {
  chain:          SourceChain;
  rpcUrl:         string;
  usdcAddress:    string;
  indexerStateId: number;  // unique row ID in indexer_state; must be ≥ 3
}

// indexerStateId 1 and 2 are reserved; chain IDs start at 3.
const CHAIN_INDEXER_IDS: Record<SourceChain, number> = {
  "BASE-SEPOLIA": 3,
  "ARC-TESTNET":  4,
};

const NETWORKS: NetworkConfig[] = SUPPORTED_SOURCE_CHAINS.map((chain) => ({
  chain,
  rpcUrl:         CHAIN_RPC_URLS[chain],
  usdcAddress:    CHAIN_USDC_ADDRESSES[chain],
  indexerStateId: CHAIN_INDEXER_IDS[chain],
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS          = 3_000;   // 3s per chain
const BLOCKS_PER_CHUNK          = 200;     // unfiltered getLogs can be large; keep chunks small
const CATCHUP_BLOCKS_PER_CHUNK  = 500;     // reduced to keep per-chunk memory manageable
const CHUNK_DELAY_MS            = 100;     // GC breathing room between chunks
const CATCHUP_CHUNK_DELAY_MS    = 200;     // longer delay during catch-up to avoid OOM
const CATCHUP_THRESHOLD         = 50_000;  // blocks behind before entering fast catch-up mode
const LOOKBACK_BLOCKS           = 200_000; // ~4.6 days lookback on first run / after long downtime
const ADDRESS_REFRESH_INTERVAL  = 1;       // refresh address map every poll ≈ 3 s

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

// ─── Per-chain indexer ────────────────────────────────────────────────────────

class ChainIndexer {
  private running  = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private provider: ethers.JsonRpcProvider | null = null;
  private contract: ethers.Contract | null = null;
  private decimals: number | null = null;

  private addressMap: Map<string, number> = new Map(); // address (lower) → userId
  private pollCount = 0;

  // Circle API poll cursor for ARC-TESTNET.
  // Initialised to 24 h ago so the first poll catches any deposits made while
  // the server was offline.  Advanced by 2-minute-buffered slices on each poll.
  private lastCirclePollTime: string = new Date(Date.now() - 24 * 3_600_000).toISOString();

  constructor(private readonly cfg: NetworkConfig) {}

  start() {
    if (this.running) return;
    this.running = true;
    logger.info(`[usdc-indexer:${this.cfg.chain}] Starting`);
    this.initProvider();
    void this.poll();
  }

  stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.provider = null;
    this.contract = null;
    logger.info(`[usdc-indexer:${this.cfg.chain}] Stopped`);
  }

  private initProvider() {
    this.provider = new ethers.JsonRpcProvider(this.cfg.rpcUrl);
    this.contract = new ethers.Contract(this.cfg.usdcAddress, ERC20_ABI, this.provider);
  }

  private async getDecimals(): Promise<number> {
    if (this.decimals !== null) return this.decimals;
    this.decimals = Number(await this.contract!.decimals());
    return this.decimals;
  }

  private async getOrInitLastBlock(currentBlock: number): Promise<number> {
    const [state] = await db
      .select()
      .from(indexerStateTable)
      .where(eq(indexerStateTable.id, this.cfg.indexerStateId))
      .limit(1);

    if (state) {
      const saved = Number(state.lastProcessedBlock);
      const gap   = currentBlock - saved;
      // Gap > CATCHUP_THRESHOLD means the server was offline for a long time.
      // Crawling through tens of thousands of empty blocks exhausts heap.
      // Fast-forward to recent history — Circle webhooks + balance sync cover
      // any deposits made during the downtime.
      if (gap > CATCHUP_THRESHOLD) {
        const fastForwardTo = Math.max(0, currentBlock - LOOKBACK_BLOCKS);
        // Only fast-forward if the candidate is ahead of where we already are.
        // If saved > fastForwardTo (downtime < LOOKBACK_BLOCKS), continue from
        // saved — no blocks skipped, no gap in coverage.
        if (fastForwardTo > saved) {
          logger.info(
            { chain: this.cfg.chain, gap, saved, fastForwardTo },
            `[usdc-indexer:${this.cfg.chain}] Gap too large — fast-forwarding lastBlock to avoid memory-intensive catch-up`,
          );
          await this.saveLastBlock(fastForwardTo);
          return fastForwardTo;
        }
        logger.info(
          { chain: this.cfg.chain, gap, saved },
          `[usdc-indexer:${this.cfg.chain}] Gap large but within LOOKBACK window — continuing from saved block`,
        );
      }
      return saved;
    }

    const startBlock = Math.max(0, currentBlock - LOOKBACK_BLOCKS);
    await db.insert(indexerStateTable).values({
      id:                 this.cfg.indexerStateId,
      lastProcessedBlock: BigInt(startBlock),
    });
    logger.info(
      { startBlock, chain: this.cfg.chain },
      `[usdc-indexer:${this.cfg.chain}] First run — bootstrapping`,
    );
    return startBlock;
  }

  private async saveLastBlock(block: number) {
    await db
      .update(indexerStateTable)
      .set({ lastProcessedBlock: BigInt(block), updatedAt: new Date() })
      .where(eq(indexerStateTable.id, this.cfg.indexerStateId));
  }

  // Rebuild address → userId map from DB.
  // Reads both circleWalletAddress (primary) and circleWalletAddressesJson (all chains).
  // NEVER watches the platform treasury address — incoming transfers there are sweeps/mints,
  // not user deposits. Watching it causes a feedback loop where every sweep is re-credited.
  private async refreshAddressMap() {
    const platformAddr = (process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "").toLowerCase();

    const rows = await db
      .select({
        id:                  usersTable.id,
        primaryAddr:         usersTable.circleWalletAddress,
        walletAddressesJson: (usersTable as any).circleWalletAddressesJson,
      })
      .from(usersTable)
      .where(sql`${usersTable.circleWalletAddress} is not null`);

    this.addressMap = new Map();
    for (const { id, primaryAddr, walletAddressesJson } of rows) {
      let chainAddr: string | null = null;

      if (walletAddressesJson) {
        try {
          const addrMap = JSON.parse(walletAddressesJson) as Record<string, string>;
          chainAddr = addrMap[this.cfg.chain]?.toLowerCase() ?? null;
        } catch { /* fall through */ }
      }
      if (!chainAddr && primaryAddr) chainAddr = primaryAddr.toLowerCase();
      if (!chainAddr) continue;

      // Skip platform treasury — deposits here are sweep results, not user deposits
      if (platformAddr && chainAddr === platformAddr) continue;

      this.addressMap.set(chainAddr, id);
    }
    logger.debug(
      { chain: this.cfg.chain, watchedAddresses: this.addressMap.size },
      `[usdc-indexer:${this.cfg.chain}] Address map refreshed`,
    );
  }

  // Circle API transaction poll — ARC-TESTNET ONLY.
  // Arc USDC (0x3600… precompile) does NOT emit standard ERC-20 Transfer events,
  // so getLogs() returns nothing and there is no on-chain event from which to
  // extract a transaction hash.  Base Sepolia uses real Transfer-event hashes;
  // Arc uses Circle's own DCW transaction index, which tracks every inbound
  // transfer to managed wallets and exposes the real on-chain txHash.
  // Real tx hashes are globally unique — no collision is possible, unlike the
  // synthetic balance-diff keys the previous approach relied on.
  private async runCircleTransactionPoll() {
    if (this.cfg.chain !== "ARC-TESTNET") return;

    const client = getDcwClient();
    if (!client) {
      logger.warn(`[usdc-indexer:${this.cfg.chain}] Circle DCW client unavailable — skipping API poll`);
      return;
    }

    // 2-minute safety buffer: advance the cursor to (now − 2 min) so that any
    // transactions Circle indexes with a slight delay aren't skipped.
    const from = this.lastCirclePollTime;
    const next = new Date(Date.now() - 120_000).toISOString();

    try {
      const res  = await client.listTransactions({
        blockchain: "ARC-TESTNET" as any,
        txType:     "INBOUND"     as any,
        state:      "COMPLETE"    as any,
        from,
        pageSize:   50,
      } as any);

      const txns: any[] = (res.data as any)?.data?.transactions
                        ?? (res.data as any)?.transactions
                        ?? [];

      for (const tx of txns) {
        const circleId:    string        = tx.id;
        const txHash:      string | null = tx.txHash ?? null;
        const walletId:    string | null = tx.walletId ?? null;
        const destAddress: string        = (tx.destinationAddress ?? "").toLowerCase();
        const amount:      string        = tx.amounts?.[0] ?? "0";

        if (!circleId || parseFloat(amount) <= 0) continue;

        // Resolve the user from walletId (primary → JSON map) then address fallback.
        let userId: number | undefined;

        if (walletId) {
          const [p] = await db.select({ id: usersTable.id }).from(usersTable)
            .where(eq(usersTable.circleWalletId, walletId)).limit(1);
          userId = p?.id;

          if (!userId) {
            const [j] = await db.select({ id: usersTable.id }).from(usersTable)
              .where(sql`${(usersTable as any).circleWalletIdsJson} LIKE ${"%" + walletId + "%"}`).limit(1);
            userId = j?.id;
          }
        }

        if (!userId && destAddress) {
          const [a] = await db.select({ id: usersTable.id }).from(usersTable)
            .where(sql`lower(${usersTable.circleWalletAddress}) = ${destAddress}`).limit(1);
          userId = a?.id;
        }

        if (!userId) {
          logger.debug(
            { circleId, walletId, destAddress },
            `[usdc-indexer:${this.cfg.chain}] Circle poll: no user for tx — skipping`,
          );
          continue;
        }

        // Real on-chain hash is the idempotency key. Fall back to the Circle UUID
        // (prefixed to avoid collisions with Base Sepolia hashes) for the rare case
        // where txHash is not yet populated by the time we fetch.
        const idempotencyKey = txHash ?? `circle-${circleId}`;

        logger.info(
          { userId, amount, idempotencyKey, chain: this.cfg.chain },
          `[usdc-indexer:${this.cfg.chain}] Circle API poll: crediting ${parseFloat(amount).toFixed(6)} USDC`,
        );

        await this.handleDeposit(
          userId,
          parseFloat(amount).toFixed(6),
          idempotencyKey,
          destAddress || walletId || "",
        );
      }

      this.lastCirclePollTime = next;
    } catch (e: any) {
      logger.error(
        { err: e?.message, chain: this.cfg.chain },
        `[usdc-indexer:${this.cfg.chain}] Circle API poll failed — check API key and connectivity`,
      );
    }
  }

  private async handleDeposit(userId: number, amount: string, txHash: string, toAddress: string) {
    // Idempotency check
    const [dup] = await db
      .select({ id: depositsTable.id })
      .from(depositsTable)
      .where(eq(depositsTable.txHash, txHash))
      .limit(1);
    if (dup) return;

    // Credit balance atomically
    await db.update(usersTable)
      .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
      .where(eq(usersTable.id, userId));

    await db.insert(depositsTable).values({
      userId,
      amount,
      type:             "crypto",
      source:           CHAIN_LABELS[this.cfg.chain] ?? `${this.cfg.chain} USDC`,
      status:           "completed",
      depositReference: txHash,
      txHash,
      creditedAt:       new Date(),
    });

    logger.info(
      { txHash, userId, amount, chain: this.cfg.chain },
      `[usdc-indexer:${this.cfg.chain}] Credited deposit`,
    );

    // Enqueue bridge job — sweep USDC to the ARC-TESTNET platform treasury.
    // ARC-TESTNET:  Same-chain Circle DCW sweep (sweepUsdcToPlatformWallet).
    // BASE-SEPOLIA: CCTP V2 depositForBurn → Arc treasury (cctpDepositForBurnFromBase).
    try {
      const [existingJob] = await db
        .select({ id: bridgeJobsTable.id })
        .from(bridgeJobsTable)
        .where(eq(bridgeJobsTable.txHash, txHash))
        .limit(1);

      if (!existingJob) {
        await db.insert(bridgeJobsTable).values({
          userId,
          sourceChain:       this.cfg.chain,
          userWalletAddress: toAddress,
          amount,
          txHash,
          status:            "pending",
        });
        logger.info(
          { txHash, userId, amount, chain: this.cfg.chain },
          `[usdc-indexer:${this.cfg.chain}] Bridge job enqueued`,
        );
        // Kick the bridge worker immediately — don't wait for its 5s poll interval
        triggerBridgeWorker();
      }
    } catch (e: any) {
      logger.warn({ err: e?.message, txHash }, "[usdc-indexer] Bridge job insert failed");
    }
  }

  // Fetches Transfer events for the block range and filters recipient addresses in JS.
  // Arc RPC does NOT support topic[2] address filters — providing a toTopics array
  // silently returns 0 events on Arc. We omit topic[2] and filter after the fact.
  // On Base the topic filter still works fine, but using the same code path is
  // harmless: Base has far fewer blocks to catch up on so the extra logs are cheap.
  private async processChunk(fromBlock: number, toBlock: number) {
    if (this.addressMap.size === 0) return;

    const decimals     = await this.getDecimals();
    const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

    const rawLogs = await this.provider!.getLogs({
      address:   this.cfg.usdcAddress,
      topics:    [TRANSFER_SIG],  // no topic[2] filter — Arc RPC breaks with it
      fromBlock,
      toBlock,
    });

    for (const raw of rawLogs) {
      const iface  = this.contract!.interface;
      const parsed = iface.parseLog(raw);
      if (!parsed) continue;
      const to     = (parsed.args[1] as string).toLowerCase();
      const userId = this.addressMap.get(to);
      if (!userId) continue;  // JS-side recipient filter
      const amount = parseFloat(ethers.formatUnits(parsed.args[2] as bigint, decimals)).toFixed(6);
      await this.handleDeposit(userId, amount, raw.transactionHash, to);
    }
  }

  private async poll() {
    if (!this.running) return;

    try {
      if (!this.provider || !this.contract) this.initProvider();

      const doRefresh = this.pollCount % ADDRESS_REFRESH_INTERVAL === 0;
      if (doRefresh) await this.refreshAddressMap();
      this.pollCount++;

      if (this.addressMap.size > 0) {
        // ── Transfer-event indexing ───────────────────────────────────────────────
        // Arc USDC (0x3600 precompile) does NOT emit standard ERC-20 Transfer events.
        // Fetching getLogs on Arc is pure waste — skip it and advance lastBlock to
        // current so we don't repeat catch-up on every restart. Balance sync below
        // is the authoritative detection path for Arc deposits.
        if (this.cfg.chain === "ARC-TESTNET") {
          try {
            const currentBlock = await this.provider!.getBlockNumber();
            const lastBlock    = await this.getOrInitLastBlock(currentBlock);
            if (currentBlock > lastBlock) {
              await this.saveLastBlock(currentBlock);
              logger.debug(
                { chain: this.cfg.chain, advanced: currentBlock - lastBlock },
                `[usdc-indexer:${this.cfg.chain}] Advanced lastBlock to current (no Transfer events on Arc — balance sync handles deposits)`,
              );
            }
          } catch { /* non-fatal */ }
        } else {
          // BASE-SEPOLIA: fetch Transfer events with throttled chunks so GC can breathe.
          // Isolated in its own try/catch so errors do NOT prevent the Circle API poll.
          try {
            const currentBlock = await this.provider!.getBlockNumber();
            const lastBlock    = await this.getOrInitLastBlock(currentBlock);
            const gap          = currentBlock - lastBlock;
            const catchingUp   = gap > CATCHUP_THRESHOLD;
            const chunkSize    = catchingUp ? CATCHUP_BLOCKS_PER_CHUNK : BLOCKS_PER_CHUNK;

            if (catchingUp) {
              logger.info(
                { chain: this.cfg.chain, gap, chunkSize },
                `[usdc-indexer:${this.cfg.chain}] Catch-up mode — ${gap} blocks behind`,
              );
            }

            let from = lastBlock + 1;
            while (from <= currentBlock) {
              const to = Math.min(from + chunkSize - 1, currentBlock);
              await this.processChunk(from, to);
              await this.saveLastBlock(to);
              from = to + 1;
              if (from <= currentBlock) {
                await new Promise((r) => setTimeout(r, catchingUp ? CATCHUP_CHUNK_DELAY_MS : CHUNK_DELAY_MS));
              }
            }
          } catch (chunkErr: any) {
            logger.warn(
              { err: chunkErr.message, chain: this.cfg.chain },
              `[usdc-indexer:${this.cfg.chain}] Transfer-event indexing error (non-fatal)`,
            );
          }
        }
      }

      // Circle API transaction poll — PRIMARY detection path for Arc Testnet.
      // Arc USDC does not emit Transfer events so getLogs is useless there;
      // Circle's own transaction index provides the real on-chain tx hashes.
      if (doRefresh) await this.runCircleTransactionPoll();
    } catch (err: any) {
      logger.error(
        { err: err.message, chain: this.cfg.chain, rpcUrl: this.cfg.rpcUrl },
        `[usdc-indexer:${this.cfg.chain}] Poll error — check RPC connectivity`,
      );
      this.provider = null;
      this.contract = null;
    }

    if (this.running) {
      this.timer = setTimeout(() => void this.poll(), POLL_INTERVAL_MS);
    }
  }
}

// ─── Module-level instances ───────────────────────────────────────────────────

const indexers = NETWORKS.map((cfg) => new ChainIndexer(cfg));

export function startDepositIndexer() {
  indexers.forEach((idx) => idx.start());
}

export function stopDepositIndexer() {
  indexers.forEach((idx) => idx.stop());
}
