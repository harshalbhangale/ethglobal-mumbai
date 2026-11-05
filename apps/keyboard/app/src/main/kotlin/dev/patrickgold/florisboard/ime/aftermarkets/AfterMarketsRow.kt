/*
 * AfterMarkets addition to FlorisBoard (Apache-2.0).
 *
 * A row above FlorisBoard's Smartbar. Copy an X post link (Share → Copy link) and it shows
 * the call's after market and the caller's record. Type "copy $5 tp 10% sl 5%" and it
 * offers a link to the AfterMarkets desk, where the order is reviewed and signed. A shared
 * contract address gets a token check and no copy button.
 */

package dev.patrickgold.florisboard.ime.aftermarkets

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.patrickgold.florisboard.clipboardManager
import dev.patrickgold.florisboard.editorInstance
import dev.patrickgold.florisboard.ime.editor.InputAttributes
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.smartbar.VerticalEnterTransition
import dev.patrickgold.florisboard.ime.smartbar.VerticalExitTransition
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.florisboard.keyboardManager
import dev.patrickgold.florisboard.lib.util.launchUrl
import kotlinx.coroutines.delay
import org.florisboard.lib.snygg.ui.SnyggButton
import org.florisboard.lib.snygg.ui.SnyggRow
import org.florisboard.lib.snygg.ui.SnyggText
import java.net.URLEncoder

private val TRADABLE = setOf("ETH", "BTC")
private val HIDDEN_VARIATIONS = setOf(
    InputAttributes.Variation.PASSWORD,
    InputAttributes.Variation.VISIBLE_PASSWORD,
    InputAttributes.Variation.WEB_PASSWORD,
)

private const val WORD = "smartbar-candidate-word"

@Composable
fun AfterMarketsRow() {
    val context = LocalContext.current
    val clipboardManager by context.clipboardManager()
    val editorInstance by context.editorInstance()
    val keyboardManager by context.keyboardManager()

    val state by keyboardManager.activeState.collectAsState()
    val editorInfo by editorInstance.activeInfoFlow.collectAsState()
    val content by editorInstance.activeContentFlow.collectAsState()
    val clip by clipboardManager.primaryClipFlow.collectAsState()

    // Never look at password fields or incognito typing.
    val quiet = state.isIncognitoMode || editorInfo.inputAttributes.variation in HIDDEN_VARIATIONS
    val reference = if (quiet) null else {
        AfterMarkets.clipboardReference(content.selectedText) ?: AfterMarkets.clipboardReference(clip?.text)
    }
    val typed = if (quiet) null else AfterMarkets.typedOrder(content.textBeforeSelection)

    var result by remember { mutableStateOf<AmResponse?>(null) }
    LaunchedEffect(reference, typed) {
        if (reference == null && typed == null) {
            result = null
            return@LaunchedEffect
        }
        delay(400) // wait for typing to settle
        result = AfterMarkets.lookup(context, reference, typed)
    }

    val r = result
    AnimatedVisibility(
        visible = r != null && !r.isEmpty,
        enter = VerticalEnterTransition,
        exit = VerticalExitTransition,
    ) {
        if (r == null) return@AnimatedVisibility
        SnyggRow(
            elementName = FlorisImeUi.SmartbarCandidatesRow.elementName,
            modifier = Modifier
                .fillMaxWidth()
                .height(FlorisImeSizing.smartbarHeight)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Segment(primary = "AfterMarkets", secondary = null)
            r.order?.let { order ->
                if (order.ok && order.deskUrl != null && order.tradable) {
                    Segment(primary = "Sign in desk ↗", secondary = order.summary) { context.launchUrl(order.deskUrl) }
                } else if (order.ok) {
                    Segment(primary = order.summary ?: "Order", secondary = "Only ETH and BTC trade on Base for now")
                } else {
                    Segment(primary = "Order", secondary = order.error)
                }
            }
            r.token?.let { token ->
                Segment(primary = token.line, secondary = token.warnings.firstOrNull() ?: "GoPlus + Dexscreener")
            }
            r.call?.let { call ->
                Segment(primary = call.line, secondary = r.record?.let { "${it.line} (${it.coverage})" })
                val post = r.post
                // One-tap copy, like the extension's preset; never next to a shared contract.
                if (post != null && r.order == null && r.token == null && call.asset in TRADABLE) {
                    Segment(primary = "Copy $5 ↗", secondary = "TP 10% · SL 5%, sign in desk") {
                        context.launchUrl(deskUrl("copy \$5 of ${call.asset} tp 10% sl 5%", post))
                    }
                }
            }
            if (r.call == null && r.post != null) {
                Segment(primary = "@${r.post.handle}", secondary = "Not a call we can price")
            }
        }
    }
}

private fun deskUrl(order: String, post: AmPost): String {
    fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    return "${AfterMarkets.origin}/app?order=${enc(order)}&post=${enc(post.postId)}&caller=${enc(post.handle)}&src=keyboard"
}

@Composable
private fun Segment(primary: String, secondary: String?, onClick: (() -> Unit)? = null) {
    val body = @Composable {
        Column(
            modifier = Modifier.fillMaxHeight().padding(horizontal = 8.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            SnyggText(elementName = "$WORD-text", text = primary)
            if (secondary != null) SnyggText(elementName = "$WORD-secondary-text", text = secondary)
        }
    }
    if (onClick != null) {
        SnyggButton(elementName = WORD, onClick = onClick, modifier = Modifier.fillMaxHeight()) { body() }
    } else {
        body()
    }
}
