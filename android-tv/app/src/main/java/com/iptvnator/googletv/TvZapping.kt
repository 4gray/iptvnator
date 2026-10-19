package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.TvSavedItem
import com.iptvnator.googletv.playlist.TvSavedItemType

/** Match IPTVnator's debounce so multi-digit channel entry remains comfortable on a TV remote. */
internal const val TV_CHANNEL_NUMBER_INPUT_TIMEOUT_MS = 2_000L

internal enum class TvChannelZapOrder { SOURCE, NAME_ASC, NAME_DESC, CAPTURED }

internal data class TvChannelZapEntry(val playlistId: String, val channelId: String)

/** Capture only live channels from a collection after its visible scope/order has been applied. */
internal fun tvSavedChannelZapQueue(visibleItems: List<TvSavedItem>): List<TvChannelZapEntry> =
    visibleItems.asSequence()
        .filter { it.itemType == TvSavedItemType.CHANNEL }
        .map { TvChannelZapEntry(it.playlistId, it.itemKey) }
        .toList()

/** Playback keeps the channel-list scope/order that launched it, independent of later browsing. */
internal data class TvChannelZapScope(
    val order: TvChannelZapOrder = TvChannelZapOrder.SOURCE,
    val playlistOrder: List<String> = emptyList(),
    val groupName: String? = null,
    val providerCategoryId: String? = null,
    val hiddenGroupTitles: List<String> = emptyList(),
    val hiddenCategoryIds: List<String> = emptyList(),
)

internal fun adjacentTvChannelInCapturedQueue(
    queue: List<TvChannelZapEntry>,
    playlistId: String,
    channelId: String,
    delta: Int,
): TvChannelZapEntry? {
    val currentIndex = queue.indexOfFirst { it.playlistId == playlistId && it.channelId == channelId }
    val nextIndex = nextTvChannelIndex(queue.size, currentIndex, delta) ?: return null
    return queue[nextIndex]
}

internal fun tvChannelEntryForNumber(queue: List<TvChannelZapEntry>, number: Int): TvChannelZapEntry? =
    tvChannelPositionForNumber(number)?.let(queue::getOrNull)

/** The original remote keypad accepts up to four digits and ignores further input. */
internal fun appendTvChannelNumberDigit(current: String, digit: Char, maxDigits: Int = 4): String =
    if (!digit.isDigit() || current.length >= maxDigits) current else current + digit

/** Returns the wrapped channel index for a remote channel-up/down action. */
fun nextTvChannelIndex(size: Int, currentIndex: Int, delta: Int): Int? {
    if (size < 2 || currentIndex !in 0 until size || delta == 0) return null
    return Math.floorMod(currentIndex + delta, size)
}

/** Resolves the original player's 1-based numeric channel position. */
fun tvChannelPositionForNumber(number: Int): Int? =
    number.takeIf { it > 0 }?.minus(1)

fun tvChannelIndexForNumber(size: Int, number: Int): Int? =
    tvChannelPositionForNumber(number)?.takeIf { it < size }
