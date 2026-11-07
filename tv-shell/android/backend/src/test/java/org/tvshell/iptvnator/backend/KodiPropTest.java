package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.util.Map;

/** Mirrors the cases in libs/shared/m3u-utils kodiprop.utils.spec.ts. */
public class KodiPropTest {

    public void testNoKodipropMeansNoDrm() {
        assertTrue("null raw", KodiProp.extractDrmFromRaw(null) == null);
        assertTrue("plain raw", KodiProp.extractDrmFromRaw("#EXTINF:-1,A\r\nhttp://x") == null);
        assertTrue("unrelated prop", KodiProp.extractDrmFromRaw("#KODIPROP:inputstream.adaptive.manifest_type=mpd\r\nhttp://x") == null);
    }

    @SuppressWarnings("unchecked")
    public void testClearKeyPairs() {
        Map<String, Object> drm = KodiProp.extractDrmFromRaw(
            "#KODIPROP:inputstream.adaptive.license_type=clearkey\r\n"
            + "#KODIPROP:inputstream.adaptive.license_key=00112233445566778899AABBCCDDEEFF:ffeeddccbbaa99887766554433221100,0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210\r\n"
            + "#EXTINF:-1,E\r\nhttp://x/e.mpd");
        assertEquals("type", "clearkey", drm.get("licenseType"));
        assertEquals("supported", Boolean.TRUE, drm.get("supported"));
        Map<String, Object> keys = (Map<String, Object>) drm.get("clearKeys");
        assertEquals("key 1", "ffeeddccbbaa99887766554433221100", keys.get("00112233445566778899aabbccddeeff"));
        assertEquals("key 2", "fedcba9876543210fedcba9876543210", keys.get("0123456789abcdef0123456789abcdef"));
    }

    @SuppressWarnings("unchecked")
    public void testClearKeyJsonFormsAndBase64() {
        Map<String, Object> w3c = KodiProp.extractDrmFromRaw(
            "#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey\r\n"
            + "#KODIPROP:inputstream.adaptive.license_key={\"keys\":[{\"kty\":\"oct\",\"kid\":\"ABEiM0RVZneImaq7zN3u_w\",\"k\":\"_-7dzLuqmYh3ZlVEMyIRAA\"}]}");
        assertEquals("w3c type", "org.w3.clearkey", w3c.get("licenseType"));
        Map<String, Object> keys = (Map<String, Object>) w3c.get("clearKeys");
        assertEquals("base64url kid → hex", "ffeeddccbbaa99887766554433221100", keys.get("00112233445566778899aabbccddeeff"));

        Map<String, Object> map = KodiProp.extractDrmFromRaw(
            "#KODIPROP:inputstream.adaptive.license_key={\"00112233-4455-6677-8899-aabbccddeeff\":\"ffeeddccbbaa99887766554433221100\"}");
        assertEquals("map without type defaults to clearkey", "clearkey", map.get("licenseType"));
        assertEquals("map supported", Boolean.TRUE, map.get("supported"));
    }

    public void testLegacyAndUnsupportedTypes() {
        Map<String, Object> legacy = KodiProp.extractDrmFromRaw(
            "#KODIPROP:inputstream.adaptive.drm_legacy=clearkey|00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100");
        assertEquals("legacy type", "clearkey", legacy.get("licenseType"));
        assertEquals("legacy supported", Boolean.TRUE, legacy.get("supported"));

        Map<String, Object> widevine = KodiProp.extractDrmFromRaw(
            "#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\r\n#KODIPROP:inputstream.adaptive.license_key=https://license.example/");
        assertEquals("widevine type", "com.widevine.alpha", widevine.get("licenseType"));
        assertEquals("widevine unsupported", Boolean.FALSE, widevine.get("supported"));
        assertTrue("no keys", !widevine.containsKey("clearKeys"));

        Map<String, Object> malformed = KodiProp.extractDrmFromRaw(
            "#KODIPROP:inputstream.adaptive.license_type=clearkey\r\n#KODIPROP:inputstream.adaptive.license_key=not:a:key");
        assertEquals("malformed unsupported", Boolean.FALSE, malformed.get("supported"));
    }
}
