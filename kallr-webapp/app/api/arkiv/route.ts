import { ARKIV_CHAIN_ID, ARKIV_EXPLORER } from "@kallr/integrations/arkiv";
import { arkivWriterAddress } from "@/lib/server/arkiv";

/**
 * Where Kallr data lives on Arkiv. The dashboard reads Arkiv directly from the browser
 * and only trusts entities this writer created.
 */
export function GET() {
  return Response.json({
    writer: arkivWriterAddress,
    chainId: ARKIV_CHAIN_ID,
    explorer: ARKIV_EXPLORER,
    // A public read key, locked to our site in the Arkiv Hub; empty means the rate-limited public RPC.
    accessKey: process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ?? "",
  });
}
