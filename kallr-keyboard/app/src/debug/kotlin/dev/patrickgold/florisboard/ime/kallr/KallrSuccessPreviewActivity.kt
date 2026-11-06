/*
 * Kallr addition to FlorisBoard (Apache-2.0). Debug builds only.
 *
 * Plays the "trade placed" animation with sample numbers, so it can be checked on an emulator without
 * placing a real order. Not exported and not in release builds; the real sheet only shows it after
 * Flash accepts an order. Tap to replay.
 *   adb root && adb shell am start -n app.kallr.keyboard/dev.patrickgold.florisboard.ime.kallr.KallrSuccessPreviewActivity
 */

package dev.patrickgold.florisboard.ime.kallr

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

class KallrSuccessPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            KallrTheme {
                var run by remember { mutableIntStateOf(0) }
                Box(
                    Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable { run++ },
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp), tonalElevation = 2.dp) {
                        Box(Modifier.dotField().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 20.dp).navigationBarsPadding()) {
                            key(run) {
                                TradeSuccess(
                                    TradeSuccessInfo(
                                        orderId = "00000000-0000-0000-0000-000000000000",
                                        wallet = "0x0000000000000000000000000000000000000000",
                                        title = "Buy \$5 of ETH",
                                        amount = "\$5",
                                        asset = "Bought ETH",
                                        tpPct = 10.0,
                                        slPct = 5.0,
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
