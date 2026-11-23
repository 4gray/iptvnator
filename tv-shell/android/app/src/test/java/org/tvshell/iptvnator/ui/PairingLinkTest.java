package org.tvshell.iptvnator.ui;

/** QR links are untrusted: exact scheme, authority, origin and unique fields only. */
public final class PairingLinkTest {
    private static final String ID = "A".repeat(43);
    private static final String VALID = "iptvnator://pair?server=https%3A%2F%2Fserver.example&invite=" + ID;

    private static void reject(String value) {
        try { PairingLink.parse(value); throw new AssertionError("Accepted invalid link"); }
        catch (IllegalArgumentException expected) {
            if (expected.getCause() != null || !"Invalid pairing link".equals(expected.getMessage())) throw new AssertionError("Input leaked");
        }
    }

    public static void main(String[] args) {
        if (!"https://server.example".equals(PairingLink.approvalOrigin("https://server.example/approve-device/" + ID, ID))) throw new AssertionError();
        if (!ID.equals(PairingLink.approvalClaim("https://different.example/approve-device/" + ID, "http://192.168.1.2:4334"))) throw new AssertionError();
        if (!ID.equals(PairingLink.approvalClaim("http://192.168.1.2:4334/approve-device/" + ID, "http://192.168.1.2:4334"))) throw new AssertionError();
        if (PairingLink.approvalClaim("http://192.168.1.3:4334/approve-device/" + ID, "http://192.168.1.2:4334") != null
            || PairingLink.approvalClaim("http://8.8.8.8:4334/approve-device/" + ID, "http://8.8.8.8:4334") != null) throw new AssertionError();
        for (String url : new String[] {"http://server.example/approve-device/" + ID,
            "https://user@server.example/approve-device/" + ID,
            "https://server.example/approve-device/" + ID + "?secret=x",
            "https://server.example/approve-device/evil/" + ID,
            "https://server.example/approve-device/wrong",
            "https://server.example/approve-device/" + ID + "#fragment"}) {
            if (PairingLink.approvalOrigin(url, ID) != null) throw new AssertionError(url);
        }
        PairingLink link = PairingLink.parse(VALID);
        if (!link.origin.equals("https://server.example") || !link.inviteId.equals(ID)) throw new AssertionError();
        if (!ID.equals(PairingLink.scannedInvite(VALID).inviteId)) throw new AssertionError();
        String cloudflare = "https://server.example/connect-device.html#iptvnator-access=instance&invite=" + ID;
        PairingLink.CloudflareInvite access = PairingLink.scannedCloudflareInvite(cloudflare);
        if (access == null || !"https://server.example".equals(access.origin)
            || !"instance".equals(access.instance) || !ID.equals(access.inviteId)) throw new AssertionError();
        PairingLink.CloudflareInvite legacy = PairingLink.scannedCloudflareInvite("https://server.example/#iptvnator-access=instance");
        if (legacy == null || !legacy.inviteId.isEmpty()) throw new AssertionError();
        for (String invalid : new String[] {
            cloudflare.replace("https:", "http:"),
            cloudflare.replace("//server", "//user@server"),
            cloudflare.replace(".html#", ".html?unexpected=1#"),
            cloudflare.replace("connect-device.html", "other.html"),
            cloudflare.substring(0, cloudflare.length() - ID.length()),
            cloudflare + "&invite=" + ID
        }) {
            if (PairingLink.scannedCloudflareInvite(invalid) != null) throw new AssertionError("Accepted invalid Cloudflare QR");
        }
        for (String address : new String[] {
            "https://user@server.example/pair-device#" + ID,
            "https://server.example/pair-device?invite=" + ID + "#" + ID,
            "https://server.example/pair-device/#" + ID,
            "https://server.example/pair-device",
            "https://server.example/pair-device#%41" + ID.substring(1),
            "https://server.example/#" + ID,
            "https://server.example/approve-device/" + ID,
            "file:///pair-device#" + ID
        }) {
            if (PairingLink.scannedInvite(address) != null) throw new AssertionError("Accepted invalid invite QR");
        }
        if (!PairingLink.isApprovalCode("http://192.168.1.2:4334/approve-device/" + ID)
            || PairingLink.isApprovalCode("http://8.8.8.8:4334/approve-device/" + ID)
            || PairingLink.isApprovalCode("https://server.example/pair-device#" + ID)) throw new AssertionError();
        PairingLink.parse("iptvnator://pair?invite=" + ID + "&server=http%3A%2F%2F192.168.1.2%3A8080");
        reject(null);
        reject(VALID.replace("iptvnator", "https"));
        reject(VALID.replace("//pair", "//pair.evil.test"));
        reject(VALID.replace("//pair", "//user@pair"));
        reject(VALID.replace("//pair", "//pair:80"));
        reject(VALID.replace("//pair?", "//pair/?"));
        reject(VALID + "#fragment");
        reject(VALID + "&server=https%3A%2F%2Fevil.test");
        reject(VALID + "&invite=" + ID);
        reject(VALID + "&token=unexpected");
        reject(VALID.replace("server.example", "user%40server.example"));
        reject(VALID.replace("server.example", "server.example%2Fapi"));
        reject(VALID.replace("server.example", "server.example%3Ftoken%3Dsecret"));
        reject(VALID.replace("https%3A", "%20https%3A"));
        reject(VALID.replace(ID, "a"));
        reject(VALID.replace(ID, "+".repeat(43)));
        reject(VALID.replace(ID, "%ZZ"));
        reject(VALID + "&");
        System.out.println("Pairing link checks passed");
    }
}
