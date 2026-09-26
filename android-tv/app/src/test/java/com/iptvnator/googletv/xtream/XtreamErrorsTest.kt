package com.iptvnator.googletv.xtream

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertTrue
import org.junit.Test

class XtreamErrorsTest {
    @Test
    fun `maps network failures to actionable messages`() {
        assertTrue(friendlyXtreamError(UnknownHostException("provider.example")).contains("encuentra"))
        assertTrue(friendlyXtreamError(SocketTimeoutException()).contains("tiempo"))
        assertTrue(friendlyXtreamError(ConnectException()).contains("conectar"))
    }

    @Test
    fun `preserves authentication guidance`() {
        val message = friendlyXtreamError(IllegalStateException("Xtream account authentication failed"))
        assertTrue(message.contains("usuario"))
    }
}
