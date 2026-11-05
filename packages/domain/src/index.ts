import { z } from "zod";
import { detectedPostSchema } from "./signals";

export type {
  CallView,
  CreatorWorkspaceView,
  DataState,
  FillView,
  PreparedTradeView,
} from "./view-models";

/** Base mainnet and Base Sepolia. Never switch between them silently. */
export const chainIdSchema = z.union([z.literal(8453), z.literal(84532)]);
export type ChainId = z.infer<typeof chainIdSchema>;
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
/** Token amounts as decimal integer strings: never floats. */
export const amountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

// Identity: a stable X user ID bound to a wallet. Proves account ownership, not accuracy.
export const bindingChallengeRequestSchema = z
  .object({ wallet: addressSchema })
  .strict();
export const bindingProofSchema = z
  .object({
    challengeId: z.uuid(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();
export const identityBindingSchema = z.object({
  xUserId: z.string().regex(/^[0-9]+$/),
  handle: z.string().regex(/^[a-z0-9_]{1,15}$/),
  wallet: addressSchema,
  linkedAt: z.iso.datetime(),
});
export const bindingChallengeSchema = z.object({
  challengeId: z.uuid(),
  message: z.string().min(1).max(2048),
  wallet: addressSchema,
  expiresAt: z.iso.datetime(),
});
export const identityStatusSchema = z.object({
  xAccount: z
    .object({ xUserId: z.string().regex(/^[0-9]+$/), handle: z.string() })
    .nullable(),
  binding: identityBindingSchema.nullable(),
  bindingCurrent: z.boolean(),
});
export const xHandleSchema = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);

export function normalizeHandle(input: string): string | null {
  const result = xHandleSchema.safeParse(input.replace(/^@/, ""));
  return result.success ? result.data.toLowerCase() : null;
}

export const creatorSchema = z.object({
  xUserId: z.string().regex(/^[0-9]+$/),
  handle: xHandleSchema,
  wallet: addressSchema.nullable(),
  identity: z.enum(["unlinked", "linked"]),
  reputation: z.object({
    score: z.number().min(0).max(100).nullable(),
    scoredCalls: z.number().int().nonnegative(),
    indexedPosts: z.number().int().nonnegative(),
    methodologyVersion: z.string(),
  }),
});
export type Creator = z.infer<typeof creatorSchema>;

export const tradeIntentSchema = z.object({
  chainId: chainIdSchema,
  market: addressSchema,
  side: z.enum(["buy", "sell"]),
  amount: amountSchema.refine(
    (value) => BigInt(value) > 0n,
    "Amount must be positive",
  ),
  source: z.object({
    postId: z.string().regex(/^[0-9]+$/),
    creatorXUserId: z.string().regex(/^[0-9]+$/),
  }),
});
export type TradeIntent = z.infer<typeof tradeIntentSchema>;

export const publicCreatorEvidenceSchema = z.object({
  handle: xHandleSchema,
  identity: z.object({
    status: z.enum(["bound", "unavailable"]),
    xUserId: z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
    wallet: addressSchema.optional(),
    linkedAt: z.iso.datetime().optional(),
  }),
  observedAt: z.iso.datetime(),
});
export type PublicCreatorEvidence = z.infer<typeof publicCreatorEvidenceSchema>;

// Calls: priced at the minute they were posted, scored at expiry under directional-return-v1.
const callAssets = ["BTC", "ETH", "SOL", "MON"] as const;
const signedIntegerSchema = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
export const callRegistrationSchema = z
  .object({
    postUrl: z.string().max(200),
    asset: z.enum(callAssets),
    direction: z.enum(["up", "down"]),
    horizon: z.enum(["24h", "7d", "30d"]),
    // Minimum move in basis points; 1 means any move in the called direction.
    targetBps: z.number().int().min(1).max(10000),
  })
  .strict();
export const priceObservationSchema = z.object({
  assetId: z.enum(callAssets),
  sourceId: z.string(),
  price: amountSchema,
  priceDecimals: z.number().int().min(0).max(36),
  timestamp: amountSchema,
});
export const callEvidenceSchema = z.object({
  post: z.object({
    authorHandle: xHandleSchema,
    text: z.string().max(1000),
    verifiedAt: z.iso.datetime(),
  }),
  horizon: z.enum(["24h", "7d", "30d"]),
  terms: z.object({
    methodology: z.literal("directional-return-v1"),
    assetId: z.enum(callAssets),
    sourceId: z.string(),
    direction: z.enum(["up", "down"]),
    entryPrice: amountSchema,
    priceDecimals: z.number().int().min(0).max(36),
    expiry: amountSchema,
    toleranceSeconds: amountSchema,
    targetBps: amountSchema,
  }),
  entry: priceObservationSchema,
  exit: priceObservationSchema.nullable(),
  outcome: z.enum(["success", "failure", "tie"]).nullable(),
  returnBps: signedIntegerSchema.nullable(),
  lastAttemptAt: z.iso.datetime().nullable(),
  // Repeated public-availability checks of the post (oEmbed), newest last.
  availability: z
    .array(
      z.object({
        status: z.enum(["available", "not-publicly-available", "unavailable"]),
        checkedAt: z.iso.datetime(),
      }),
    )
    .max(6)
    .optional(),
});
export type CallEvidence = z.infer<typeof callEvidenceSchema>;
export const publicCallSchema = z.object({
  id: z.uuid(),
  postId: z.string().regex(/^[0-9]+$/),
  sourceUrl: z.url(),
  publishedAt: z.iso.datetime(),
  registeredAt: z.iso.datetime(),
  status: z.enum(["open", "resolved"]),
  evidence: callEvidenceSchema,
});
export type PublicCall = z.infer<typeof publicCallSchema>;
export const publicCallLedgerSchema = z.object({
  handle: xHandleSchema,
  methodology: z.literal("directional-return-v1"),
  calls: z.array(publicCallSchema),
  observedAt: z.iso.datetime(),
});
export * from "./reputation";
export * from "./signals";
export * from "./watchlist";

// Public reachability is not a deletion verdict or a settlement signal.
export const postAvailabilitySchema = z.object({
  status: z.enum(["available", "not-publicly-available", "unavailable"]),
  source: z.literal("x-oembed"),
  checkedAt: z.iso.datetime(),
});
export type PostAvailability = z.infer<typeof postAvailabilitySchema>;

/** The after market for one caller: open calls, unresolved ones and what we detected in their posts. */
export const creatorOverviewSchema = z.object({
  handle: xHandleSchema,
  observedAt: z.iso.datetime(),
  callsStatus: z.enum(["ready", "unavailable", "untracked"]),
  ongoingCalls: z.array(publicCallSchema).max(50),
  expiredUnresolved: z.number().int().nonnegative(),
  positionsNote: z.string(),
  detectedPosts: z.array(detectedPostSchema).max(10).default([]),
  detectedPostsStatus: z.enum(["ready", "unavailable"]).default("unavailable"),
  // Trades users recorded against this creator's posts. The post link is user-supplied;
  // no profit or loss is computed from it.
  followerTrades: z
    .object({
      status: z.enum(["ready", "unavailable"]),
      recorded: z.number().int().nonnegative(),
      submitted: z.number().int().nonnegative(),
      posts: z.number().int().nonnegative(),
    })
    .default({ status: "unavailable", recorded: 0, submitted: 0, posts: 0 }),
});
export type CreatorOverview = z.infer<typeof creatorOverviewSchema>;

export const browserFollowSchema = z.object({
  handle: xHandleSchema,
  observedAt: z.iso.datetime(),
});
export const browserFollowingSchema = z.object({
  viewerHandle: xHandleSchema,
  enabled: z.boolean(),
  follows: z.array(browserFollowSchema).max(500),
  coverage: z.literal("viewed-only"),
});
export type BrowserFollowing = z.infer<typeof browserFollowingSchema>;
