import { z } from "zod";

/**
 * Definitive Flash on Base: quote → fund → sign → submit, with an attached
 * take-profit / stop-loss pair. Docs: https://flash.definitive.fi/docs
 *
 * Server-only: the API key never reaches the browser. The funder wallet signs
 * every order itself; nothing here can sign or move funds.
 */

export const FLASH_API_URL = "https://flash.definitive.fi/v1";
/** Definitive's public integrator key for development. Set DEFINITIVE_API_KEY in production. */
export const FLASH_PUBLIC_DEV_KEY = "dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b";

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Assets a call can be traded into on Base. Brackets need an ERC-20, so ETH trades as WETH. */
export const FLASH_BASE_ASSETS = {
  ETH: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  BTC: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", decimals: 8 },
} as const;
export type FlashAsset = keyof typeof FLASH_BASE_ASSETS;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
/** Positive decimal string, no exponent. Flash takes human units ("2" USDC, "0.05" WETH). */
const decimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).refine((v) => Number(v) > 0, "Must be positive");

const legSchema = z.object({ notionalPrice: decimal }).strict();

/** What the desk asks for. Validated on the server before anything reaches Flash. */
export const flashOrderInputSchema = z
  .object({
    asset: z.enum(Object.keys(FLASH_BASE_ASSETS) as [FlashAsset, ...FlashAsset[]]),
    side: z.enum(["buy", "sell"]),
    /** USDC to spend on a buy; asset units to sell on a sell. */
    qty: decimal,
    orderType: z.enum(["market", "limit"]),
    /** USDC per unit of the asset. Required on limit orders. */
    limitPrice: decimal.optional(),
    takeProfit: legSchema.optional(),
    stopLoss: legSchema.optional(),
    funderAddress: address,
    sourcePostId: z.string().regex(/^[0-9]{1,30}$/).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.orderType === "limit" && !o.limitPrice)
      ctx.addIssue({ code: "custom", message: "Limit orders need a limit price.", path: ["limitPrice"] });
    if (o.orderType === "market" && o.limitPrice)
      ctx.addIssue({ code: "custom", message: "Market orders take no limit price.", path: ["limitPrice"] });
    const bracket = o.takeProfit || o.stopLoss;
    if (bracket && !(o.takeProfit && o.stopLoss))
      ctx.addIssue({ code: "custom", message: "Set both a take-profit and a stop-loss, or neither.", path: ["takeProfit"] });
    // A spot sell receives USDC: there is nothing to take profit on or stop out of.
    if (bracket && o.side === "sell")
      ctx.addIssue({ code: "custom", message: "Take-profit and stop-loss work on buys only.", path: ["side"] });
    if (o.takeProfit && o.stopLoss && Number(o.takeProfit.notionalPrice) <= Number(o.stopLoss.notionalPrice))
      ctx.addIssue({ code: "custom", message: "Take-profit must be above the stop-loss.", path: ["takeProfit"] });
  });
export type FlashOrderInput = z.infer<typeof flashOrderInputSchema>;

export type FlashQuoteRequest = {
  targetChain: "base";
  contraChain: "base";
  targetAsset: string;
  contraAsset: string;
  side: "buy" | "sell";
  qty: string;
  orderType: "market" | "limit";
  funderAddress: string;
  /** Approvals sized to this order, never unlimited. */
  forceMinimalAllowance: true;
  limitCrossPrice?: string;
  attachedBracket?: { takeProfit: { notionalPrice: string }; stopLoss: { notionalPrice: string } };
};

export function buildQuoteRequest(input: FlashOrderInput): FlashQuoteRequest {
  const o = flashOrderInputSchema.parse(input);
  const req: FlashQuoteRequest = {
    targetChain: "base",
    contraChain: "base",
    targetAsset: FLASH_BASE_ASSETS[o.asset].address,
    contraAsset: BASE_USDC,
    side: o.side,
    qty: o.qty,
    orderType: o.orderType,
    funderAddress: o.funderAddress,
    forceMinimalAllowance: true,
  };
  // With a bracket attached, Flash rejects limitNotionalPrice; the cross price (USDC per asset) works for both.
  if (o.limitPrice) req.limitCrossPrice = o.limitPrice;
  if (o.takeProfit && o.stopLoss) req.attachedBracket = { takeProfit: o.takeProfit, stopLoss: o.stopLoss };
  return req;
}

const approveTxSchema = z.object({ to: address, data: z.string().regex(/^0x[0-9a-fA-F]*$/) }).nullable();
/** The parts of a quote the browser needs to fund and sign. */
export const flashQuoteSchema = z.object({
  quoteId: z.string().min(1),
  from: z.object({ amount: z.string(), notional: z.string().nullable().optional() }),
  to: z.object({ amount: z.string(), notional: z.string().nullable().optional() }),
  estimatedPriceImpact: z.string().nullable().optional(),
  evm: z.object({
    approveTx: approveTxSchema.optional(),
    permitTypedData: z.string().nullable().optional(),
    orderTypedData: z.string().min(1),
  }),
  attachedBracket: z
    .object({
      evm: z.object({
        approveTx: approveTxSchema.optional(),
        permitTypedData: z.string().nullable().optional(),
        orderTypedData: z.string().min(1),
      }),
      salt: z.string(),
      deadline: z.string(),
      signedMaxFromAmount: z.string(),
    })
    .nullable()
    .optional(),
});
export type FlashQuote = z.infer<typeof flashQuoteSchema>;

