/**
 * Compiles KallVerdicts.sol and deploys it to Base Sepolia, pointed at Chainlink's simulation forwarder
 * (MockKeystoneForwarder) so `cre workflow simulate --broadcast` can write to it.
 *
 *   node kall-cre/contracts/deploy.mjs            # uses CRE_ETH_PRIVATE_KEY from kall-cre/.env
 *   FORWARDER=0x... node kall-cre/contracts/deploy.mjs   # production KeystoneForwarder for a deployed workflow
 *
 * Needs `solc` (npm i --no-save solc@0.8.26) and a Base Sepolia balance for gas.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const require = createRequire(import.meta.url);
const solc = require("solc");
const here = new URL(".", import.meta.url).pathname;

// Base Sepolia MockKeystoneForwarder, from docs.chain.link/cre (Simulation Forwarders).
const FORWARDER = process.env.FORWARDER ?? "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5";

const env = readFileSync(`${here}../.env`, "utf8");
const key = env.match(/^CRE_ETH_PRIVATE_KEY=(\w+)/m)?.[1];
if (!key) throw new Error("CRE_ETH_PRIVATE_KEY missing in kall-cre/.env");
const account = privateKeyToAccount(`0x${key.replace(/^0x/, "")}`);

const input = {
  language: "Solidity",
  sources: { "KallVerdicts.sol": { content: readFileSync(`${here}src/KallVerdicts.sol`, "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
const c = out.contracts["KallVerdicts.sol"].KallVerdicts;

const transport = http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
const wallet = createWalletClient({ chain: baseSepolia, transport, account });
const pub = createPublicClient({ chain: baseSepolia, transport });

console.log(`Deploying KallVerdicts from ${account.address} with forwarder ${FORWARDER}…`);
const hash = await wallet.deployContract({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, args: [FORWARDER] });
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`KallVerdicts: ${receipt.contractAddress}`);
console.log(`https://sepolia.basescan.org/address/${receipt.contractAddress}`);
