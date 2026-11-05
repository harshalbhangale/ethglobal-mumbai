import "server-only";

/**
 * Kallr's AI layer for the keyboard. Server-side only: the OpenAI and ElevenLabs keys never ship in
 * the APK. It reads a short message (a post, a Telegram message, a spoken order) and returns the
 * coin, contract, direction, timeframe and any order in it, using only what the text says. Prices,
 * records and safety come from our own tools afterwards, never from the model.
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = "gpt-4.1-mini";

export type CallRead = {
  isCall: boolean;
  symbol: string | null;
  contract: string | null;
  chain: string | null;
  direction: "up" | "down" | null;
  timeframe: string | null;
  order: {
    kind: "swap" | "limit" | "twap" | null;
    usd: number | null;
    limitPct: number | null;
    twapMinutes: number | null;
    tpPct: number | null;
    slPct: number | null;
  } | null;
  summary: string;
};

const nullable = (type: string) => ({ type: [type, "null"] });

const SCHEMA = {
  name: "call_read",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["isCall", "symbol", "contract", "chain", "direction", "timeframe", "order", "summary"],
    properties: {
      isCall: { type: "boolean", description: "True when the text recommends buying or selling a specific crypto asset." },
      symbol: { ...nullable("string"), description: "Ticker without $, uppercase, e.g. PEPE. Null if none." },
      contract: { ...nullable("string"), description: "A 0x… contract address copied exactly from the text. Never invent one." },
      chain: { ...nullable("string"), description: "Chain named in the text, lowercase (base, ethereum, solana), or null." },
      direction: { type: ["string", "null"], enum: ["up", "down", null] },
      timeframe: { ...nullable("string"), description: "Timeframe as written, e.g. 'by Friday', '2 weeks', or null." },
      order: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["kind", "usd", "limitPct", "twapMinutes", "tpPct", "slPct"],
        description: "Only when the text is an instruction to trade (e.g. 'buy 20 bucks if it dips 10%').",
        properties: {
          kind: { type: ["string", "null"], enum: ["swap", "limit", "twap", null], description: "limit when buying on a dip, twap when spreading over time, else swap." },
          usd: { ...nullable("number"), description: "Dollars to spend." },
          limitPct: { ...nullable("number"), description: "For a dip buy: negative percent from now, e.g. -10." },
          twapMinutes: { ...nullable("integer"), description: "For twap: minutes to spread over." },
          tpPct: { ...nullable("number"), description: "Take-profit percent, positive." },
          slPct: { ...nullable("number"), description: "Stop-loss percent, positive." },
        },
      },
      summary: { type: "string", description: "One plain line, max 90 characters, e.g. '$PEPE bullish by Friday, 5x target'." },
    },
  },
} as const;

const SYSTEM = `You read short crypto messages from X posts, Telegram chats or spoken orders and extract structured fields.
Only use what the text says. Never invent a contract address, price or timeframe. Tickers are uppercase without $.
"ape", "send it", "long", "buying", "moon" mean up; "short", "dump", "sell", "rug" mean down.
Fill "order" only when the text is an instruction to trade ("buy $20 of this", "get me 50 bucks of degen if it dips 10%").
Spoken orders come from speech-to-text, which can turn filler words into coin names ("20 dollars ADA DEGEN" was "20 dollars of a DEGEN").
When an order names two coins, the one right before the price or condition is usually meant; never trade two coins from one order.`;

export const aiEnabled = Boolean(OPENAI_KEY);

const cache = new Map<string, { at: number; read: CallRead }>();

export async function readCall(text: string): Promise<CallRead | null> {
  if (!OPENAI_KEY) return null;
  const input = text.trim().slice(0, 1200);
  if (!input) return null;
  const hit = cache.get(input);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.read;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_schema", json_schema: SCHEMA },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: input },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`AI read failed (${res.status})`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const read = JSON.parse(body.choices?.[0]?.message?.content ?? "null") as CallRead | null;
  if (!read) return null;
  // Belt and braces: a contract must literally appear in the input.
  if (read.contract && !input.toLowerCase().includes(read.contract.toLowerCase())) read.contract = null;
  if (read.symbol) read.symbol = read.symbol.replace(/^\$/, "").toUpperCase();
  if (cache.size > 500) cache.clear();
  cache.set(input, { at: Date.now(), read });
  return read;
}

/** Coin and order words spoken orders use; under 100 so short clips aren't billed at a 20s minimum. */
const KEYTERMS = [
  "ETH", "BTC", "USDC", "DEGEN", "PEPE", "BRETT", "TOSHI", "AERO", "VIRTUAL", "MOG", "HIGHER", "KEYCAT",
  "WETH", "cbBTC", "Base", "Kallr", "take profit", "stop loss", "limit order", "TWAP", "buy the dip", "dollars",
]

/** Speech to text with ElevenLabs Scribe; OpenAI transcription if ElevenLabs isn't available. */
export async function transcribe(audio: Blob, filename = "order.m4a"): Promise<string> {
  if (ELEVENLABS_KEY) {
    const form = new FormData();
    form.append("model_id", "scribe_v2");
    // Bias Scribe toward coin names and order words ("degen", not "a day gain").
    for (const term of KEYTERMS) form.append("keyterms", term);
    form.append("file", audio, filename);
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_KEY },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { text?: string };
      if (body.text?.trim()) return body.text.trim();
    }
  }
  if (!OPENAI_KEY) throw new Error("Voice isn't set up on this server.");
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", audio, filename);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Couldn't hear that (${res.status}).`);
  return ((await res.json()) as { text?: string }).text?.trim() ?? "";
}
