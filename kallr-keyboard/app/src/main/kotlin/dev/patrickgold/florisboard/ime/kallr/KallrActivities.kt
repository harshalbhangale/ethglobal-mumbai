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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
val KallrBlue = Color(0xFF2F6BFF)

@Composable
fun KallrTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) darkColorScheme(primary = KallrBlue) else lightColorScheme(primary = KallrBlue),
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

private sealed interface SheetState {
    data object SignIn : SheetState
    data object Loading : SheetState
    data class Ready(val wallet: String, val quote: TradeQuote) : SheetState
    data class Working(val step: KallrTrader.Step) : SheetState
    data class Done(val orderId: String, val title: String) : SheetState
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
            Column(Modifier.padding(20.dp).navigationBarsPadding()) {
                when (val s = state) {
                    SheetState.Loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.padding(end = 12.dp).height(20.dp))
                        Text("Pricing ${order.symbol ?: "your order"} on Flash…")
                    }
                    SheetState.SignIn -> {
                        Text("Sign in to trade", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        Text(
                            "Kallr uses the same wallet as the Kallr desk. Sign in with X once; the key stays with Privy.",
                            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(onClick = {
                            scope.launch {
                                KallrWallet.signInWithX(context).fold(
                                    onSuccess = { load() },
                                    onFailure = { state = SheetState.Failed(it.message ?: "Sign-in didn't finish.", null) },
                                )
                            }
                        }, modifier = Modifier.fillMaxWidth()) { Text("Sign in with X") }
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
                        Button(
                            onClick = {
                                scope.launch {
                                    KallrTrader.place(context, order) { step -> state = SheetState.Working(step) }.fold(
                                        onSuccess = { state = SheetState.Done(it, p.title) },
                                        onFailure = { state = SheetState.Failed(it.message ?: "The order didn't go through.", s.wallet) },
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = KallrBlue),
                        ) { Text("Confirm and sign", fontSize = 16.sp) }
                        PoweredByFlash()
                    }
                    is SheetState.Working -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.padding(end = 12.dp).height(20.dp))
                        Text(s.step.label)
                    }
                    is SheetState.Done -> {
                        Text("Order placed on Base", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        Text(
                            "${s.title} · Flash order ${s.orderId.take(10)}… · it shows on your Kallr trades.",
                            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(onClick = {
                                val share = "${s.title} via Kallr" + (order.caller?.let { ", copying @$it's call" } ?: "") + ". Flash on Base."
                                val cm = context.getSystemService(ClipboardManager::class.java)
                                cm?.setPrimaryClip(ClipData.newPlainText("Kallr", share))
                                Toast.makeText(context, "Copied. Paste it in the chat.", Toast.LENGTH_SHORT).show()
                                onClose()
                            }) { Text("Copy to share") }
                            Button(onClick = onClose, colors = ButtonDefaults.buttonColors(containerColor = KallrBlue)) { Text("Done") }
                        }
                        PoweredByFlash()
                    }
                    is SheetState.Failed -> {
                        Text("Couldn't place it", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        Text(s.message, modifier = Modifier.padding(top = 6.dp, bottom = 14.dp), color = MaterialTheme.colorScheme.error)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(onClick = onClose) { Text("Close") }
                            Button(onClick = { scope.launch { load() } }) { Text("Try again") }
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

    Column(Modifier.systemBarsPadding().padding(24.dp)) {
        Text("Kallr wallet", fontSize = 24.sp, fontWeight = FontWeight.Medium)
        Text(
            "Trade calls from your keyboard, in X, Telegram or any app. Same wallet as the Kallr desk.",
            modifier = Modifier.padding(top = 6.dp, bottom = 20.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when {
            !KallrWallet.configured -> Text(
                "This build has no Privy app configured. Rebuild with -PprivyAppId and -PprivyClientId.",
                color = MaterialTheme.colorScheme.error,
            )
            busy -> CircularProgressIndicator()
            address == null -> Button(onClick = {
                scope.launch {
                    error = null
                    KallrWallet.signInWithX(context).onFailure { error = it.message ?: "Sign-in didn't finish." }
                    refresh()
                }
            }, modifier = Modifier.fillMaxWidth().height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = KallrBlue)) {
                Text("Sign in with X")
            }
            else -> {
                val a = address!!
                Text("Embedded wallet on Base", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                Text(a, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(vertical = 6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = {
                        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Kallr wallet", a))
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
                    "To fund it, send USDC and about $1 of ETH on Base to this address, from MetaMask or any wallet. Only use Base.",
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
            Column(Modifier.padding(20.dp).navigationBarsPadding()) {
                Text("Kallr · check this call", fontSize = 18.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(8.dp))
                val r = result
                when {
                    loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.padding(end = 12.dp).height(20.dp))
                        Text("Reading it…")
                    }
                    r == null -> Text("Couldn't check that. Is the Kallr server reachable?", color = MaterialTheme.colorScheme.error)
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
                                    "Nothing Kallr can buy on Base for this.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp),
                                )
                            }
                        } else {
                            Spacer(Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("1", "5", "20").forEach { a ->
                                    if (usd == a) Button(onClick = {}, colors = ButtonDefaults.buttonColors(containerColor = KallrBlue)) { Text("\$$a") }
                                    else OutlinedButton(onClick = { usd = a }) { Text("\$$a") }
                                }
                                val e = exits
                                if (e != null) {
                                    Button(onClick = { exits = null }, colors = ButtonDefaults.buttonColors(containerColor = KallrBlue)) {
                                        Text("TP ${e.first.fmt()}% · SL ${e.second.fmt()}%")
                                    }
                                } else {
                                    OutlinedButton(onClick = { exits = 10.0 to 5.0 }) { Text("No exits") }
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            Button(
                                onClick = {
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
                                },
                                modifier = Modifier.fillMaxWidth().height(48.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = KallrBlue),
                            ) { Text(if (wallet == null) "Sign in to trade" else "Buy \$$usd of ${trade.symbol}", fontSize = 16.sp) }
                        }
                    }
                }
                PoweredByFlash()
            }
        }
    }
}