const hexSig = z.string().regex(/^0x[0-9a-fA-F]+$/);
/** What the browser sends back after the funder signed. */
export const flashSignaturesSchema = z
  .object({
    quoteId: z.string().min(1),
    userSignature: hexSig,
    evmOrderTypedData: z.string().min(1),
    evmPermitTypedData: z.string().optional(),
    evmPermitSignature: hexSig.optional(),
    bracket: z
      .object({
        userSignature: hexSig,
        salt: z.string(),
        deadline: z.string(),
        signedMaxFromAmount: z.string(),
        evmPermitTypedData: z.string().optional(),
        evmPermitSignature: hexSig.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type FlashSignatures = z.infer<typeof flashSignaturesSchema>;

/** Submit body: the same order as the quote, plus the funder's signatures echoed back. */
export function buildSubmitRequest(quoteRequest: FlashQuoteRequest, sig: FlashSignatures) {
  const s = flashSignaturesSchema.parse(sig);
  if (Boolean(quoteRequest.attachedBracket) !== Boolean(s.bracket))
    throw new Error("Bracket signature does not match the quoted order.");
  const body: Record<string, unknown> = {
    ...quoteRequest,
    quoteId: s.quoteId,
    userSignature: s.userSignature,
    evmOrderTypedData: s.evmOrderTypedData,
  };
  if (s.evmPermitTypedData && s.evmPermitSignature) {
    body.evmPermitTypedData = s.evmPermitTypedData;
    body.evmPermitSignature = s.evmPermitSignature;
  }
  if (quoteRequest.attachedBracket && s.bracket) {
    const b: Record<string, unknown> = {
      ...quoteRequest.attachedBracket,
      userSignature: s.bracket.userSignature,
      salt: s.bracket.salt,
      deadline: s.bracket.deadline,
      signedMaxFromAmount: s.bracket.signedMaxFromAmount,
    };
    if (s.bracket.evmPermitTypedData && s.bracket.evmPermitSignature) {
      b.evmPermitTypedData = s.bracket.evmPermitTypedData;
      b.evmPermitSignature = s.bracket.evmPermitSignature;
    }
    body.attachedBracket = b;
  }
  return body;
}

export const flashOrderSchema = z
  .object({
    orderId: z.string(),
    orderType: z.string(),
    side: z.string(),
    status: z.string(),
    closeReason: z.string().nullable().optional(),
    targetAsset: z.string(),
    contraAsset: z.string(),
    qty: z.string(),
    filled: z.string().nullable().optional(),
    limitCrossPrice: z.string().nullable().optional(),
    limitNotionalPrice: z.string().nullable().optional(),
    attachedBracket: z
      .object({
        status: z.string(),
        bracketOrderId: z.string().nullable().optional(),
        takeProfit: z.object({ notionalPrice: z.string().nullable().optional() }).nullable().optional(),
        stopLoss: z.object({ notionalPrice: z.string().nullable().optional() }).nullable().optional(),
      })
      .nullable()
      .optional(),
    brackets: z.array(z.unknown()).nullable().optional(),
    sourceEntryOrderId: z.string().nullable().optional(),
    placedAt: z.string().nullable().optional(),
  })
  .passthrough();
export type FlashOrder = z.infer<typeof flashOrderSchema>;

export const OPEN_STATUSES = ["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED"];

export class FlashError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function flashClient(options: { apiKey?: string; fetcher?: typeof fetch } = {}) {
  const apiKey = options.apiKey || FLASH_PUBLIC_DEV_KEY;
  const fetcher = options.fetcher ?? fetch;

  async function call(path: string, init?: { method?: string; body?: unknown }) {
    const res = await fetcher(`${FLASH_API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json", "x-definitive-api-key": apiKey },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // fall through with the raw text
    }
    if (!res.ok) {
      const fromJson =
        json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : "";
      const msg: string = fromJson || text.slice(0, 200) || res.statusText;
      throw new FlashError(msg, res.status);
    }
    return json;
  }

  return {
    async quote(req: FlashQuoteRequest): Promise<FlashQuote> {
      return flashQuoteSchema.parse(await call("/quote", { method: "POST", body: req }));
    },
    async submit(body: Record<string, unknown>) {
      return z
        .object({ orderId: z.string(), attachedBracket: z.object({ status: z.string() }).nullable().optional() })
        .passthrough()
        .parse(await call("/order", { method: "POST", body }));
    },
    async listOrders(funderAddress: string, pageSize = 25): Promise<FlashOrder[]> {
      const q = new URLSearchParams({ funderAddress: String(address.parse(funderAddress)), pageSize: String(pageSize) });
      const res = z.object({ orders: z.array(flashOrderSchema) }).passthrough().parse(await call(`/orders?${q}`));
      return res.orders;
    },
  };
}
