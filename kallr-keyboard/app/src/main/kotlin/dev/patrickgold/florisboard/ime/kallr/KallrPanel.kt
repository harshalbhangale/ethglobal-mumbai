/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * The Kallr trading panel. The Trade button in the toolbar (or "Trade this call" above the keys)
 * swaps the keys for this panel, the way the emoji button opens the emoji panel. ABC goes back to
 * typing. Tabs: Swap (the call, token, Swap / Limit / TWAP, amount, exits, Buy), Positions (your
 * Flash orders with status and exits, and balances) and Wallet (address, funding, sign-in).
 */

package dev.patrickgold.florisboard.ime.kallr

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.patrickgold.florisboard.ime.ImeUiMode
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.florisboard.keyboardManager
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.florisboard.lib.snygg.ui.SnyggColumn
import org.florisboard.lib.snygg.ui.rememberSnyggThemeQuery

internal val Muted = Color(0xFF8A8F98)
internal val Danger = Color(0xFFE5484D)
internal val Up = Color(0xFF18A058)

internal enum class Kind(val label: String, val api: String) { Swap("Swap", "swap"), Limit("Limit", "limit"), Twap("TWAP", "twap") }
internal data class Exits(val label: String, val tp: Double?, val sl: Double?)
internal val EXITS = listOf(Exits("No exits", null, null), Exits("TP 10% · SL 5%", 10.0, 5.0), Exits("TP 20% · SL 10%", 20.0, 10.0))
internal val AMOUNTS = listOf("1", "5", "20", "50")
internal val LIMITS = listOf(-3.0, -5.0, -10.0)
internal val TWAPS = listOf(10 to "10 min", 60 to "1 hour", 240 to "4 hours")

internal enum class Tab(val label: String) { Swap("Swap"), Positions("Positions"), Wallet("Wallet") }

/** What the suggestion row and the panel share: the call you copied and the order you're building. */
internal object KallrPanelState {
    var result by mutableStateOf<AmResponse?>(null)
    var tab by mutableStateOf(Tab.Swap)
    var token by mutableStateOf("ETH")
    var kind by mutableStateOf(Kind.Swap)
    var usd by mutableStateOf("5")
    var limitPct by mutableStateOf(-5.0)
    var twapMinutes by mutableIntStateOf(60)
    var exits by mutableStateOf(EXITS[1])

    val symbol: String get() = result?.trade?.takeIf { it.token == token }?.symbol ?: token
}

internal fun Double.fmt(): String = if (this % 1.0 == 0.0) toInt().toString() else toString()
internal fun short(a: String) = "${a.take(6)}…${a.takeLast(4)}"

/** The keyboard theme's text color, so the panel reads right on light and dark keyboard themes. */
@Composable
internal fun themeText(): Color = rememberSnyggThemeQuery("smartbar-candidate-word-text").foreground(default = Color(0xFF202124))

@Composable
internal fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier
            .padding(end = 6.dp)
            .then(if (selected) Modifier.background(KallrBlue, shape) else Modifier.border(1.dp, Muted.copy(alpha = 0.5f), shape))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, color = if (selected) Color.White else themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ChipRow(content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

@Composable
private fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .background(themeText().copy(alpha = 0.06f), RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        content = content,
    )
}

@Composable
private fun PrimaryButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .background(KallrBlue, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium) }
}

@Composable
private fun FlashFooter() {
    Text(
        "Powered by Flash · Definitive · on Base",
        fontSize = 11.sp,
        color = Muted,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 6.dp),
    )
}

