/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * Places a Flash order from the keyboard: quote (Kallr server) → approve only this order's amount →
 * sign with the embedded wallet → submit through /api/flash/order, tagged as a keyboard trade.
 * The same steps as the web desk (kallr-webapp/lib/flash-client.ts).
 */

package dev.patrickgold.florisboard.ime.kallr

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The keyboard's simple order; the server prices it into a Flash order (kallr-webapp/lib/keyboard-trade.ts). */
@Serializable
data class KeyboardOrder(
    val token: String,
    val kind: String,
    val usd: String,
    val limitPct: Double? = null,
    val twapMinutes: Int? = null,
    val tpPct: Double? = null,
    val slPct: Double? = null,
    val postId: String? = null,
    val caller: String? = null,
    val symbol: String? = null,
)

@Serializable
data class TradePreview(
    val title: String,
    val kind: String,
    val pay: String,
    val get: String,
    val exits: String,
    val approval: String,
)

/** A priced quote: the exact Flash order to echo back on submit, the raw quote to sign, and the preview. */
class TradeQuote(val order: JsonElement, val quote: JsonObject, val preview: TradePreview, val context: JsonElement)

object KallrTrader {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }

    enum class Step(val label: String) {
        Quoting("Getting a fresh quote…"),
        Approving("Approving this order's USDC…"),
        Signing("Signing the order…"),
        ApprovingExits("Approving the take-profit and stop-loss…"),
        SigningExits("Signing the take-profit and stop-loss…"),
        Submitting("Placing the order on Base…"),
    }

    suspend fun quote(order: KeyboardOrder, funder: String): Result<TradeQuote> {
        val body = json.encodeToJsonElement(KeyboardOrder.serializer(), order.copy(symbol = null)).jsonObject.toMutableMap()
        body["funder"] = kotlinx.serialization.json.JsonPrimitive(funder)
        body.remove("symbol")
        return Kallr.post("/api/keyboard/quote", JsonObject(body).toString()).mapCatching { text ->
            val res = json.parseToJsonElement(text).jsonObject
            TradeQuote(
                order = res["order"]!!,
                quote = res["quote"]!!.jsonObject,
                preview = json.decodeFromJsonElement(TradePreview.serializer(), res["preview"]!!),
                context = res["context"]!!,
            )
        }
    }

    private fun JsonObject.str(key: String): String? =
        this[key]?.takeUnless { it is kotlinx.serialization.json.JsonNull }?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }

    private fun JsonObject.obj(key: String): JsonObject? =
        this[key]?.takeUnless { it is kotlinx.serialization.json.JsonNull } as? JsonObject

    /** Signs and submits a fresh quote. Returns the Flash order ID. */
    suspend fun place(context: Context, order: KeyboardOrder, onStep: (Step) -> Unit): Result<String> = runCatching {
        val wallet = KallrWallet.wallet(context)
        onStep(Step.Quoting)
        val q = quote(order, wallet.address).getOrThrow()
        val quote = q.quote
        val evm = quote.obj("evm")!!

        evm.obj("approveTx")?.let { tx ->
            onStep(Step.Approving)
            KallrWallet.sendAndWait(wallet, tx.str("to")!!, tx.str("data")!!)
        }

        onStep(Step.Signing)
        val orderTypedData = evm.str("orderTypedData")!!
        val permitTypedData = evm.str("permitTypedData")
        val permitSignature = permitTypedData?.let { KallrWallet.signTypedData(wallet, it) }

        val pair = quote.obj("attachedBracket")
        pair?.obj("evm")?.obj("approveTx")?.let { tx ->
            onStep(Step.ApprovingExits)
            KallrWallet.sendAndWait(wallet, tx.str("to")!!, tx.str("data")!!)
        }

        onStep(Step.Signing)
        val userSignature = KallrWallet.signTypedData(wallet, orderTypedData)

        val bracket = pair?.let { p ->
            onStep(Step.SigningExits)
            val pEvm = p.obj("evm")!!
            val bracketPermit = pEvm.str("permitTypedData")
            buildJsonObject {
                put("userSignature", KallrWallet.signTypedData(wallet, pEvm.str("orderTypedData")!!))
                put("salt", p.str("salt")!!)
                put("deadline", p.str("deadline")!!)
                put("signedMaxFromAmount", p.str("signedMaxFromAmount")!!)
                if (bracketPermit != null) {
                    put("evmPermitTypedData", bracketPermit)
                    put("evmPermitSignature", KallrWallet.signTypedData(wallet, bracketPermit))
                }
            }
        }

        onStep(Step.Submitting)
        val signatures = buildJsonObject {
            put("quoteId", quote.str("quoteId")!!)
            put("userSignature", userSignature)
            put("evmOrderTypedData", orderTypedData)
            if (permitTypedData != null && permitSignature != null) {
                put("evmPermitTypedData", permitTypedData)
                put("evmPermitSignature", permitSignature)
            }
            if (bracket != null) put("bracket", bracket)
        }
        val submit = buildJsonObject {
            put("order", q.order)
            put("signatures", signatures)
            put("context", q.context)
        }
        val res = Kallr.post("/api/flash/order", submit.toString()).getOrThrow()
        json.parseToJsonElement(res).jsonObject.str("orderId") ?: error("Flash didn't return an order ID.")
    }

    fun encode(order: KeyboardOrder): String = json.encodeToString(order)
    fun decode(text: String): KeyboardOrder = json.decodeFromString(text)
}
