/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 */

package dev.patrickgold.florisboard.ime.kallr

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AmountPadTest {
    private fun type(vararg keys: String) = keys.fold("") { acc, k -> padInput(acc, k) }

    @Test fun digits() = assertEquals("125", type("1", "2", "5"))
    @Test fun oneDotOnly() = assertEquals("3.5", type("3", ".", ".", "5"))
    @Test fun leadingDotBecomesZero() = assertEquals("0.5", type(".", "5"))
    @Test fun noLeadingZeros() = assertEquals("7", type("0", "7"))
    @Test fun atMostTwoDecimals() = assertEquals("1.25", type("1", ".", "2", "5", "9"))
    @Test fun atMostFiveWholeDigits() = assertEquals("12345", type("1", "2", "3", "4", "5", "6"))
    @Test fun backspace() = assertEquals("4", type("4", "2", "⌫"))
    @Test fun backspaceOnEmpty() = assertEquals("", type("⌫"))
    @Test fun doubleZero() = assertEquals("500", type("5", "00"))
    @Test fun doubleZeroAlone() = assertEquals("0", type("00"))

    @Test fun plainAmount() = assertEquals("25", padAmount("25"))
    @Test fun trailingDotDropped() = assertEquals("25", padAmount("25."))
    @Test fun trailingZerosDropped() = assertEquals("2.5", padAmount("2.50"))
    @Test fun centsKept() = assertEquals("0.75", padAmount("0.75"))
    @Test fun zeroRefused() = assertNull(padAmount("0"))
    @Test fun emptyRefused() = assertNull(padAmount(""))
    @Test fun overCapRefused() = assertNull(padAmount("10001"))
    @Test fun capAllowed() = assertEquals("10000", padAmount("10000"))
}
