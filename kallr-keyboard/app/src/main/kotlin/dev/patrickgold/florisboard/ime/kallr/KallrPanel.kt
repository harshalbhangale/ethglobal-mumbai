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
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.patrickgold.florisboard.ime.ImeUiMode
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.florisboard.keyboardManager
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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

/** Flash spreads a TWAP over 5 minutes to 30 days. */
private const val TWAP_MIN = 5
private const val TWAP_MAX = 30 * 24 * 60

/** "10 min", "2 hours", "1 day 6 hours": any duration the AI or voice heard, not only the presets. */
internal fun twapLabel(minutes: Int): String {
    TWAPS.firstOrNull { it.first == minutes }?.let { return it.second }
    val d = minutes / 1440
    val h = minutes % 1440 / 60
    val m = minutes % 60
    return listOfNotNull(
        d.takeIf { it > 0 }?.let { if (it == 1) "1 day" else "$it days" },
        h.takeIf { it > 0 }?.let { if (it == 1) "1 hour" else "$it hours" },
        m.takeIf { it > 0 }?.let { "$it min" },
    ).joinToString(" ")
}

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

    /** A coin the AI or voice picked that isn't the copied call's coin. */
    var extraTrade by mutableStateOf<AmTrade?>(null)
    /** What the AI heard or read, shown on the Swap tab. */
    var aiNote by mutableStateOf<String?>(null)

    val symbol: String get() =
        (result?.trade?.takeIf { it.token == token } ?: extraTrade?.takeIf { it.token == token })?.symbol
            ?: if (token.startsWith("0x")) short(token) else token

    /** True while the row is asking Kallr about the copied message or typed order. */
    var loading by mutableStateOf(false)

    /** The clipboard or typed text the row last looked up, so coming back doesn't redo it and reset the panel. */
    var lastLookup: String? = null

    private var resumeTab: Tab? = null
    private var resumeUntil = 0L

    /** Reopen the panel on [tab] when the user comes back from one of Kallr's screens (sign-in, confirm, mic). */
    fun resumeOn(tab: Tab) {
        resumeTab = tab
        resumeUntil = System.currentTimeMillis() + 3 * 60_000
    }

    /** The tab to reopen on, once, if the user left the panel for a Kallr screen in the last three minutes. */
    fun takeResume(): Tab? {
        val t = resumeTab?.takeIf { System.currentTimeMillis() < resumeUntil }
        resumeTab = null
        return t
    }

    /** Fill the order from what the AI read in a message, typed words or voice. */
    fun apply(prefill: AmPrefill?, trade: AmTrade?) {
        trade?.let {
            if (it.token != result?.trade?.token) extraTrade = it
            token = it.token
        }
        prefill ?: return
        prefill.usd?.let { usd = if (it % 1.0 == 0.0) it.toInt().toString() else "%.2f".format(it) }
        when (prefill.kind) {
            "limit" -> { kind = Kind.Limit; prefill.limitPct?.let { limitPct = if (it > 0) -it else it } }
            "twap" -> { kind = Kind.Twap; prefill.twapMinutes?.let { twapMinutes = it.coerceIn(TWAP_MIN, TWAP_MAX) } }
            "swap" -> kind = Kind.Swap
        }
        if (prefill.tpPct != null && prefill.slPct != null) {
            exits = Exits("TP ${prefill.tpPct.fmt()}% · SL ${prefill.slPct.fmt()}%", prefill.tpPct, prefill.slPct)
        }
    }
}

internal fun Double.fmt(): String = if (this % 1.0 == 0.0) toInt().toString() else toString()
internal fun short(a: String) = "${a.take(6)}…${a.takeLast(4)}"

/** The keyboard theme's text color, so the panel reads right on light and dark keyboard themes. */
@Composable
internal fun themeText(): Color = rememberSnyggThemeQuery("smartbar-candidate-word-text").foreground(default = Color(0xFF202124))

@Composable
internal fun Chip(label: String, selected: Boolean, onClick: () -> Unit) = FlowChip(label, selected, themeText(), onClick)

@Composable
private fun ChipRow(content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

/** A soft panel with a hairline that fades from Kallr blue to violet to nothing. */
@Composable
private fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .background(themeText().copy(alpha = 0.05f), shape)
            .border(1.dp, Brush.linearGradient(listOf(KallrBlue.copy(alpha = 0.45f), KallrViolet.copy(alpha = 0.25f), Color.Transparent)), shape)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        content = content,
    )
}

