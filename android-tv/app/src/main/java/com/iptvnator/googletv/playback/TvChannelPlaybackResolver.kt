package com.iptvnator.googletv.playback

import com.iptvnator.googletv.playlist.TvChannel
import kotlinx.coroutines.CancellationException

/** Resolves a live channel before its caller commits the channel switch to UI state. */
internal suspend fun resolveTvChannelPlaybackRequest(
    channel: TvChannel,
    resolveStalker: suspend () -> TvPlaybackRequest,
    resolveXtream: suspend () -> TvPlaybackRequest?,
    directRequest: () -> TvPlaybackRequest,
): Result<TvPlaybackRequest> = try {
    Result.success(
        if (channel.providerCommand != null) resolveStalker()
        else resolveXtream() ?: directRequest(),
    )
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (failure: Exception) {
    Result.failure(failure)
}

/** Past EPG selections must never silently fall through to the live channel URL. */
internal suspend fun resolveTvEpgPlaybackRequest(
    isCatchup: Boolean,
    resolveCatchup: suspend () -> TvPlaybackRequest?,
    resolveLive: suspend () -> TvPlaybackRequest,
): Result<TvPlaybackRequest> = try {
    Result.success(
        if (isCatchup) {
            resolveCatchup() ?: error("El archivo catch-up de este programa no está disponible.")
        } else {
            resolveLive()
        },
    )
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (failure: Exception) {
    Result.failure(failure)
}
