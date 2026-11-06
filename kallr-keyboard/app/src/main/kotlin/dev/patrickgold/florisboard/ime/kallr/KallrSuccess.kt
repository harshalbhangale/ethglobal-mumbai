/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * The "trade placed" moment on the confirm sheet: a lime ring draws itself, the disc springs in, a
 * check strokes on with a short haptic tick, a ring of confetti fires, then the summary rises in.
 * About 1.3s. Shown only after Flash returns an order ID. With animations off in system settings
 * (animator duration scale 0) the finished check and summary show at once, with no confetti.
 */

package dev.patrickgold.florisboard.ime.kallr

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private const val BASESCAN = "https://basescan.org"
private const val TOTAL_MS = 1300
private val Positive = Color(0xFF8AD97C)
private val Negative = Color(0xFFFF8A7A)
private val Soft = Color(0xFF8E8E86)

/** A springy overshoot, the same curve the extension's burst uses. */
private val SpringOut: Easing = CubicBezierEasing(0.34f, 1.7f, 0.5f, 1f)
private val EaseOut: Easing = CubicBezierEasing(0.1f, 0.8f, 0.3f, 1f)
private val EaseInOut: Easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)

/** 0..1 progress of a phase that runs from [startMs] for [lengthMs] of the overall timeline. */
private fun phase(t: Float, startMs: Int, lengthMs: Int, easing: Easing = LinearEasing): Float {
    val local = ((t * TOTAL_MS - startMs) / lengthMs).coerceIn(0f, 1f)
    return easing.transform(local)
}

