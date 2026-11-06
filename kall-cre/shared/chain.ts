/** Chain reads and the signed verdict write, shared by both workflows. */
import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbiParameters, zeroAddress } from "viem";

export type ChainConfig = {
  readChain: string; // where coins live: ethereum-mainnet-base-1
  writeChain: string; // where verdicts go: ethereum-testnet-sepolia-base-1
  verdicts: string; // KallVerdicts address
  gasLimit: string;
};

const erc20 = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;

function client(chain: string) {
  const net = getNetwork({ chainFamily: "evm", chainSelectorName: chain });
  if (!net) throw new Error(`Unknown chain ${chain}`);
  return new EVMClient(net.chainSelector.selector);
}

/** The token's own symbol on Base, or "" when the address isn't a token. */
export function readSymbol(runtime: Runtime<ChainConfig>, token: `0x${string}`): string {
  try {
    const out = client(runtime.config.readChain)
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: token, data: encodeFunctionData({ abi: erc20, functionName: "symbol" }) }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();
    if (!out.data || out.data.length === 0) return "";
    return decodeFunctionResult({ abi: erc20, functionName: "symbol", data: bytesToHex(out.data) }) as string;
  } catch {
    return "";
  }
}

/** Has the DON sign `(kind, body)` and writes it to KallVerdicts. Kind 0 = coin check, 1 = call scores. */
export function writeVerdict(runtime: Runtime<ChainConfig>, kind: number, body: `0x${string}`): string {
  const report = runtime
    .report({
      encodedPayload: hexToBase64(encodeAbiParameters(parseAbiParameters("uint8, bytes"), [kind, body])),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();
  const res = client(runtime.config.writeChain)
    .writeReport(runtime, { receiver: runtime.config.verdicts, report, gasConfig: { gasLimit: runtime.config.gasLimit } })
    .result();
  const txHash = bytesToHex(res.txHash || new Uint8Array(32));
  runtime.log(
    /^0x0+$/.test(txHash)
      ? "Verdict signed (dry run: add --broadcast to write it on-chain)"
      : `Verdict written: https://sepolia.basescan.org/tx/${txHash}`,
  );
  return txHash;
}
