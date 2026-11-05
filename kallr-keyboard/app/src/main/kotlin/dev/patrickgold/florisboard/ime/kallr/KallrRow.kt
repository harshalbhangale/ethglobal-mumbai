/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * The Kallr panel above FlorisBoard's Smartbar. A header shows the call you copied (X post link or a
 * $TICKER message from Telegram), the caller's record and your wallet. "Trade" opens order options:
 * token, Swap / Limit / TWAP, amount and TP/SL, then Buy opens the confirm sheet, which signs with
 * your embedded wallet and places the order on Flash. A shared contract gets a token check and no
 * Buy for it.
 */

package dev.patrickgold.florisboard.ime.kallr

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.patrickgold.florisboard.clipboardManager
import dev.patrickgold.florisboard.editorInstance
import dev.patrickgold.florisboard.ime.editor.InputAttributes
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.smartbar.VerticalEnterTransition
import dev.patrickgold.florisboard.ime.smartbar.VerticalExitTransition
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.florisboard.keyboardManager
import kotlinx.coroutines.delay
import org.florisboard.lib.snygg.ui.SnyggColumn
import org.florisboard.lib.snygg.ui.rememberSnyggThemeQuery

private val HIDDEN_VARIATIONS = setOf(
    InputAttributes.Variation.PASSWORD,
    InputAttributes.Variation.VISIBLE_PASSWORD,
    InputAttributes.Variation.WEB_PASSWORD,
)

private const val TEXT = "smartbar-candidate-word-text"
private val Muted = Color(0x80888888)
private val Danger = Color(0xFFE5484D)

private enum class Kind(val label: String, val api: String) { Swap("Swap", "swap"), Limit("Limit", "limit"), Twap("TWAP", "twap") }
private data class Exits(val label: String, val tp: Double?, val sl: Double?)
private val EXITS = listOf(Exits("No exits", null, null), Exits("TP 10% · SL 5%", 10.0, 5.0), Exits("TP 20% · SL 10%", 20.0, 10.0))
private val AMOUNTS = listOf("1", "5", "20")
private val LIMITS = listOf(-3.0, -5.0, -10.0)
private val TWAPS = listOf(10 to "10 min", 60 to "1 hour", 240 to "4 hours")

/** "copy $5 tp 10% sl 5%" typed in the chat pre-fills the panel. */
private val TYPED_USD = Regex("""\$\s*(\d+(?:\.\d+)?)""")
private val TYPED_TP = Regex("""\btp\s*(\d+(?:\.\d+)?)\s*%""", RegexOption.IGNORE_CASE)
private val TYPED_SL = Regex("""\bsl\s*(\d+(?:\.\d+)?)\s*%""", RegexOption.IGNORE_CASE)

