import { readCall, transcribe } from "@/lib/server/ai";
import { tradeTokenForSymbol } from "@/lib/server/keyboard-tokens";

/**
 * Hold-to-talk orders from the keyboard: "buy twenty dollars of degen, take profit ten percent".
 * The audio goes to ElevenLabs Scribe for the words, the AI layer turns them into an order, and
 * the keyboard fills its trade panel. Nothing trades here: the user still confirms and signs.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "audio/mp4";
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength < 500) return Response.json({ error: "That was too short. Hold the mic and speak." }, { status: 400 });
    if (bytes.byteLength > MAX_BYTES) return Response.json({ error: "Keep it under a minute." }, { status: 413 });
    const transcript = await transcribe(new Blob([bytes], { type }), type.includes("wav") ? "order.wav" : "order.m4a");
    if (!transcript) return Response.json({ error: "Couldn't hear an order. Try again." }, { status: 422 });
    const read = await readCall(transcript);
    const trade = read?.symbol ? await tradeTokenForSymbol(read.symbol).catch(() => null) : null;
    return Response.json({
      transcript,
      summary: read?.summary ?? transcript,
      prefill: read?.order ?? null,
      trade,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Voice failed" }, { status: 500 });
  }
}
