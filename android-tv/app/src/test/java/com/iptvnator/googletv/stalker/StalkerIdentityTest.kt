package com.iptvnator.googletv.stalker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StalkerIdentityTest {
    @Test
    fun `derives the same reference pair as StbEmu and stalker-to-m3u`() {
        assertEquals(
            StalkerDerivedDeviceIds(
                deviceId1 = "A446559A63A6A489959198534E649760C6A9A6474DEE7C20314C2F1903B36422",
                deviceId2 = "BBD059367A90B0166654E6D4F9E09786CE64EB97674D1AF8D1EE2AE335D7205B",
            ),
            deriveStalkerDeviceIdsFromMac("00:1A:79:AB:CD:EF"),
        )
    }

    @Test
    fun `normalizes MAC formats and refuses to hash an invalid address`() {
        val expected = deriveStalkerDeviceIdsFromMac("00:1A:79:AB:CD:EF")

        assertEquals(expected, deriveStalkerDeviceIdsFromMac("00-1a-79-ab-cd-ef"))
        assertEquals(expected, deriveStalkerDeviceIdsFromMac("001A79ABCDEF"))
        assertNull(deriveStalkerDeviceIdsFromMac("00:1A:79"))
        assertNull(deriveStalkerDeviceIdsFromMac(""))
    }

    @Test
    fun `device ID pair is distinct and uppercase hexadecimal`() {
        val derived = requireNotNull(deriveStalkerDeviceIdsFromMac("00:1A:79:00:00:01"))

        assertNotEquals(derived.deviceId1, derived.deviceId2)
        assert(derived.deviceId1.matches(Regex("[0-9A-F]{64}")))
        assert(derived.deviceId2.matches(Regex("[0-9A-F]{64}")))
    }
}
