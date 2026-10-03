package com.iptvnator.googletv

import java.text.Collator
import java.util.Locale

/** Matches IPTVnator's Intl.Collator(numeric: true, sensitivity: "base"). */
internal fun tvChannelNameComparator(locale: Locale = Locale.getDefault()): Comparator<String> {
    val collator = Collator.getInstance(locale).apply {
        strength = Collator.PRIMARY
        decomposition = Collator.CANONICAL_DECOMPOSITION
    }

    return Comparator { left, right ->
        var leftIndex = 0
        var rightIndex = 0
        while (leftIndex < left.length && rightIndex < right.length) {
            val leftIsDigit = left[leftIndex] in '0'..'9'
            val rightIsDigit = right[rightIndex] in '0'..'9'

            if (leftIsDigit && rightIsDigit) {
                var leftEnd = leftIndex
                var rightEnd = rightIndex
                while (leftEnd < left.length && left[leftEnd] in '0'..'9') leftEnd++
                while (rightEnd < right.length && right[rightEnd] in '0'..'9') rightEnd++

                var leftSignificant = leftIndex
                var rightSignificant = rightIndex
                while (leftSignificant < leftEnd - 1 && left[leftSignificant] == '0') leftSignificant++
                while (rightSignificant < rightEnd - 1 && right[rightSignificant] == '0') rightSignificant++

                val leftDigits = leftEnd - leftSignificant
                val rightDigits = rightEnd - rightSignificant
                if (leftDigits != rightDigits) return@Comparator leftDigits.compareTo(rightDigits)
                for (offset in 0 until leftDigits) {
                    val difference = left[leftSignificant + offset].compareTo(right[rightSignificant + offset])
                    if (difference != 0) return@Comparator difference
                }

                // Numerically equal runs stay deterministic: fewer leading
                // zeroes sort first, as with a numeric-aware locale collator.
                val leftRun = leftEnd - leftIndex
                val rightRun = rightEnd - rightIndex
                if (leftRun != rightRun) return@Comparator leftRun.compareTo(rightRun)
                leftIndex = leftEnd
                rightIndex = rightEnd
            } else {
                var leftEnd = leftIndex
                var rightEnd = rightIndex
                while (leftEnd < left.length && left[leftEnd] !in '0'..'9') leftEnd++
                while (rightEnd < right.length && right[rightEnd] !in '0'..'9') rightEnd++
                val difference = collator.compare(
                    left.substring(leftIndex, leftEnd),
                    right.substring(rightIndex, rightEnd),
                )
                if (difference != 0) return@Comparator difference
                leftIndex = leftEnd
                rightIndex = rightEnd
            }
        }
        (left.length - leftIndex).compareTo(right.length - rightIndex)
    }
}
