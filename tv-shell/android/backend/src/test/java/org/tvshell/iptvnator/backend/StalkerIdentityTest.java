package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

/** Reference values computed with the TypeScript original (devserver/backend-logic.mjs). */
public class StalkerIdentityTest {

    public void testProfileRequestCarriesSerialInParamsMetricsCookieAndHeaders() {
        Map<String, String> params = new LinkedHashMap<String, String>();
        params.put("type", "stb");
        params.put("action", "get_profile");
        params.put("sn", "OLD");
        params.put("metrics", "{\"mac\":\"m\",\"sn\":\"old\"}");
        StalkerIdentity.RequestContext ctx = StalkerIdentity.build("00:1A:79:AA:BB:CC", params, "tok", "ab12CD34");
        assertEquals("cookie", "mac=00:1A:79:AA:BB:CC; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin; __cfduid=ab12cd34e030245495acd6ebfc100000", ctx.headers.get("Cookie"));
        assertEquals("ua", StalkerIdentity.STALKER_MAG_USER_AGENT, ctx.headers.get("User-Agent"));
        assertEquals("x-ua", StalkerIdentity.STALKER_MAG_USER_AGENT, ctx.headers.get("X-User-Agent"));
        assertEquals("sn header", "ab12CD34", ctx.headers.get("SN"));
        assertEquals("auth", "Bearer tok", ctx.headers.get("Authorization"));
        assertEquals("sn param", "ab12CD34", ctx.requestParams.get("sn"));
        assertEquals("metrics", "{\"mac\":\"m\",\"sn\":\"ab12CD34\"}", ctx.requestParams.get("metrics"));
        assertEquals("accept-language", "en-US,en;q=0.9", ctx.headers.get("Accept-Language"));
    }

    public void testNonProfileRequestDropsSerialAndLegacyDefault() {
        Map<String, String> params = new LinkedHashMap<String, String>();
        params.put("type", "itv");
        params.put("action", "get_all_channels");
        params.put("sn", "X");
        StalkerIdentity.RequestContext ctx = StalkerIdentity.build("00:1A:79:AA:BB:CC", params, null, "BEDACD4569BAF");
        assertEquals("cookie without cfduid", "mac=00:1A:79:AA:BB:CC; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin", ctx.headers.get("Cookie"));
        assertTrue("no SN header", !ctx.headers.containsKey("SN"));
        assertTrue("no Authorization", !ctx.headers.containsKey("Authorization"));
        assertTrue("sn param removed", !ctx.requestParams.containsKey("sn"));
        assertEquals("params kept", "get_all_channels", ctx.requestParams.get("action"));
    }

    public void testCfduidIsPaddedAndTruncated() {
        assertEquals("non-hex serial: suffix padded with zeros", "e030245495acd6ebfc10000000000000", StalkerIdentity.buildSerialCfduid("ZZ"));
        assertEquals("hex serial lowercased + suffix", "ab12cd34e030245495acd6ebfc100000", StalkerIdentity.buildSerialCfduid("ab12CD34"));
        assertEquals("long serial truncated", 32, Integer.valueOf(StalkerIdentity.buildSerialCfduid("abcdefabcdefabcdefabcdefabcdef1234567890").length()));
    }
}
