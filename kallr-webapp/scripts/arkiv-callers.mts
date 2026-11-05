/**
 * Writes Kallr's tracked-caller roster to Arkiv (testnet Rabdi): one `kallr.tracked-callers`
 * entity per handle in TRACKED_CALLERS, skipping handles already on Arkiv. Safe to re-run.
 *
 *   npm run arkiv:callers -w kallr-webapp            (reads ARKIV_PRIVATE_KEY from .env.local)
 *   npm run arkiv:callers -w kallr-webapp -- --check (read-only: print what Arkiv has)
 */
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { u64 } from "@arkiv-network/sdk/schema";
import { arkivPublic, readTrackedCallers, TRACKED_CALLERS, TrackedCallers } from "@kallr/integrations/arkiv";
import { formatEther, type Hex, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const key = process.env.ARKIV_PRIVATE_KEY;
if (!key || !isHex(key)) throw new Error("ARKIV_PRIVATE_KEY is missing from kallr-webapp/.env.local");
const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";
const account = privateKeyToAccount(key);
const reader = arkivPublic(accessKey);
const writer: Hex = account.address;

const onArkiv = async () => new Set((await readTrackedCallers(reader, writer)).map((e) => String(e.handle.value)));
const have = await onArkiv();
console.log(`Writer ${writer}: ${have.size} tracked callers on Arkiv`);

if (!process.argv.includes("--check")) {
  const balance = await reader.getBalance({ address: writer });
  if (balance === 0n) throw new Error(`Writer has no tGLM. Fund ${writer} at https://hub.arkiv.network/faucet`);
  console.log(`Gas: ${formatEther(balance)} tGLM`);
  const wallet = createWalletClient({ chain: rabdi({ accessKey }), transport: http(), account });
  const now = Math.floor(Date.now() / 1000);
  for (const c of TRACKED_CALLERS) {
    if (have.has(c.handle)) continue;
    const { entityKey } = await wallet.createEntity(
      TrackedCallers,
      { handle: c.handle, focus: c.focus, addedAt: u64(BigInt(now)) },
      { expiration: ExpirationTime.max(), flags: { readonly: true } },
    );
    console.log(`+ @${c.handle} ${entityKey}`);
  }
  console.log(`Now ${(await onArkiv()).size} tracked callers on Arkiv`);
}
console.log(`Query: arkiv.schema = str('kallr.tracked-callers') AND $creator = addr(${writer})`);
