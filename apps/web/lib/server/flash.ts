import "server-only";
import { flashClient } from "@aftermarkets/integrations/definitive";

/** One Flash client per server process. DEFINITIVE_API_KEY falls back to Definitive's public dev key. */
export const flash = flashClient({ apiKey: process.env.DEFINITIVE_API_KEY });

export function errorResponse(err: unknown) {
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
  const issues = (err as { issues?: { message: string }[] })?.issues;
  const message = issues?.length ? issues.map((i) => i.message).join(" ") : err instanceof Error ? err.message : "Flash request failed";
  return Response.json({ error: message }, { status: issues ? 400 : status >= 400 && status < 600 ? status : 500 });
}
