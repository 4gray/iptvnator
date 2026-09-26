package com.iptvnator.googletv.epg

import java.io.ByteArrayInputStream
import java.time.Instant
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TvXmlTvParserTest {
    @Test
    fun `parses programme metadata and timezone`() {
        val entries = TvXmlTvParser.parse(ByteArrayInputStream("""
            <?xml version="1.0"?>
            <tv><programme channel="news" start="20260920120000 +0200" stop="20260920130000 +0200">
              <title>Noticias</title><sub-title>Mediodía</sub-title><desc>Resumen diario</desc><category>Información</category>
            </programme></tv>
        """.trimIndent().toByteArray()))
        assertEquals(1, entries.size)
        assertEquals("news", entries.single().channelId)
        assertEquals("Noticias", entries.single().title)
        assertEquals("Mediodía", entries.single().subtitle)
        assertEquals("Información", entries.single().category)
        assertTrue(entries.single().endMs > entries.single().startMs)
    }

    @Test
    fun `ignores incomplete programmes`() {
        val entries = TvXmlTvParser.parse(ByteArrayInputStream("<tv><programme channel=\"x\"><title>Sin fecha</title></programme></tv>".toByteArray()))
        assertTrue(entries.isEmpty())
    }

    @Test
    fun `emits entries incrementally and preserves split character data`() {
        val received = mutableListOf<TvEpgEntry>()
        TvXmlTvParser.parse(ByteArrayInputStream("""
            <tv><programme channel="one" start="20300101120000 Z" stop="20300101130000 Z">
              <title>Part<![CDATA[ial]]> title</title>
            </programme><programme channel="bad"><title>Ignored</title></programme></tv>
        """.trimIndent().toByteArray()), received::add)

        assertEquals(listOf("Partial title"), received.map(TvEpgEntry::title))
    }

    @Test
    fun `parses utc xmltv fixture dates`() {
        val entries = TvXmlTvParser.parse(ByteArrayInputStream("""
            <tv><programme channel="demo.one" start="20300101120000 +0000" stop="20300101130000 +0000">
              <title>Programa de prueba</title>
            </programme></tv>
        """.trimIndent().toByteArray()))
        assertEquals(1, entries.size)
    }

    @Test
    fun `accepts colonized and zulu xmltv offsets`() {
        val entries = TvXmlTvParser.parse(ByteArrayInputStream("""
            <tv>
              <programme channel="colon" start="20300101120000 +02:00" stop="20300101130000 +02:00"><title>Colon</title></programme>
              <programme channel="zulu" start="20300101100000 Z" stop="20300101110000 Z"><title>Zulú</title></programme>
            </tv>
        """.trimIndent().toByteArray()))

        assertEquals(2, entries.size)
        assertEquals(Instant.parse("2030-01-01T10:00:00Z").toEpochMilli(), entries[0].startMs)
        assertEquals(Instant.parse("2030-01-01T10:00:00Z").toEpochMilli(), entries[1].startMs)
    }

    @Test
    fun `interprets xmltv timestamps without offset in local timezone`() {
        val previous = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Europe/Madrid"))
            val entries = TvXmlTvParser.parse(ByteArrayInputStream("""
                <tv><programme channel="local" start="20300101120000" stop="20300101130000">
                  <title>Hora local</title>
                </programme></tv>
            """.trimIndent().toByteArray()))
            assertEquals(1, entries.size)
            assertEquals(Instant.parse("2030-01-01T11:00:00Z").toEpochMilli(), entries.single().startMs)
        } finally {
            TimeZone.setDefault(previous)
        }
    }
}
