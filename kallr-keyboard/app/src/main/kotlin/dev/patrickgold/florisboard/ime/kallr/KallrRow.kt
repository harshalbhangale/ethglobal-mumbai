/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * A slim suggestion above the toolbar, only when there's something to trade: a call you copied
 * (X post link, or a $TICKER message from Telegram), a shared contract (token check), or an order
 * being typed ("copy $20 of btc tp 20% sl 10%"). Tapping it opens the Kallr trading panel with the
 * order filled in. The Trade button in the toolbar opens the panel any time.
 */

package dev.patrickgold.florisboard.ime.kallr

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.patrickgold.florisboard.clipboardManager
import dev.patrickgold.florisboard.editorInstance
import dev.patrickgold.florisboard.ime.ImeUiMode
import dev.patrickgold.florisboard.ime.editor.InputAttributes
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.smartbar.VerticalEnterTransition
import dev.patrickgold.florisboard.ime.smartbar.VerticalExitTransition
import dev.patrickgold.florisboard.keyboardManager
import kotlinx.coroutines.delay

private val HIDDEN_VARIATIONS = setOf(
    InputAttributes.Variation.PASSWORD,
    InputAttributes.Variation.VISIBLE_PASSWORD,
    InputAttributes.Variation.WEB_PASSWORD,
)

/** "copy $20 of btc tp 20% sl 10%" typed in the chat fills the panel. */
private val TYPED_USD = Regex("""\$\s*(\d+(?:\.\d+)?)""")
private val TYPED_TOKEN = Regex("""\bof\s+\$?(eth|btc)\b""", RegexOption.IGNORE_CASE)
private val TYPED_TP = Regex("""\btp\s*(\d+(?:\.\d+)?)\s*%""", RegexOption.IGNORE_CASE)
private val TYPED_SL = Regex("""\bsl\s*(\d+(?:\.\d+)?)\s*%""", RegexOption.IGNORE_CASE)

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

    // Never look at password fields or incognito typing, and show nothing there.
    val quiet = state.isIncognitoMode || editorInfo.inputAttributes.variation in HIDDEN_VARIATIONS
    if (quiet) return

    val reference = Kallr.clipboardReference(content.selectedText) ?: Kallr.clipboardReference(clip?.text)
    val typed = Kallr.typedOrder(content.textBeforeSelection)
    val s = KallrPanelState

    LaunchedEffect(reference, typed) {
        if (reference == null && typed == null) {
            s.result = null
            s.lastLookup = null
            return@LaunchedEffect
        }
        // Back from the confirm sheet or sign-in with the same clipboard: keep the panel as the user left it.
        val key = "$reference\u0000$typed"
        if (key == s.lastLookup && s.result != null) return@LaunchedEffect
        delay(400) // wait for typing to settle
        s.loading = true
        val r = try {
            Kallr.lookup(context, reference, typed)
        } finally {
            s.loading = false
        }
        s.result = r
        if (r != null) s.lastLookup = key
        s.aiNote = null
        s.extraTrade = null
        // A new message starts from its own coin, never the last one's (or ETH when it has none we can buy).
        s.token = r?.trade?.token ?: "ETH"
        val named = (r?.call?.asset ?: r?.ai?.symbol)?.uppercase()
        if (r != null && r.trade == null && r.fake == null && r.token == null && named != null && named != "ETH" && named != "BTC") {
            s.aiNote = "Couldn't find a liquid \$$named on Base, so this is set to ETH."
        }
        // The AI's read of the message or typed words ("buy 20 bucks of degen if it dips 10%").
        r?.prefill?.let { s.apply(it, null) }
        typed?.let { t ->
            TYPED_USD.find(t)?.groupValues?.get(1)?.let { s.usd = it }
            TYPED_TOKEN.find(t)?.groupValues?.get(1)?.let { s.token = it.uppercase() }
            val tp = TYPED_TP.find(t)?.groupValues?.get(1)?.toDoubleOrNull()
            val sl = TYPED_SL.find(t)?.groupValues?.get(1)?.toDoubleOrNull()
            if (tp != null && sl != null) s.exits = Exits("TP ${tp.fmt()}% · SL ${sl.fmt()}%", tp, sl)
        }
    }

    val r = s.result
    val fake = r?.fake
    val warning = fake?.let { "Fake \$${it.claimed} contract: not the real one. Don't buy it." } ?: r?.token?.warnings?.firstOrNull()
    val headline = when {
        fake != null -> warning
        warning != null -> "${r?.token?.symbol ?: "Token"}: $warning"
        // No direction means the AI read it as a joke, a question or commentary, not a call.
        r?.call == null && r?.ai != null && r.ai.direction == null -> r.ai.summary
        r?.call == null && r?.ai != null -> "Trade it · ${r.ai.summary}"
        r?.call != null -> "Trade @${r.post?.handle ?: "this"}'s call · ${r.call.line}"
        r?.post != null && r.trade != null -> "Trade @${r.post.handle}'s $${r.trade.symbol} call"
        r?.post != null -> "@${r.post.handle}: not a call we can price"
        s.loading && reference != null -> "Reading what you copied…"
        s.loading && typed != null -> "Reading your order…"
        typed != null -> "Trade it: $typed"
        else -> null
    }
    val shape = RoundedCornerShape(12.dp)

    AnimatedVisibility(visible = headline != null, enter = VerticalEnterTransition, exit = VerticalExitTransition) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(FlorisImeSizing.smartbarHeight)
                .padding(horizontal = 8.dp, vertical = 4.dp)
                .clip(shape)
                .background(themeText().copy(alpha = 0.06f))
                // A warning gets a still red edge; a call gets the moving Kallr gradient.
                .then(if (warning != null) Modifier.border(1.dp, Danger.copy(alpha = 0.6f), shape) else Modifier.flowBorder(1.5.dp, shape))
                .shimmer(s.loading)
                .pressable {
                    s.tab = Tab.Swap
                    keyboardManager.activeState.imeUiMode = ImeUiMode.KALLR
                }
                .padding(start = 12.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    headline ?: "",
                    color = if (warning != null) Danger else themeText(),
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                r?.record?.line?.let { Text(it, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            // A warning opens the panel to explain it; it never offers "Trade" next to a fake contract.
            Box(
                Modifier
                    .then(if (warning != null) Modifier.background(Danger, RoundedCornerShape(50)) else Modifier.flowBackground(RoundedCornerShape(50)))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            ) { Text(if (warning != null) "Why?" else "Trade", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
        }
    }
}
