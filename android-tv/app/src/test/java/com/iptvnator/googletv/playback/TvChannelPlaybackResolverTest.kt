package com.iptvnator.googletv.playback

import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.tvCatchupAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvChannelPlaybackResolverTest {
    private val directRequest = TvPlaybackRequest("https://list.example/live/1", "Channel")

    @Test
    fun `prefers a resolved Xtream stream over the playlist URL`() = runBlocking {
        val resolved = directRequest.copy(uri = "https://provider.example/live/token/1.m3u8")

        val result = resolveTvChannelPlaybackRequest(
            channel = channel(),
            resolveStalker = { error("Stalker must not be used") },
            resolveXtream = { resolved },
            directRequest = { error("Direct fallback must not be used") },
        )

        assertEquals(resolved, result.getOrThrow())
    }

    @Test
    fun `uses the source URL when Xtream has no provider resolution`() = runBlocking {
        val result = resolveTvChannelPlaybackRequest(
            channel = channel(),
            resolveStalker = { error("Stalker must not be used") },
            resolveXtream = { null },
            directRequest = { directRequest },
        )

        assertEquals(directRequest, result.getOrThrow())
    }

    @Test
    fun `keeps provider resolution failures as failed results without taking another route`() = runBlocking {
        var xtreamCalled = false
        var directCalled = false
        val result = resolveTvChannelPlaybackRequest(
            channel = channel(providerCommand = "create_link"),
            resolveStalker = { throw IllegalStateException("portal unavailable") },
            resolveXtream = { xtreamCalled = true; directRequest },
            directRequest = { directCalled = true; directRequest },
        )

        assertTrue(result.isFailure)
        assertFalse(xtreamCalled)
        assertFalse(directCalled)
    }

    @Test
    fun `does not convert coroutine cancellation into a channel error`() = runBlocking {
        val cancellation = CancellationException("cancelled")
        try {
            resolveTvChannelPlaybackRequest(
                channel = channel(),
                resolveStalker = { throw cancellation },
                resolveXtream = { throw cancellation },
                directRequest = { directRequest },
            )
            throw AssertionError("Expected cancellation to propagate")
        } catch (actual: CancellationException) {
            assertEquals(cancellation, actual)
        }
    }

    @Test
    fun `catchup failure never falls through to the live channel url`() = runBlocking {
        var liveResolverCalled = false
        val result = resolveTvEpgPlaybackRequest(
            isCatchup = true,
            resolveCatchup = { null },
            resolveLive = { liveResolverCalled = true; directRequest },
        )

        assertTrue(result.isFailure)
        assertFalse(liveResolverCalled)
        assertTrue(result.exceptionOrNull()?.message.orEmpty().contains("catch-up"))
    }

    @Test
    fun `resolved catchup request is used instead of the live channel`() = runBlocking {
        val archive = directRequest.copy(uri = "https://archive.example/show.ts", title = "Channel · Show")
        var liveResolverCalled = false
        val result = resolveTvEpgPlaybackRequest(
            isCatchup = true,
            resolveCatchup = { archive },
            resolveLive = { liveResolverCalled = true; directRequest },
        )

        assertEquals(archive, result.getOrThrow())
        assertFalse(liveResolverCalled)
    }

    @Test
    fun `current programme without archive uses live playback`() = runBlocking {
        var catchupResolverCalled = false
        val result = resolveTvEpgPlaybackRequest(
            isCatchup = false,
            resolveCatchup = { catchupResolverCalled = true; null },
            resolveLive = { directRequest },
        )

        assertEquals(directRequest, result.getOrThrow())
        assertFalse(catchupResolverCalled)
    }

    @Test
    fun `current programme with archive uses start-over rather than the live channel`() = runBlocking {
        val now = 1_000_000L
        val channel = TvChannel(
            id = "xtream:42",
            name = "Channel",
            url = directRequest.uri,
            tvArchive = true,
            tvArchiveDurationMinutes = 60,
        )
        val currentProgramme = TvEpgEntry(
            channelId = channel.id,
            startMs = now - 5 * 60_000L,
            endMs = now + 25 * 60_000L,
            title = "Current show",
        )
        val archive = directRequest.copy(uri = "https://archive.example/show.ts", isLive = false)
        var liveResolverCalled = false
        val result = resolveTvEpgPlaybackRequest(
            isCatchup = tvCatchupAvailable(channel, currentProgramme, now),
            resolveCatchup = { archive },
            resolveLive = { liveResolverCalled = true; directRequest },
        )

        assertEquals(archive, result.getOrThrow())
        assertFalse(liveResolverCalled)
    }

    private fun channel(providerCommand: String? = null) = TvChannel(
        id = "live-1",
        name = "Channel",
        url = directRequest.uri,
        providerCommand = providerCommand,
    )
}
