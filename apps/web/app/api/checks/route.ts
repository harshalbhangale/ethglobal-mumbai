import { checkCallerWallet, checkToken } from "@aftermarkets/integrations/safety-checks";
import { z } from "zod";

/**
 * Safety checks for a call: the token (GoPlus + Dexscreener, no key) and, when a wallet is
 * given, what that wallet did with the token around the post (Etherscan V2, ETHERSCAN_API_KEY).
 */
const bodySchema = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  wallet: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  postedAt: z.number().int().positive().optional(),
  direction: z.enum(["up", "down"]).default("up"),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { token, wallet, postedAt, direction } = parsed.data;
  const [tokenCheck, caller] = await Promise.all([
    checkToken(token),
    wallet && postedAt
      ? checkCallerWallet({ wallet, token, postedAt, direction }, { apiKey: process.env.ETHERSCAN_API_KEY })
      : Promise.resolve({ status: "unavailable" as const, reason: "No caller wallet linked" }),
  ]);
  return Response.json({ token: tokenCheck, caller });
}