/** True when the user turned animations off (Developer options → Animator duration scale → off). */
private fun animationsOff(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

/** Confetti: angle (deg), distance (dp), size (dp), color, bar or dot. Fixed so the burst is the same every time. */
private data class Piece(val angle: Float, val dist: Float, val size: Float, val color: Color, val bar: Boolean, val delayMs: Int)

private val PIECES = listOf(-90f, -62f, -35f, -8f, 18f, 44f, 70f, 96f, 122f, 148f, 174f, 200f, 226f, 252f).mapIndexed { i, a ->
    Piece(
        angle = a,
        dist = if (i % 2 == 0) 62f else 52f,
        size = if (i % 2 == 0) 7f else 5f,
        color = listOf(KallrLime, KallrBone, KallrLimeBright)[i % 3],
        bar = i % 2 == 0,
        delayMs = (i % 3) * 18,
    )
}

/** What the summary says under the check. */
data class TradeSuccessInfo(
    val orderId: String,
    val wallet: String,
    /** "Buy $5 of ETH" style title from the quote preview. */
    val title: String,
    val amount: String,
    val asset: String,
    val tpPct: Double?,
    val slPct: Double?,
)

/** The burst mark: ring, disc, check and confetti, drawn on one canvas. */
@Composable
private fun SuccessMark(t: Float, modifier: Modifier = Modifier) {
    // Confetti flies past the canvas edges on purpose (nothing clips it), so the summary can sit close.
    Canvas(modifier.size(104.dp)) {
        val c = Offset(size.width / 2, size.height / 2)
        val r = 30.dp.toPx()

        // Shockwave ring, fading out as it grows.
        val wave = phase(t, 400, 560, EaseOut)
        if (wave in 0.001f..0.999f) {
            drawCircle(KallrLime.copy(alpha = 0.7f * (1 - wave)), radius = r * (0.85f + 1.25f * wave), center = c, style = Stroke(2.dp.toPx()))
        }

        // Confetti flying out from the centre.
        PIECES.forEach { p ->
            val f = phase(t, 440 + p.delayMs, 640, EaseOut)
            if (f <= 0f || f >= 1f) return@forEach
            val rad = (p.angle * PI / 180).toFloat()
            val pos = c + Offset(cos(rad), sin(rad)) * (p.dist.dp.toPx() * f)
            val alpha = if (f < 0.7f) 1f else (1 - f) / 0.3f
            val s = p.size.dp.toPx() * (0.4f + 0.6f * f)
            if (p.bar) {
                rotate(p.angle + 90 + 300 * f * (if (p.delayMs == 0) 1 else -1), pivot = pos) {
                    drawRoundRect(p.color.copy(alpha = alpha), topLeft = pos - Offset(s * 0.22f, s * 0.75f), size = Size(s * 0.45f, s * 1.5f))
                }
            } else {
                drawCircle(p.color.copy(alpha = alpha), radius = s / 2, center = pos)
            }
        }

        // The ring draws itself from the top, then the lime disc springs in over it.
        val ring = phase(t, 0, 380, EaseInOut)
        drawArc(
            KallrLime, startAngle = -90f, sweepAngle = 360f * ring, useCenter = false,
            topLeft = c - Offset(r, r), size = Size(r * 2, r * 2), style = Stroke(3.dp.toPx(), cap = StrokeCap.Round),
        )
        val disc = phase(t, 300, 420, SpringOut)
        if (disc > 0f) drawCircle(KallrLime, radius = r * disc, center = c)

        // The check strokes on.
        val tick = phase(t, 520, 260, CubicBezierEasing(0.4f, 0f, 0.2f, 1f))
        if (tick > 0f) {
            val u = r / 26f // the check is drawn on the same 64-unit grid as the extension's SVG
            val full = Path().apply {
                moveTo(c.x + (20.5f - 32) * u, c.y + (33.5f - 32) * u)
                lineTo(c.x + (28.5f - 32) * u, c.y + (41.5f - 32) * u)
                lineTo(c.x + (44f - 32) * u, c.y + (25f - 32) * u)
            }
            val measure = PathMeasure().apply { setPath(full, false) }
            val part = Path()
            measure.getSegment(0f, measure.length * tick, part, true)
            drawPath(part, KallrBlack, style = Stroke(5.5f * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/** Rises in at [startMs] with a small spring. */
private fun Modifier.rise(t: Float, startMs: Int): Modifier = graphicsLayer {
    val f = phase(t, startMs, 360, SpringOut)
    alpha = phase(t, startMs, 200)
    translationY = (1 - f) * 8.dp.toPx()
}

@Composable
fun TradeSuccess(info: TradeSuccessInfo) {
    val context = LocalContext.current
    val view = LocalView.current
    val still = remember { animationsOff(context) }
    val progress = remember { Animatable(if (still) 1f else 0f) }
    var swapHash by remember { mutableStateOf<String?>(null) }
    var gaveUp by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (still) {
            view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP)
            return@LaunchedEffect
        }
        progress.animateTo(1f, tween(TOTAL_MS, easing = LinearEasing))
    }
    // The tick: one short haptic as the check lands (the system's own haptic setting still applies).
    LaunchedEffect(Unit) {
        if (still) return@LaunchedEffect
        delay(560)
        view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP)
    }
    // Definitive fills a few seconds after the order is accepted; then the link points at the swap itself.
    LaunchedEffect(info.orderId) {
        repeat(20) {
            val hash = Kallr.get("/api/flash/orders/${info.orderId}").getOrNull()?.let { fillHash(it) }
            if (hash != null) {
                swapHash = hash
                return@LaunchedEffect
            }
            delay(3000)
        }
        gaveUp = true
    }

    val t = progress.value
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.graphicsLayer {
                // A small thump as the check lands.
                val thump = phase(t, 540, 300)
                val s = 1f + 0.1f * sin(thump * PI.toFloat())
                scaleX = s; scaleY = s
            },
            contentAlignment = Alignment.Center,
        ) { SuccessMark(t, Modifier.padding(top = 18.dp, bottom = 6.dp)) }
        Text("Order placed", fontSize = 21.sp, fontWeight = FontWeight.Bold, color = KallrBone, modifier = Modifier.rise(t, 660))
        Row(Modifier.padding(top = 4.dp).rise(t, 730), verticalAlignment = Alignment.CenterVertically) {
            Text(info.amount, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = KallrLime)
            Text(" · ${info.asset}", fontSize = 15.sp, color = Soft)
        }
        if (info.tpPct != null && info.slPct != null) {
            Row(Modifier.padding(top = 8.dp).rise(t, 800), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ExitPill("TP +${info.tpPct.fmt()}%", Positive)
                ExitPill("SL −${info.slPct.fmt()}%", Negative)
            }
        }
        val link = when {
            swapHash != null -> "View swap on Basescan ↗" to "$BASESCAN/tx/$swapHash"
            gaveUp -> "Your wallet on Basescan ↗" to "$BASESCAN/address/${info.wallet}"
            else -> null
        }
        Text(
            link?.first ?: "Basescan link once Definitive fills…",
            color = if (link != null) KallrLime else Soft,
            fontSize = 13.sp,
            fontWeight = if (link != null) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier
                .padding(top = 10.dp)
                .rise(t, 870)
                .clickable(enabled = link != null) {
                    link?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it.second)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                }
                .padding(vertical = 6.dp, horizontal = 8.dp),
        )
        Text(
            "Flash order ${info.orderId.take(8)}… · on your Kall Markets trades",
            color = Soft, fontSize = 11.sp, modifier = Modifier.padding(bottom = 12.dp).rise(t, 940),
        )
    }
}

@Composable
private fun ExitPill(text: String, color: Color) {
    Text(
        text,
        color = color,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.border(1.dp, KallrHairline, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

private val json = Json { ignoreUnknownKeys = true }

/** The swap's transaction hash from /api/flash/orders/{id}, once Definitive has filled it. */
internal fun fillHash(body: String): String? = runCatching {
    json.parseToJsonElement(body).jsonObject["fills"]?.jsonArray
        ?.firstNotNullOfOrNull { f -> f.jsonObject["transactionId"]?.jsonPrimitive?.contentOrNull?.takeIf { Regex("^0x[0-9a-fA-F]{64}$").matches(it) } }
}.getOrNull()
