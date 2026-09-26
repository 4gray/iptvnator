package com.iptvnator.googletv.epg

import java.io.InputStream
import java.io.StringReader
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import javax.xml.XMLConstants
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.InputSource
import org.xml.sax.helpers.DefaultHandler

data class TvEpgEntry(
    val channelId: String,
    val startMs: Long,
    val endMs: Long,
    val title: String,
    val subtitle: String? = null,
    val description: String? = null,
    val category: String? = null,
)

/** Secure, provider-neutral XMLTV parser shared by M3U/Xtream/Stalker guides. */
object TvXmlTvParser {
    private val xmlTvDatePattern = Regex("^(\\d{14})(?:\\s*([+-]\\d{2}:?\\d{2}|Z))?$", RegexOption.IGNORE_CASE)
    private val xmlTvDateFormatter = DateTimeFormatter.ofPattern("yyyyMMddHHmmss")

    /** Convenience API for small fixtures and callers that need an in-memory list. */
    fun parse(input: InputStream): List<TvEpgEntry> = buildList { parse(input, ::add) }

    /** SAX parser that emits programmes as they arrive instead of building an XML DOM. */
    fun parse(input: InputStream, onEntry: (TvEpgEntry) -> Unit) {
        val factory = SAXParserFactory.newInstance().apply {
            isNamespaceAware = false
            runCatching { isXIncludeAware = false }
            setFeatureIfSupported(XMLConstants.FEATURE_SECURE_PROCESSING, true)
            setFeatureIfSupported("http://apache.org/xml/features/disallow-doctype-decl", true)
            setFeatureIfSupported("http://xml.org/sax/features/external-general-entities", false)
            setFeatureIfSupported("http://xml.org/sax/features/external-parameter-entities", false)
            setFeatureIfSupported("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
        }
        val reader = factory.newSAXParser().xmlReader
        reader.entityResolver = org.xml.sax.EntityResolver { _, _ -> InputSource(StringReader("")) }
        reader.contentHandler = object : DefaultHandler() {
            private var depth = 0
            private var programmeDepth = -1
            private var captureDepth = -1
            private var captureName: String? = null
            private val capture = StringBuilder()
            private var channelId = ""
            private var startMs: Long? = null
            private var endMs: Long? = null
            private var title: String? = null
            private var subtitle: String? = null
            private var description: String? = null
            private var category: String? = null

            override fun startElement(uri: String?, localName: String?, qName: String, attributes: Attributes) {
                depth += 1
                val name = qName.ifBlank { localName.orEmpty() }
                if (name == "programme" && programmeDepth < 0) {
                    programmeDepth = depth
                    channelId = attributes.getValue("channel")?.trim().orEmpty()
                    startMs = parseXmlTvDate(attributes.getValue("start").orEmpty())
                    endMs = parseXmlTvDate(attributes.getValue("stop").orEmpty())
                    title = null
                    subtitle = null
                    description = null
                    category = null
                } else if (
                    programmeDepth >= 0 && captureName == null &&
                    name in setOf("title", "sub-title", "desc", "category")
                ) {
                    captureName = name
                    captureDepth = depth
                    capture.setLength(0)
                }
            }

            override fun characters(ch: CharArray, start: Int, length: Int) {
                if (captureName != null) capture.append(ch, start, length)
            }

            override fun endElement(uri: String?, localName: String?, qName: String) {
                val name = qName.ifBlank { localName.orEmpty() }
                if (captureName == name && captureDepth == depth) {
                    val text = capture.toString().trim().takeIf(String::isNotBlank)
                    when (name) {
                        "title" -> if (title == null) title = text
                        "sub-title" -> if (subtitle == null) subtitle = text
                        "desc" -> if (description == null) description = text
                        "category" -> if (category == null) category = text
                    }
                    captureName = null
                    captureDepth = -1
                }
                if (name == "programme" && programmeDepth == depth) {
                    val start = startMs
                    val end = endMs
                    val programmeTitle = title
                    if (channelId.isNotBlank() && start != null && end != null && end > start && programmeTitle != null) {
                        onEntry(TvEpgEntry(channelId, start, end, programmeTitle, subtitle, description, category))
                    }
                    programmeDepth = -1
                    captureName = null
                    captureDepth = -1
                }
                depth -= 1
            }
        }
        reader.parse(InputSource(input))
    }

    private fun SAXParserFactory.setFeatureIfSupported(name: String, value: Boolean) {
        runCatching { setFeature(name, value) }
    }

    private fun parseXmlTvDate(raw: String): Long? {
        val normalized = raw.trim().replace(Regex("\\s+"), " ")
        val match = xmlTvDatePattern.matchEntire(normalized) ?: return null
        return try {
            val local = LocalDateTime.parse(match.groupValues[1], xmlTvDateFormatter)
            val explicitOffset = match.groupValues[2].takeIf(String::isNotBlank)?.let { value ->
                if (value.equals("Z", ignoreCase = true)) ZoneOffset.UTC
                else ZoneOffset.of(value.take(3) + ":" + value.substringAfter(':', value.substring(3)))
            }
            // Date.parse (used by the original IPTVnator XMLTV path) treats
            // a timestamp without an explicit offset as local time.
            if (explicitOffset != null) {
                local.toInstant(explicitOffset).toEpochMilli()
            } else {
                local.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            }
        } catch (_: DateTimeParseException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
