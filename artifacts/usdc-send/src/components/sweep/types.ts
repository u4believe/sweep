import type { ReactNode } from "react";
import type { FullBalance } from "@/lib/wallet";
import type { WithdrawMutation } from "./use-send-flow";

/** Inputs shared by the mobile and desktop dashboard shells. */
export interface DashboardShellProps {
  user: { name: string; email: string; hasTransactionPassword: boolean; circleWalletAddress?: string | null };
  balance: FullBalance | undefined;
  depositAddresses: Record<string, string>;
  withdraw: WithdrawMutation;
  onBalanceChanged: () => void;
  onLogout: () => void;
  /** Payment ID from a /send/<id> QR link, opened straight into Send. */
  initialPayTo?: string | null;
  /** Existing dashboard tabs, rendered inside the shell unchanged. */
  slots: {
    recurring: ReactNode;
    settings: ReactNode;
    support: ReactNode;
  };
}
