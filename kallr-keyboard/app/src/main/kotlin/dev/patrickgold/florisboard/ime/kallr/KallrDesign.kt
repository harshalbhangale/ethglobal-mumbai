/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * Kallr's look inside the keyboard: near-black, bone-white type and one lime accent, with motion
 * kept quiet and linear: a lime glint across buttons, a lime streak running along borders and
 * lines, and a dot field with a lime band drifting through it. Animated values are read in the draw
 * phase, so the motion redraws a few pixels and never recomposes the keyboard.
 */

package dev.patrickgold.florisboard.ime.kallr

import android.view.HapticFeedbackConstants
import android.view.View
import dev.patrickgold.florisboard.FlorisImeService
import androidx.compose.ui.platform.LocalView
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.max

// Black, bone and lime: the X-trading look.
val KallrLime = Color(0xFFCCF25A)
val KallrLimeBright = Color(0xFFEAFFA8)
val KallrBlack = Color(0xFF0A0A0A)
val KallrBone = Color(0xFFECECE4)
val KallrGraphite = Color(0xFF1A1A1A)
val KallrHairline = Color(0xFF2A2A2A)

/** Mostly lime with one brighter band sliding through: the fill of every main button. */
internal val GLINT = listOf(KallrLime, KallrLime, KallrLimeBright, KallrLime, KallrLime)

/** Nothing, then a lime streak, then nothing: the light that travels along borders and lines. */
internal val STREAK = listOf(Color.Transparent, Color.Transparent, KallrLime, Color.Transparent, Color.Transparent)

/** 0 → 1 forever, linearly: where the glint or streak is. */
@Composable
internal fun rememberFlowPhase(durationMs: Int = 3600): State<Float> {
    val transition = rememberInfiniteTransition(label = "kallr-flow")
    return transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMs, easing = LinearEasing)),
        label = "kallr-flow-phase",
    )
}

/**
 * A repeating diagonal gradient shifted by exactly one period per cycle along its own direction,
 * so the motion is continuous with no jump when the phase wraps.
 */
internal fun DrawScope.flowBrush(phase: Float, colors: List<Color> = GLINT): Brush {
    val period = Offset(max(size.width, 1f) * 1.4f, size.height * 0.6f)
    return Brush.linearGradient(colors, start = period * -phase, end = period * (1f - phase), tileMode = TileMode.Repeated)
}

/** Fills the element with lime and a glint that keeps sliding across. */
@Composable
internal fun Modifier.flowBackground(shape: Shape, colors: List<Color> = GLINT, durationMs: Int = 3600): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return clip(shape).drawBehind { drawRect(flowBrush(phase.value, colors)) }
}

/** A hairline with a lime streak running along it. */
@Composable
internal fun Modifier.flowBorder(width: Dp, shape: Shape, base: Color = KallrHairline, durationMs: Int = 3600): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return drawWithContent {
        drawContent()
        val outline = shape.createOutline(size, layoutDirection, this)
        val stroke = Stroke(width.toPx())
        drawOutline(outline, base, style = stroke)
        drawOutline(outline, flowBrush(phase.value, STREAK), style = stroke)
    }
}

/** Paints lime, with the glint, over whatever the element draws (an icon tinted white, say). */
@Composable
internal fun Modifier.flowTint(durationMs: Int = 3600): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            drawRect(flowBrush(phase.value, GLINT), blendMode = BlendMode.SrcAtop)
        }
}

/** A faint light sweeping across the element while something loads. */
@Composable
internal fun Modifier.shimmer(active: Boolean): Modifier {
    if (!active) return this
    val phase = rememberFlowPhase(1300)
    return drawWithContent {
        drawContent()
        val w = size.width
        val x = -0.4f * w + phase.value * 1.8f * w
        drawRect(
            Brush.linearGradient(
                listOf(Color.Transparent, KallrLime.copy(alpha = 0.16f), Color.Transparent),
                start = Offset(x - 0.25f * w, 0f),
                end = Offset(x + 0.25f * w, size.height),
            ),
        )
    }
}

/**
 * A field of faint dots with a lime band drifting through it diagonally, like the particle shapes
 * on Kallr's site. One draw call per layer, so it stays cheap behind the panel.
 */
