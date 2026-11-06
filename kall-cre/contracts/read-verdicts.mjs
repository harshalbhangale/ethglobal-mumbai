/** Prints the coin verdicts CRE stored in KallVerdicts:  node kall-cre/contracts/read-verdicts.mjs <address> <token:TICKER>... */
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const [raw, ...pairs] = process.argv.slice(2);
const address = raw.toLowerCase();
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") });
const abi = parseAbi([
  "struct CoinCheck { address token; string claimed; string symbol; address canonical; uint8 verdict; uint64 checkedAt; }",
  "function coinCheck(address token, string claimed) view returns (CoinCheck)",
]);
const words = ["unknown", "real", "fake: wrong symbol", "fake: impostor", "fake: no token"];
for (const pair of pairs) {
  const [token, claimed] = pair.split(":");
  const c = await client.readContract({ address, abi, functionName: "coinCheck", args: [token, claimed] });
  console.log(`$${claimed} at ${token}: ${c.checkedAt ? `${words[c.verdict]} (contract says $${c.symbol})` : "not checked"}`);
}
