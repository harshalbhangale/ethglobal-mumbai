/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * KallrTradeActivity: the confirm sheet the keyboard opens when you tap Buy. It shows what you pay
 * and get, then signs with your embedded wallet and places the order on Flash, without a browser.
 * KallrWalletActivity: sign in with X, see your wallet and balances, copy the address to fund it.
 */

package dev.patrickgold.florisboard.ime.kallr

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Definitive Flash's blue for actions; everything else follows the system light/dark theme. */

@Composable
fun KallrTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        // Kallr's screens are always black-and-lime, like the keyboard.
        colorScheme = darkColorScheme(
            primary = KallrLime, onPrimary = KallrBlack, secondary = KallrLime, onSecondary = KallrBlack,
            background = KallrBlack, surface = Color(0xFF111111), surfaceVariant = KallrGraphite,
            onBackground = KallrBone, onSurface = KallrBone, onSurfaceVariant = Color(0xFF8E8E86),
            outline = KallrHairline, error = Danger,
        ),
        content = content,
    )
}

@Composable
fun PoweredByFlash(modifier: Modifier = Modifier) {
    Text(
        "Powered by Flash · Definitive · on Base",
        modifier = modifier.fillMaxWidth().padding(top = 10.dp),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}

@Composable
private fun Line(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}


class KallrTradeActivity : ComponentActivity() {
    companion object {
        private const val EXTRA_ORDER = "kallr.order"
        fun open(context: Context, order: KeyboardOrder) {
            KallrPanelState.resumeOn(Tab.Swap)
            context.startActivity(
                Intent(context, KallrTradeActivity::class.java)
                    .putExtra(EXTRA_ORDER, KallrTrader.encode(order))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY),
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val order = intent.getStringExtra(EXTRA_ORDER)?.let { runCatching { KallrTrader.decode(it) }.getOrNull() }
        if (order == null) {
            finish()
            return
        }
        setContent { KallrTheme { TradeSheet(order, onClose = { finish() }) } }
    }
}

/** The sheet's grab handle, in Kallr's moving gradient. */
@Composable
private fun SheetHandle() {
    Box(Modifier.fillMaxWidth().padding(bottom = 14.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.width(44.dp).height(5.dp).flowBackground(RoundedCornerShape(50)))
    }
}

/** What's happening, over a gradient bar that keeps moving until it's done. */
@Composable
private fun Progress(text: String) {
    Column {
        Text(text, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(12.dp))
        FlowLine(Modifier.clip(RoundedCornerShape(50)), height = 4.dp)
    }
}

private sealed interface SheetState {
    data object SignIn : SheetState
    data object Loading : SheetState
    data class Ready(val wallet: String, val quote: TradeQuote) : SheetState
    data class Working(val step: KallrTrader.Step) : SheetState
    data class Done(val orderId: String, val title: String, val wallet: String) : SheetState
    data class Failed(val message: String, val wallet: String?) : SheetState
}

@Composable
private fun TradeSheet(order: KeyboardOrder, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<SheetState>(SheetState.Loading) }

    suspend fun load() {
        state = SheetState.Loading
        val wallet = runCatching { KallrWallet.wallet(context).address }.getOrNull()
        if (wallet == null) {
            state = if (KallrWallet.configured) SheetState.SignIn else SheetState.Failed("This build has no Privy app configured.", null)
            return
        }
        state = KallrTrader.quote(order, wallet).fold(
            onSuccess = { SheetState.Ready(wallet, it) },
            onFailure = { SheetState.Failed(it.message ?: "Couldn't get a quote.", wallet) },
        )
    }
    LaunchedEffect(Unit) { load() }

    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable(enabled = state !is SheetState.Working) { onClose() },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().clickable(enabled = false) {},
            shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
            tonalElevation = 2.dp,
        ) {
            Column(Modifier.dotField().padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 20.dp).navigationBarsPadding()) {
                SheetHandle()
                when (val s = state) {
                    SheetState.Loading -> Progress("Pricing ${order.symbol ?: "your order"} on Flash…")
                    SheetState.SignIn -> {
                        Text("Sign in to trade", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        Text(
                            "Kall Markets uses the same wallet as the Kall Markets desk. Sign in with X once; the key stays with Privy.",
                            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        FlowButton("Sign in with X") {
                            scope.launch {
                                KallrWallet.signInWithX(context).fold(
                                    onSuccess = { load() },
                                    onFailure = { state = SheetState.Failed(it.message ?: "Sign-in didn't finish.", null) },
                                )
                            }
                        }
                    }
                    is SheetState.Ready -> {
                        val p = s.quote.preview
                        Text(p.title, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        Text(
                            p.kind + (order.caller?.let { ", copying @$it" } ?: ""),
                            modifier = Modifier.padding(top = 2.dp, bottom = 12.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 13.sp,
                        )
                        Line("You pay", p.pay)
                        Line("You get", p.get)
                        Line("Exits", p.exits)
                        Line("Approval", p.approval)
                        Line("Wallet", "Embedded · ${short(s.wallet)}")
                        Spacer(Modifier.height(14.dp))
                        FlowButton("Confirm and sign") {
                                scope.launch {
                                    KallrTrader.place(context, order) { step -> state = SheetState.Working(step) }.fold(
                                        onSuccess = {
                                            // Back in the chat, the panel opens on Positions so the new order is right there.
                                            KallrPanelState.resumeOn(Tab.Positions)
                                            state = SheetState.Done(it, p.title, s.wallet)
                                        },
                                        onFailure = { state = SheetState.Failed(it.message ?: "The order didn't go through.", s.wallet) },
                                    )
                                }
                        }
                        PoweredByFlash()
                    }
                    is SheetState.Working -> Progress(s.step.label)
                    is SheetState.Done -> {
                        // Only reached once Flash returned an order ID; failures stay on the Failed screen.
                        TradeSuccess(
                            TradeSuccessInfo(
                                orderId = s.orderId,
                                wallet = s.wallet,
                                title = s.title,
                                amount = "$${order.usd}",
                                asset = "${if (order.kind == "swap") "Bought" else "Buying"} ${order.symbol ?: order.token}",
                                tpPct = order.tpPct,
                                slPct = order.slPct,
                            ),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedButton(onClick = {
                                val share = "${s.title} via Kall Markets" + (order.caller?.let { ", copying @$it's call" } ?: "") + ". Flash on Base."
                                val cm = context.getSystemService(ClipboardManager::class.java)
                                cm?.setPrimaryClip(ClipData.newPlainText("Kall Markets", share))
                                Toast.makeText(context, "Copied. Paste it in the chat.", Toast.LENGTH_SHORT).show()
                                onClose()
                            }, modifier = Modifier.weight(1f).height(48.dp)) { Text("Copy to share") }
                            FlowButton("Done", modifier = Modifier.weight(1f), onClick = onClose)
                        }
                        PoweredByFlash()
                    }
                    is SheetState.Failed -> {
                        Text("Couldn't place it", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        Text(s.message, modifier = Modifier.padding(top = 6.dp, bottom = 14.dp), color = MaterialTheme.colorScheme.error)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedButton(onClick = onClose, modifier = Modifier.weight(1f).height(48.dp)) { Text("Close") }
                            FlowButton("Try again", modifier = Modifier.weight(1f)) { scope.launch { load() } }
                        }
                    }
                }
            }
        }
    }
}

class KallrWalletActivity : ComponentActivity() {
    companion object {
        fun open(context: Context) {
            KallrPanelState.resumeOn(KallrPanelState.tab)
            context.startActivity(Intent(context, KallrWalletActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { KallrTheme { Surface(Modifier.fillMaxSize()) { WalletScreen() } } }
    }
}

@Composable
private fun WalletScreen() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf<String?>(null) }
    var balances by remember { mutableStateOf<Pair<String, String>?>(null) }
    var busy by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun refresh() {
        busy = true
        address = runCatching { KallrWallet.wallet(context).address }.getOrNull()
        balances = address?.let { a ->
            Kallr.get("/api/keyboard/wallet?address=$a").getOrNull()?.let { text ->
                val o = Json.parseToJsonElement(text).jsonObject
                (o["usdc"]?.jsonPrimitive?.content ?: "0") to (o["eth"]?.jsonPrimitive?.content ?: "0")
            }
        }
        busy = false
    }
    LaunchedEffect(Unit) { refresh() }

    Column(Modifier.fillMaxSize().dotField().systemBarsPadding().padding(24.dp)) {
        FlowLine(Modifier.padding(bottom = 18.dp).width(56.dp), height = 3.dp)
        Text(
            buildAnnotatedString {
                append("KALLR WALLET")
                withStyle(SpanStyle(color = KallrLime)) { append(".") }
            },
            fontSize = 34.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = (-0.5).sp,
            lineHeight = 36.sp,
        )
        Text(
            "Trade calls from your keyboard, in X, Telegram or any app. Same wallet as the Kall Markets desk.",
            modifier = Modifier.padding(top = 6.dp, bottom = 20.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when {
            !KallrWallet.configured -> Text(
                "This build has no Privy app configured. Rebuild with -PprivyAppId and -PprivyClientId.",
                color = MaterialTheme.colorScheme.error,
            )
            busy -> Progress("Opening your wallet…")
            address == null -> FlowButton("Sign in with X") {
                scope.launch {
                    error = null
                    KallrWallet.signInWithX(context).onFailure { error = it.message ?: "Sign-in didn't finish." }
                    refresh()
                }
            }
            else -> {
                val a = address!!
                Text("Embedded wallet on Base", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                Text(a, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(vertical = 6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = {
                        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Kall Markets wallet", a))
                        Toast.makeText(context, "Address copied", Toast.LENGTH_SHORT).show()
                    }) { Text("Copy address") }
                    OutlinedButton(onClick = { scope.launch { refresh() } }) { Text("Refresh") }
                }
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Line("USDC (to trade)", balances?.first?.let { "%.2f".format(it.toDoubleOrNull() ?: 0.0) } ?: "…")
                Line("ETH (for gas)", balances?.second?.let { "%.5f".format(it.toDoubleOrNull() ?: 0.0) } ?: "…")
                HorizontalDivider()
                Text(
                    "To fund it, send USDC and about $1 of ETH on Base to this address from any wallet or exchange. Only use Base.",
                    modifier = Modifier.padding(top = 14.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(20.dp))
                OutlinedButton(onClick = { scope.launch { KallrWallet.signOut(context); refresh() } }) { Text("Sign out") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
        PoweredByFlash(Modifier.padding(top = 24.dp))
    }
}

/**
 * Share → Kallr from X or Telegram: checks the shared post or message (the caller's record, the AI's
 * read, real or fake contract) and offers a quick buy, which opens the confirm sheet.
 */
class KallrShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
        if (text == null) {
            finish()
            return
        }
        setContent { KallrTheme { ShareSheet(text, onClose = { finish() }) } }
    }
}

@Composable
private fun ShareSheet(text: String, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var result by remember { mutableStateOf<AmResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var usd by remember { mutableStateOf("5") }
    var exits by remember { mutableStateOf<Pair<Double, Double>?>(10.0 to 5.0) }
    val wallet = KallrWallet.address.value

    LaunchedEffect(text) {
        result = Kallr.lookup(context, Kallr.clipboardReference(text) ?: text.trim().take(600), null)
        result?.prefill?.let { p ->
            p.usd?.let { usd = if (it % 1.0 == 0.0) it.toInt().toString() else "%.2f".format(it) }
            if (p.tpPct != null && p.slPct != null) exits = p.tpPct to p.slPct
        }
        loading = false
    }

    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable { onClose() }, contentAlignment = Alignment.BottomCenter) {
        Surface(Modifier.fillMaxWidth().clickable(enabled = false) {}, shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp), tonalElevation = 2.dp) {
            Column(Modifier.dotField().padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 20.dp).navigationBarsPadding()) {
                SheetHandle()
                Text("Kall Markets · check this call", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                val r = result
                when {
                    loading -> Progress("Reading it…")
                    r == null -> Text("Couldn't check that. Is the Kall Markets server reachable?", color = MaterialTheme.colorScheme.error)
                    else -> {
                        r.fake?.let {
                            Text(
                                "Fake \$${it.claimed} contract. The real one is ${it.real.take(6)}…${it.real.takeLast(4)}. Don't buy it.",
                                color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium,
                            )
                        }
                        (r.call?.line ?: r.ai?.summary)?.let { Text(it, fontWeight = FontWeight.Medium) }
                        r.record?.line?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp) }
                        r.token?.let { t ->
                            Text(
                                t.line,
                                color = if (t.warnings.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                                fontSize = 13.sp,
                            )
                        }
                        val trade = r.trade
                        if (trade == null) {
                            if (r.fake == null) {
                                Text(
                                    "Nothing Kall Markets can buy on Base for this.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp),
                                )
                            }
                        } else {
                            Spacer(Modifier.height(12.dp))
                            val chipText = MaterialTheme.colorScheme.onSurface
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                listOf("1", "5", "20").forEach { a -> FlowChip("\$$a", usd == a, chipText) { usd = a } }
                                val e = exits
                                FlowChip(
                                    if (e != null) "TP ${e.first.fmt()}% · SL ${e.second.fmt()}%" else "No exits",
                                    e != null,
                                    chipText,
                                ) { exits = if (e != null) null else 10.0 to 5.0 }
                            }
                            Spacer(Modifier.height(10.dp))
                            FlowButton(if (wallet == null) "Sign in to trade" else "Buy \$$usd of ${trade.symbol}") {
                                    if (wallet == null) {
                                        KallrWalletActivity.open(context)
                                    } else {
                                        KallrTradeActivity.open(
                                            context,
                                            KeyboardOrder(
                                                token = trade.token,
                                                kind = "swap",
                                                usd = usd,
                                                tpPct = exits?.first,
                                                slPct = exits?.second,
                                                postId = r.post?.postId,
                                                caller = r.post?.handle,
                                                symbol = trade.symbol,
                                            ),
                                        )
                                        onClose()
                                    }
                            }
                        }
                    }
                }
                PoweredByFlash()
            }
        }
    }
}
