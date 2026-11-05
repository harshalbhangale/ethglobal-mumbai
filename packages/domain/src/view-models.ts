import type { ChainId, Creator } from "./index";

/** Planned service response contract. Missing data must never become a zero metric. */
export type DataState<T> =
  | { status: "not_connected" | "unavailable" | "loading"; reason: string }
  | { status: "error"; message: string; retryable: boolean }
  | {
      status: "ready";
      data: T;
      provenance: {
        source: string;
        chainId: ChainId | null;
        observedAt: string;
        finality: "pending" | "confirmed";
        coverage: "partial" | "complete";
      };
    };

export type CreatorWorkspaceView = {
  creator: Creator;
  linkedAt: string;
};

export type CallView = {
  postId: string;
  creatorXUserId: string;
  sourceUrl: string;
  publishedAt: string;
  asset: string | null;
  direction: "bullish" | "bearish" | null;
  horizon: string | null;
  status: "unreviewed" | "eligible" | "resolved" | "excluded";
  exclusionReason: string | null;
  methodologyVersion: string | null;
};

export type FillView = {
  id: string;
  chainId: ChainId;
  wallet: `0x${string}`;
  market: `0x${string}`;
  side: "buy" | "sell";
  baseAmount: string;
  quoteAmount: string;
  feeAmount: string | null;
  feeToken: `0x${string}` | null;
  sourcePostId: string | null;
  transactionHash: `0x${string}`;
  confirmedAt: string;
};

/** Read-only quote preparation. This type never represents a signed or submitted trade. */
export type PreparedTradeView = {
  chainId: ChainId;
  market: `0x${string}`;
  expiresAt: string;
  minimumOutput: string;
  boundedApproval: {
    token: `0x${string}`;
    spender: `0x${string}`;
    amount: string;
  } | null;
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string };
  requiresWalletApproval: true;
};