/** The keyboard theme's text color, so the panel reads right on light and dark keyboard themes. */
@Composable
private fun themeText(): Color = rememberSnyggThemeQuery(TEXT).foreground(default = Color(0xFF202124))

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier
            .padding(end = 6.dp)
            .then(if (selected) Modifier.background(KallrBlue, shape) else Modifier.border(1.dp, Muted, shape))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, color = if (selected) Color.White else themeText(), fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ChipRow(content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

@Composable
fun KallrRow() {
    val context = LocalContext.current
    val clipboardManager by context.clipboardManager()
    val editorInstance by context.editorInstance()
    val keyboardManager by context.keyboardManager()

    val state by keyboardManager.activeState.collectAsState()
    val editorInfo by editorInstance.activeInfoFlow.collectAsState()
    val content by editorInstance.activeContentFlow.collectAsState()
    val clip by clipboardManager.primaryClipFlow.collectAsState()
    val wallet by KallrWallet.address.collectAsState()

    // Never look at password fields or incognito typing, and show nothing there.
    val quiet = state.isIncognitoMode || editorInfo.inputAttributes.variation in HIDDEN_VARIATIONS
    if (quiet) return

    val reference = Kallr.clipboardReference(content.selectedText) ?: Kallr.clipboardReference(clip?.text)
    val typed = Kallr.typedOrder(content.textBeforeSelection)

    var result by remember { mutableStateOf<AmResponse?>(null) }
    var expanded by remember { mutableStateOf(false) }
    var token by remember { mutableStateOf("ETH") }
    var kind by remember { mutableStateOf(Kind.Swap) }
    var usd by remember { mutableStateOf("5") }
    var limitPct by remember { mutableStateOf(-5.0) }
    var twapMinutes by remember { mutableStateOf(60) }
    var exits by remember { mutableStateOf(EXITS[1]) }

    LaunchedEffect(reference, typed) {
        if (reference == null && typed == null) {
            result = null
            return@LaunchedEffect
        }
        delay(400) // wait for typing to settle
        result = Kallr.lookup(context, reference, typed)
        result?.trade?.let { token = it.token }
        typed?.let { t ->
            TYPED_USD.find(t)?.groupValues?.get(1)?.let { usd = it }
            val tp = TYPED_TP.find(t)?.groupValues?.get(1)?.toDoubleOrNull()
            val sl = TYPED_SL.find(t)?.groupValues?.get(1)?.toDoubleOrNull()
            if (tp != null && sl != null) exits = Exits("TP ${tp.fmt()}% · SL ${sl.fmt()}%", tp, sl)
            expanded = true
        }
    }

    val r = result
    val trade = r?.trade
    val symbol = when (token) { trade?.token -> trade.symbol; else -> token }

    SnyggColumn(FlorisImeUi.Smartbar.elementName, modifier = Modifier.fillMaxWidth()) {
        // Header: Kallr, the call (or a hint), the wallet, and the Trade toggle.
        Row(
            Modifier.fillMaxWidth().height(FlorisImeSizing.smartbarHeight).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Kallr", fontWeight = FontWeight.Medium, fontSize = 14.sp, color = KallrBlue, modifier = Modifier.padding(end = 8.dp))
            Column(Modifier.weight(1f)) {
                val headline = when {
                    r?.call != null -> r.call.line
                    r?.token != null -> r.token.line
                    r?.post != null -> "@${r.post.handle}" + (trade?.let { " · $${it.symbol}" } ?: "")
                    else -> "Copy a call to trade it, or trade ETH and BTC"
                }
                Text(headline, color = themeText(), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = r?.record?.line ?: r?.token?.warnings?.firstOrNull()
                if (sub != null) Text(sub, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(
                wallet?.let { "${it.take(6)}…${it.takeLast(4)}" } ?: "Sign in",
                fontSize = 12.sp,
                color = KallrBlue,
                modifier = Modifier.clickable { KallrWalletActivity.open(context) }.padding(horizontal = 8.dp, vertical = 6.dp),
            )
            Box(
                Modifier.background(KallrBlue, RoundedCornerShape(50)).clickable { expanded = !expanded }.padding(horizontal = 12.dp, vertical = 6.dp),
            ) { Text(if (expanded) "Close" else "Trade", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium) }
        }

        AnimatedVisibility(visible = expanded, enter = VerticalEnterTransition, exit = VerticalExitTransition) {
            Column(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
                if (r?.token != null && r.token.warnings.isNotEmpty()) {
                    Text(
                        "${r.token.symbol ?: "This token"}: ${r.token.warnings.first()}. No buy for it.",
                        color = Danger,
                        fontSize = 12.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp),
                    )
                }
                ChipRow {
                    trade?.takeIf { it.token != "ETH" && it.token != "BTC" }?.let { t ->
                        Chip("$${t.symbol}", token == t.token) { token = t.token }
                    }
                    Chip("ETH", token == "ETH") { token = "ETH" }
                    Chip("BTC", token == "BTC") { token = "BTC" }
                    Spacer(Modifier.width(6.dp))
                    Kind.entries.forEach { k -> Chip(k.label, kind == k) { kind = k } }
                }
                ChipRow {
                    when (kind) {
                        Kind.Limit -> LIMITS.forEach { p -> Chip("${p.fmt()}%", limitPct == p) { limitPct = p } }
                        Kind.Twap -> TWAPS.forEach { (m, label) -> Chip(label, twapMinutes == m) { twapMinutes = m } }
                        Kind.Swap -> {}
                    }
                    if (kind != Kind.Swap) Spacer(Modifier.width(6.dp))
                    AMOUNTS.forEach { a -> Chip("$$a", usd == a) { usd = a } }
                    if (usd !in AMOUNTS) Chip("$$usd", true) {}
                }
                ChipRow {
                    EXITS.forEach { e -> Chip(e.label, exits.label == e.label) { exits = e } }
                    if (EXITS.none { it.label == exits.label }) Chip(exits.label, true) {}
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                        .background(KallrBlue, RoundedCornerShape(10.dp))
                        .clickable {
                            val order = KeyboardOrder(
                                token = token,
                                kind = kind.api,
                                usd = usd,
                                limitPct = if (kind == Kind.Limit) limitPct else null,
                                twapMinutes = if (kind == Kind.Twap) twapMinutes else null,
                                tpPct = exits.tp,
                                slPct = exits.sl,
                                postId = r?.post?.postId,
                                caller = r?.post?.handle,
                                symbol = symbol,
                            )
                            if (wallet == null) KallrWalletActivity.open(context) else KallrTradeActivity.open(context, order)
                        }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    val what = when (kind) {
                        Kind.Swap -> "Buy $$usd of $symbol"
                        Kind.Limit -> "Limit buy $$usd of $symbol at ${limitPct.fmt()}%"
                        Kind.Twap -> "Buy $$usd of $symbol over ${TWAPS.first { it.first == twapMinutes }.second}"
                    }
                    Text(if (wallet == null) "Sign in to trade" else what, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                }
                Text(
                    "Powered by Flash · Definitive · on Base",
                    fontSize = 11.sp,
                    color = Muted,
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
}

private fun Double.fmt(): String = if (this % 1.0 == 0.0) toInt().toString() else toString()