@Composable
internal fun Modifier.dotField(dots: Color = KallrBone, accent: Color = KallrLime, durationMs: Int = 9000): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return drawWithCache {
        val step = 12.dp.toPx()
        val dot = 1.6.dp.toPx()
        val w = size.width
        val h = size.height
        val points = buildList {
            var row = 0
            var y = step / 2
            while (y < h) {
                var x = step / 2 + if (row % 2 == 0) 0f else step / 2
                while (x < w) {
                    add(Offset(x, y))
                    x += step
                }
                y += step
                row++
            }
        }
        onDrawBehind {
            drawPoints(points, PointMode.Points, dots.copy(alpha = 0.07f), strokeWidth = dot, cap = StrokeCap.Round)
            val span = size.width + size.height
            val center = -0.2f * span + phase.value * 1.4f * span
            val band = points.filter { abs(it.x + it.y - center) < step * 2.5f }
            drawPoints(band, PointMode.Points, accent.copy(alpha = 0.5f), strokeWidth = dot * 1.25f, cap = StrokeCap.Round)
        }
    }
}

/** One short, crisp tick, the same feel (and the same Input feedback settings) as a key press. */
internal fun View.kallTick() {
    FlorisImeService.inputFeedbackController()?.keyPress()
        ?: performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP, HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING)
}

/** Clickable that shrinks a little under the finger, with no ripple, and ticks like a key. */
@Composable
internal fun Modifier.pressable(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val view = LocalView.current
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium),
        label = "kallr-press",
    )
    return graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(interactionSource = source, indication = null, enabled = enabled) {
            view.kallTick()
            onClick()
        }
}

/** The main action everywhere: lime with a sliding glint, black uppercase label and an arrow. */
@Composable
internal fun FlowButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    height: Dp = 48.dp,
    arrow: Boolean = true,
    disabledText: Color = Muted,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .then(if (enabled) Modifier.flowBackground(shape) else Modifier.clip(shape).background(KallrGraphite))
            .pressable(enabled, onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label.uppercase() + if (enabled && arrow) "  ↗" else "",
            color = if (enabled) KallrBlack else disabledText,
            fontSize = 14.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 0.6.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

/** A choice chip: graphite until it's picked, then lime with black text; it springs under the finger. */
@Composable
internal fun FlowChip(label: String, selected: Boolean, textColor: Color, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    val picked by animateFloatAsState(if (selected) 1f else 0f, tween(200), label = "kallr-chip")
    val color by animateColorAsState(if (selected) KallrBlack else textColor, tween(200), label = "kallr-chip-text")
    Box(
        Modifier
            .padding(end = 6.dp)
            .clip(shape)
            .drawBehind {
                drawRect(textColor.copy(alpha = 0.08f * (1f - picked)))
                if (picked > 0f) drawRect(KallrLime, alpha = picked)
            }
            .pressable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(label, color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

/** A dot with a ring that keeps expanding and fading: something is live (signed in, an order working). */
@Composable
internal fun PulseDot(color: Color = KallrLime, dot: Dp = 8.dp) {
    val transition = rememberInfiniteTransition(label = "kallr-pulse")
    val p by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1600, easing = LinearOutSlowInEasing)),
        label = "kallr-pulse-phase",
    )
    Box(Modifier.size(dot * 2.4f), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(dot)
                .graphicsLayer {
                    scaleX = 1f + 1.3f * p
                    scaleY = 1f + 1.3f * p
                    alpha = 1f - p
                }
                .background(color, CircleShape),
        )
        Box(Modifier.size(dot).background(color, CircleShape))
    }
}

/** Three bars bouncing out of step: the mic is listening. */
@Composable
internal fun ListeningBars(color: Color = KallrLime) {
    val transition = rememberInfiniteTransition(label = "kallr-bars")
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        listOf(0, 180, 360).forEach { delay ->
            val h by transition.animateFloat(
                initialValue = 0.3f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(420, delayMillis = delay, easing = LinearEasing), RepeatMode.Reverse),
                label = "kallr-bar",
            )
            Box(
                Modifier
                    .width(3.dp)
                    .height(16.dp)
                    .graphicsLayer { scaleY = h }
                    .background(color, RoundedCornerShape(2.dp)),
            )
        }
    }
}

/** A hairline with a lime streak running along it: the top edge of the panel and of every sheet. */
@Composable
internal fun FlowLine(modifier: Modifier = Modifier, height: Dp = 2.dp) {
    val phase = rememberFlowPhase(2600)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .drawBehind {
                drawRect(KallrHairline)
                drawRect(flowBrush(phase.value, STREAK))
            },
    )
}