@Composable
fun KallrInputLayout() {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()
    val wallet by KallrWallet.address.collectAsState()
    val s = KallrPanelState

    SnyggColumn(
        elementName = FlorisImeUi.Media.elementName,
        modifier = Modifier.fillMaxWidth().height(FlorisImeSizing.imeUiHeight()),
    ) {
        // Top bar: back to the keys, tabs, wallet.
        Row(
            Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .border(1.dp, Muted.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                    .clickable { keyboardManager.activeState.imeUiMode = ImeUiMode.TEXT }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) { Text("ABC", color = themeText(), fontWeight = FontWeight.Bold, fontSize = 13.sp) }
            Spacer(Modifier.width(8.dp))
            Row(
                Modifier.weight(1f).background(themeText().copy(alpha = 0.06f), RoundedCornerShape(10.dp)).padding(3.dp),
            ) {
                Tab.entries.forEach { t ->
                    val selected = s.tab == t
                    Box(
                        Modifier
                            .weight(1f)
                            .then(if (selected) Modifier.background(KallrBlue, RoundedCornerShape(8.dp)) else Modifier)
                            .clickable { s.tab = t }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(t.label, color = if (selected) Color.White else themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(8.dp).background(if (wallet != null) Up else Muted, CircleShape))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (s.tab) {
                Tab.Swap -> SwapTab(wallet)
                Tab.Positions -> PositionsTab(wallet)
                Tab.Wallet -> WalletTab(wallet)
            }
        }
    }
}

@Composable
private fun SwapTab(wallet: String?) {
    val context = LocalContext.current
    val s = KallrPanelState
    val r = s.result
    val trade = r?.trade
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // The call you copied, or how to bring one in.
        Card {
            when {
                r?.call != null || r?.post != null -> {
                    Text(
                        r.call?.line ?: "@${r.post!!.handle}" + (trade?.let { " · $${it.symbol}" } ?: ""),
                        color = themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    r.record?.line?.let { Text(it, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                r?.token != null -> {
                    Text(r.token.line, color = themeText(), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    r.token.warnings.firstOrNull()?.let { Text("$it. No buy for it.", color = Danger, fontSize = 12.sp, maxLines = 2) }
                }
                else -> Text(
                    "Copy a call (X link or a \$TICKER message) to trade it here, or pick ETH or BTC.",
                    color = Muted, fontSize = 12.sp,
                )
            }
        }
        ChipRow {
            trade?.takeIf { it.token != "ETH" && it.token != "BTC" }?.let { t -> Chip("$${t.symbol}", s.token == t.token) { s.token = t.token } }
            Chip("ETH", s.token == "ETH") { s.token = "ETH" }
            Chip("BTC", s.token == "BTC") { s.token = "BTC" }
            Spacer(Modifier.width(8.dp))
            Kind.entries.forEach { k -> Chip(k.label, s.kind == k) { s.kind = k } }
        }
        ChipRow {
            AMOUNTS.forEach { a -> Chip("$$a", s.usd == a) { s.usd = a } }
            if (s.usd !in AMOUNTS) Chip("$${s.usd}", true) {}
            when (s.kind) {
                Kind.Limit -> {
                    Spacer(Modifier.width(8.dp))
                    LIMITS.forEach { p -> Chip("${p.fmt()}%", s.limitPct == p) { s.limitPct = p } }
                }
                Kind.Twap -> {
                    Spacer(Modifier.width(8.dp))
                    TWAPS.forEach { (m, label) -> Chip(label, s.twapMinutes == m) { s.twapMinutes = m } }
                }
                Kind.Swap -> {}
            }
        }
        ChipRow {
            EXITS.forEach { e -> Chip(e.label, s.exits.label == e.label) { s.exits = e } }
            if (EXITS.none { it.label == s.exits.label }) Chip(s.exits.label, true) {}
        }
        val what = when (s.kind) {
            Kind.Swap -> "Buy $${s.usd} of ${s.symbol}"
            Kind.Limit -> "Limit buy $${s.usd} of ${s.symbol} at ${s.limitPct.fmt()}%"
            Kind.Twap -> "Buy $${s.usd} of ${s.symbol} over ${TWAPS.first { it.first == s.twapMinutes }.second}"
        }
        PrimaryButton(if (wallet == null) "Sign in to trade" else what) {
            if (wallet == null) {
                KallrWalletActivity.open(context)
            } else {
                KallrTradeActivity.open(
                    context,
                    KeyboardOrder(
                        token = s.token,
                        kind = s.kind.api,
                        usd = s.usd,
                        limitPct = if (s.kind == Kind.Limit) s.limitPct else null,
                        twapMinutes = if (s.kind == Kind.Twap) s.twapMinutes else null,
                        tpPct = s.exits.tp,
                        slPct = s.exits.sl,
                        postId = r?.post?.postId,
                        caller = r?.post?.handle,
                        symbol = s.symbol,
                    ),
                )
            }
        }
        FlashFooter()
    }
}

private val STATUS = mapOf(
    "ORDER_STATUS_PENDING" to "Pending",
    "ORDER_STATUS_ACCEPTED" to "Working",
    "ORDER_STATUS_PARTIALLY_FILLED" to "Partly filled",
    "ORDER_STATUS_FILLED" to "Filled",
    "ORDER_STATUS_CANCELLED" to "Cancelled",
    "ORDER_STATUS_REJECTED" to "Rejected",
    "ORDER_STATUS_TERMINATED" to "Ended",
)
private val EXIT_STATUS = mapOf("pending_activation" to "exits arm on fill", "active" to "exits armed", "never_activated" to "exits never armed")
private val KNOWN_ASSETS = mapOf(
    "0x4200000000000000000000000000000000000006" to "ETH",
    "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" to "BTC",
)

private data class Position(val title: String, val status: String, val exits: String?, val open: Boolean)

private fun JsonObject.str(key: String): String? =
    this[key]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }

private fun usd(v: String?): String? = v?.toDoubleOrNull()?.let {
    if (it >= 1) "$" + "%,.2f".format(it) else "$" + "%.6g".format(it)
}

private fun parsePositions(context: Context, text: String): List<Position> {
    val orders = Json.parseToJsonElement(text).jsonObject["orders"] as? JsonArray ?: return emptyList()
    return orders.mapNotNull { el ->
        val o = el as? JsonObject ?: return@mapNotNull null
        val id = o.str("orderId") ?: return@mapNotNull null
        val asset = o.str("targetAsset")?.lowercase()
        val symbol = KallrTrader.symbolFor(context, id) ?: KNOWN_ASSETS[asset] ?: asset?.let { short(it) } ?: "token"
        val qty = o.str("qty") ?: "?"
        val type = o.str("orderType") ?: "market"
        val title = when {
            type == "bracket" -> "Exit: sell $qty $symbol"
            o.str("side") == "buy" -> "${type.replaceFirstChar { it.uppercase() }} buy · $$qty of $symbol"
            else -> "${type.replaceFirstChar { it.uppercase() }} sell · $qty $symbol"
        }
        val status = o.str("status") ?: ""
        val bracket = o["attachedBracket"] as? JsonObject
        val tp = usd((bracket?.get("takeProfit") as? JsonObject)?.str("notionalPrice"))
        val sl = usd((bracket?.get("stopLoss") as? JsonObject)?.str("notionalPrice"))
        val exits = if (tp != null || sl != null) {
            listOfNotNull(tp?.let { "TP $it" }, sl?.let { "SL $it" }).joinToString(" · ") +
                (bracket?.str("status")?.let { " · ${EXIT_STATUS[it] ?: it}" } ?: "")
        } else null
        val open = status in setOf("ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED") ||
            bracket?.str("status") == "active"
        Position(title, STATUS[status] ?: status.removePrefix("ORDER_STATUS_").lowercase(), exits, open)
    }
}

@Composable
private fun Balances(wallet: String, refreshKey: Int) {
    var balances by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(wallet, refreshKey) {
        balances = Kallr.get("/api/keyboard/wallet?address=$wallet").getOrNull()?.let { text ->
            val o = Json.parseToJsonElement(text).jsonObject
            (o.str("usdc") ?: "0") to (o.str("eth") ?: "0")
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            "USDC" to (balances?.first?.toDoubleOrNull()?.let { "%.2f".format(it) } ?: "…"),
            "ETH for gas" to (balances?.second?.toDoubleOrNull()?.let { "%.5f".format(it) } ?: "…"),
        ).forEach { (label, value) ->
            Column(
                Modifier.weight(1f).background(themeText().copy(alpha = 0.06f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(label, color = Muted, fontSize = 11.sp)
                Text(value, color = themeText(), fontSize = 16.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun SignInPrompt(text: String) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(top = 8.dp)) {
        Card { Text(text, color = Muted, fontSize = 13.sp) }
        PrimaryButton("Sign in with X") { KallrWalletActivity.open(context) }
        FlashFooter()
    }
}

@Composable
private fun PositionsTab(wallet: String?) {
    val context = LocalContext.current
    if (wallet == null) return SignInPrompt("Sign in to see your open orders, exits and balances.")
    var refresh by remember { mutableIntStateOf(0) }
    var positions by remember { mutableStateOf<List<Position>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(wallet, refresh) {
        Kallr.get("/api/flash/orders?funder=$wallet").fold(
            onSuccess = { positions = parsePositions(context, it); error = null },
            onFailure = { error = it.message },
        )
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Balances(wallet, refresh)
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Your Flash orders", color = themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Icon(
                Icons.Default.Refresh, contentDescription = "Refresh", tint = KallrBlue,
                modifier = Modifier.size(22.dp).clickable { refresh++ },
            )
        }
        when {
            error != null -> Card { Text(error!!, color = Danger, fontSize = 12.sp) }
            positions == null -> Card { Text("Loading from Flash…", color = Muted, fontSize = 12.sp) }
            positions!!.isEmpty() -> Card {
                Text("No orders yet", color = themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Text("Buy from the Swap tab; it shows up here with its take-profit and stop-loss.", color = Muted, fontSize = 12.sp)
            }
            else -> positions!!.sortedByDescending { it.open }.take(12).forEach { p ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.title, color = themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            p.status,
                            color = if (p.open) KallrBlue else Muted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.border(1.dp, (if (p.open) KallrBlue else Muted).copy(alpha = 0.5f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                    p.exits?.let { Text(it, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
        FlashFooter()
    }
}

@Composable
private fun WalletTab(wallet: String?) {
    val context = LocalContext.current
    if (wallet == null) return SignInPrompt("Kallr trades from your Privy embedded wallet, the same one as the Kallr desk. Sign in with X once; the key stays with Privy.")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Card {
            Text("Embedded wallet on Base", color = Muted, fontSize = 11.sp)
            Text(wallet, color = themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Balances(wallet, 0)
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f)) {
                PrimaryButton("Copy address") {
                    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Kallr wallet", wallet))
                    Toast.makeText(context, "Address copied", Toast.LENGTH_SHORT).show()
                }
            }
            Box(Modifier.weight(1f)) { PrimaryButton("Manage") { KallrWalletActivity.open(context) } }
        }
        Text(
            "Fund it from MetaMask: send USDC and about \$1 of ETH on Base to this address.",
            color = Muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
        )
        FlashFooter()
    }
}