@Composable
private fun PrimaryButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    FlowButton(
        label,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
        enabled = enabled,
        height = 46.dp,
        disabledText = themeText().copy(alpha = 0.7f),
        onClick = onClick,
    )
}

@Composable
private fun FlashFooter() {
    Row(
        Modifier.fillMaxWidth().padding(bottom = 4.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Bolt, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp).flowTint())
        Spacer(Modifier.width(3.dp))
        Text("Powered by Flash · Definitive · on Base", fontSize = 11.sp, color = Muted)
    }
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
        // A moving line across the top: the panel is Kallr's, not the keyboard's.
        FlowLine(height = 2.dp)
        // Top bar: back to the keys, tabs, wallet.
        Row(
            Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(themeText().copy(alpha = 0.07f))
                    .pressable { keyboardManager.activeState.imeUiMode = ImeUiMode.TEXT }
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Keyboard, contentDescription = null, tint = themeText(), modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("ABC", color = themeText(), fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
            Spacer(Modifier.width(8.dp))
            TabBar(Modifier.weight(1f))
            Spacer(Modifier.width(4.dp))
            if (wallet != null) PulseDot(KallrMint, dot = 7.dp) else Box(Modifier.padding(5.dp).size(7.dp).background(Muted, CircleShape))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AnimatedContent(
                targetState = s.tab,
                transitionSpec = {
                    val dir = if (targetState.ordinal > initialState.ordinal) 1 else -1
                    (slideInHorizontally(tween(220)) { it / 6 * dir } + fadeIn(tween(220))) togetherWith
                        (slideOutHorizontally(tween(180)) { -it / 6 * dir } + fadeOut(tween(160)))
                },
                label = "kallr-tab",
            ) { tab ->
                when (tab) {
                    Tab.Swap -> SwapTab(wallet)
                    Tab.Positions -> PositionsTab(wallet)
                    Tab.Wallet -> WalletTab(wallet)
                }
            }
        }
    }
}

