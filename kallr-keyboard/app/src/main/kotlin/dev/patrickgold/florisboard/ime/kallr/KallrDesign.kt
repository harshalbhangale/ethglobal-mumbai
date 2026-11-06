/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * Kallr's look inside the keyboard: the brand palette shared with the web app, and the moving
 * linear gradient ("flow") that runs through the Trade key, the suggestion row, the panel and the
 * confirm sheets. Animated values are read in the draw phase, so a running gradient redraws a few
 * pixels and never recomposes the keyboard.
 */

package dev.patrickgold.florisboard.ime.kallr

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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shape
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
import kotlin.math.max

// The palette the web app uses, so the keyboard, the desk and the extension read as one product.
val KallrInk = Color(0xFF14213D)
val KallrViolet = Color(0xFF7C3AED)
val KallrSky = Color(0xFF1D9BF0)
val KallrMint = Color(0xFF10B981)

/** Blue → violet → sky and back to blue, so a sliding copy of it loops without a seam. */
internal val FLOW = listOf(KallrBlue, KallrViolet, KallrSky, KallrBlue)

/** The still version, for selected chips and gradient text. */
internal val BrandBrush = Brush.linearGradient(listOf(KallrBlue, KallrViolet))

/** 0 → 1 forever, linearly: the position of the moving gradient. */
@Composable
internal fun rememberFlowPhase(durationMs: Int = 4200): State<Float> {
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
internal fun DrawScope.flowBrush(phase: Float, colors: List<Color> = FLOW): Brush {
    val period = Offset(max(size.width, 1f) * 1.4f, size.height * 0.8f)
    return Brush.linearGradient(colors, start = period * -phase, end = period * (1f - phase), tileMode = TileMode.Repeated)
}

/** Fills the element with the moving brand gradient. */
@Composable
internal fun Modifier.flowBackground(shape: Shape, colors: List<Color> = FLOW, durationMs: Int = 4200): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return clip(shape).drawBehind { drawRect(flowBrush(phase.value, colors)) }
}

/** A moving-gradient outline, for the row while it holds a call and for the mic while it listens. */
@Composable
internal fun Modifier.flowBorder(width: Dp, shape: Shape, colors: List<Color> = FLOW, durationMs: Int = 4200): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return drawWithContent {
        drawContent()
        drawOutline(shape.createOutline(size, layoutDirection, this), flowBrush(phase.value, colors), style = Stroke(width.toPx()))
    }
}

/** Paints the moving gradient over whatever the element draws (an icon tinted white, say). */
@Composable
internal fun Modifier.flowTint(colors: List<Color> = FLOW, durationMs: Int = 4200): Modifier {
    val phase = rememberFlowPhase(durationMs)
    return graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            drawRect(flowBrush(phase.value, colors), blendMode = BlendMode.SrcAtop)
        }
}

/** A soft light sweeping across the element while something loads. */
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
                listOf(Color.Transparent, Color.White.copy(alpha = 0.28f), Color.Transparent),
                start = Offset(x - 0.25f * w, 0f),
                end = Offset(x + 0.25f * w, size.height),
            ),
        )
    }
}

/** Clickable that shrinks a little under the finger, with no ripple. */
@Composable
internal fun Modifier.pressable(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.95f else 1f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium),
        label = "kallr-press",
    )
    return graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(interactionSource = source, indication = null, enabled = enabled, onClick = onClick)
}

/** The main action everywhere: a moving gradient with a soft colored glow. */
@Composable
internal fun FlowButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    height: Dp = 48.dp,
    disabledText: Color = Muted,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .then(
                if (enabled) {
                    Modifier.shadow(12.dp, shape, ambientColor = KallrViolet, spotColor = KallrBlue).flowBackground(shape)
                } else {
                    Modifier.clip(shape).background(Muted.copy(alpha = 0.22f))
                },
            )
            .pressable(enabled, onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) Color.White else disabledText,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

/** A choice chip: the brand gradient fades in when it's picked, and it springs under the finger. */
@Composable
internal fun FlowChip(label: String, selected: Boolean, textColor: Color, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    val picked by animateFloatAsState(if (selected) 1f else 0f, tween(220), label = "kallr-chip")
    val color by animateColorAsState(if (selected) Color.White else textColor, tween(220), label = "kallr-chip-text")
    Box(
        Modifier
            .padding(end = 6.dp)
            .clip(shape)
            .drawBehind {
                drawRect(textColor.copy(alpha = 0.07f * (1f - picked)))
                if (picked > 0f) drawRect(BrandBrush, alpha = picked)
            }
            .pressable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(label, color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/** A dot with a ring that keeps expanding and fading: something is live (signed in, an order working). */
@Composable
internal fun PulseDot(color: Color, dot: Dp = 8.dp) {
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
internal fun ListeningBars(color: Color = Color.White) {
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

/** A thin moving line, the top edge of every Kallr sheet. */
@Composable
internal fun FlowLine(modifier: Modifier = Modifier, height: Dp = 3.dp) {
    Box(modifier.fillMaxWidth().height(height).flowBackground(RoundedCornerShape(50)))
}