/** Segmented tabs; the selected one is a moving gradient that springs across when you switch. */
@Composable
private fun TabBar(modifier: Modifier = Modifier) {
    val s = KallrPanelState
    BoxWithConstraints(
        modifier
            .height(36.dp)
            .background(themeText().copy(alpha = 0.07f), RoundedCornerShape(12.dp))
            .padding(3.dp),
    ) {
        val w = maxWidth / Tab.entries.size
        val x by animateDpAsState(
            targetValue = w * s.tab.ordinal,
            animationSpec = spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow),
            label = "kallr-tab-indicator",
        )
        Box(
            Modifier
                .offset(x = x)
                .width(w)
                .fillMaxHeight()
                .shadow(6.dp, RoundedCornerShape(9.dp), ambientColor = KallrViolet, spotColor = KallrBlue)
                .flowBackground(RoundedCornerShape(9.dp)),
        )
        Row(Modifier.fillMaxSize()) {
            Tab.entries.forEach { t ->
                val color by animateColorAsState(if (s.tab == t) Color.White else themeText(), tween(200), label = "kallr-tab-text")
                Box(
                    Modifier.weight(1f).fillMaxHeight().pressable { s.tab = t },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(t.label, color = color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
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
    // Everything above the button scrolls; the button stays in reach on every phone size.
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            // The call you copied, or how to bring one in.
            Card {
                r?.fake?.let { f ->
                    Text(
                        "Fake \$${f.claimed} contract, not the real one (real: ${short(f.real)}). No buy for it.",
                        color = Danger, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 2,
                    )
                }
                if (r?.call == null) r?.ai?.summary?.let {
                    Text(it, color = themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                s.aiNote?.let { Text(it, color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
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
                    r?.ai != null || s.aiNote != null -> {}
                    else -> Text(
                        "Copy an X link or a \$TICKER message, or hold the mic.",
                        color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            MicButton()
            ChipRow {
                trade?.takeIf { it.token != "ETH" && it.token != "BTC" }?.let { t -> Chip("$${t.symbol}", s.token == t.token) { s.token = t.token } }
                s.extraTrade?.takeIf { it.token != "ETH" && it.token != "BTC" && it.token != trade?.token }?.let { t ->
                    Chip("$${t.symbol}", s.token == t.token) { s.token = t.token }
                }
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
                        if (TWAPS.none { it.first == s.twapMinutes }) Chip(twapLabel(s.twapMinutes), true) {}
                    }
                    Kind.Swap -> {}
                }
            }
            ChipRow {
                EXITS.forEach { e -> Chip(e.label, s.exits.label == e.label) { s.exits = e } }
                if (EXITS.none { it.label == s.exits.label }) Chip(s.exits.label, true) {}
            }
        }
        val what = when (s.kind) {
            Kind.Swap -> "Buy $${s.usd} of ${s.symbol}"
            Kind.Limit -> "Limit buy $${s.usd} of ${s.symbol} at ${s.limitPct.fmt()}%"
            Kind.Twap -> "Buy $${s.usd} of ${s.symbol} over ${twapLabel(s.twapMinutes)}"
        }
        // A fake contract or a risky token on screen means no Buy button next to it, whatever coin is selected.
        val blocked = when {
            r?.fake != null -> "No buy: fake \$${r.fake.claimed} contract"
            r?.token?.warnings?.isNotEmpty() == true -> "No buy: risky token"
            else -> null
        }
        PrimaryButton(blocked ?: if (wallet == null) "Sign in to trade" else what, enabled = blocked == null) {
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

/** Hold to speak an order ("buy twenty dollars of degen, take profit ten percent"); let go to send. */
@Composable
private fun MicButton() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("Hold to say an order") }
    var listening by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .then(if (listening) Modifier.flowBackground(shape, durationMs = 1800) else Modifier.background(themeText().copy(alpha = 0.05f), shape))
            .pointerInput(Unit) {
                detectTapGestures(onPress = {
                    if (!KallrVoice.start(context)) {
                        status = "Allow the microphone, then hold again"
                        return@detectTapGestures
                    }
                    listening = true
                    status = "Listening… let go to send"
                    tryAwaitRelease()
                    listening = false
                    val audio = KallrVoice.stop()
                    if (audio == null) {
                        status = "Too short. Hold and speak."
                        return@detectTapGestures
                    }
                    status = "Thinking…"
                    scope.launch {
                        Kallr.voice(audio).fold(
                            onSuccess = { v ->
                                KallrPanelState.apply(v.prefill, v.trade)
                                KallrPanelState.aiNote = "You said: \"${v.transcript}\""
                                status = "Hold to say another"
                            },
                            onFailure = { status = it.message ?: "Voice failed" },
                        )
                    }
                })
            }
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(28.dp).then(if (listening) Modifier.background(Color.White.copy(alpha = 0.2f), CircleShape) else Modifier.flowBackground(CircleShape)),
            contentAlignment = Alignment.Center,
        ) {
            if (listening) ListeningBars() else Icon(Icons.Default.Mic, contentDescription = "Speak an order", tint = Color.White, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(
            status,
            color = if (listening) Color.White else themeText(),
            fontSize = 13.sp,
            fontWeight = if (listening) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
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

/** Working orders pulse in Kallr blue; filled ones are mint; rejected ones red. */
@Composable
private fun StatusPill(p: Position) {
    val color = when {
        p.open -> KallrBlue
        p.status == "Filled" -> KallrMint
        p.status == "Rejected" -> Danger
        else -> Muted
    }
    Row(
        Modifier.background(color.copy(alpha = 0.14f), RoundedCornerShape(50)).padding(start = 2.dp, end = 9.dp, top = 1.dp, bottom = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (p.open) PulseDot(color, dot = 6.dp) else Box(Modifier.padding(6.dp).size(6.dp).background(color, CircleShape))
        Text(p.status, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
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
    // Numbers in the brand gradient; lighter stops on a dark keyboard so they stay readable.
    val numbers = if (themeText().luminance() > 0.5f) Brush.linearGradient(listOf(Color(0xFF7AB2FF), Color(0xFFB79CFF))) else BrandBrush
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            "USDC" to (balances?.first?.toDoubleOrNull()?.let { "%.2f".format(it) } ?: "…"),
            "ETH for gas" to (balances?.second?.toDoubleOrNull()?.let { "%.5f".format(it) } ?: "…"),
        ).forEach { (label, value) ->
            Column(
                Modifier
                    .weight(1f)
                    .background(themeText().copy(alpha = 0.05f), RoundedCornerShape(14.dp))
                    .border(1.dp, Brush.linearGradient(listOf(KallrBlue.copy(alpha = 0.4f), Color.Transparent)), RoundedCornerShape(14.dp))
                    .shimmer(balances == null)
                    .padding(horizontal = 12.dp, vertical = 9.dp),
            ) {
                Text(label, color = Muted, fontSize = 11.sp)
                Text(value, style = TextStyle(brush = numbers, fontSize = 19.sp, fontWeight = FontWeight.SemiBold))
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
                        StatusPill(p)
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
