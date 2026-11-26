package org.tvshell.iptvnator.ui;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Untrusted custom-scheme input. Parsing never performs network or preference writes. */
public final class PairingLink {
    public final String origin;
    public final String inviteId;

    private PairingLink(String origin, String inviteId) {
        this.origin = origin;
        this.inviteId = inviteId;
    }

    static final class CloudflareInvite {
        final String origin;
        final String instance;
        final String inviteId;

        CloudflareInvite(String origin, String instance, String inviteId) {
            this.origin = origin;
            this.instance = instance;
            this.inviteId = inviteId;
        }
    }

    static CloudflareInvite scannedCloudflareInvite(String input) {
        if (input == null || input.length() > 2048) return null;
        try {
            URI uri = new URI(input);
            if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null) return null;
            String path = uri.getRawPath();
            boolean pairingPage = "/connect-device.html".equals(path);
            if (!pairingPage && !"".equals(path) && !"/".equals(path)) return null;
            String fragment = uri.getFragment();
            String prefix = "iptvnator-access=";
            if (fragment == null || !fragment.startsWith(prefix)) return null;
            String[] parts = fragment.substring(prefix.length()).split("&invite=", -1);
            if (!parts[0].matches("[A-Za-z0-9_-]{1,200}")
                || (pairingPage ? parts.length != 2 || !opaqueId(parts[1]) : parts.length != 1))
                return null;
            return new CloudflareInvite(originOf(uri), parts[0], pairingPage ? parts[1] : "");
        } catch (URISyntaxException | IllegalArgumentException ignored) {
            return null;
        }
    }

    public static PairingLink parse(String input) {
        try {
            if (input == null || input.length() > 2048) throw new IllegalArgumentException();
            URI uri = new URI(input);
            if (!"iptvnator".equals(uri.getScheme()) || !"pair".equals(uri.getRawAuthority())
                || !"".equals(uri.getRawPath()) || uri.getRawFragment() != null
                || uri.getRawQuery() == null) throw new IllegalArgumentException();
            Map<String, String> fields = new HashMap<>();
            for (String part : uri.getRawQuery().split("&", -1)) {
                String[] pair = part.split("=", 2);
                if (pair.length != 2 || (!pair[0].equals("server") && !pair[0].equals("invite"))
                    || fields.containsKey(pair[0])) throw new IllegalArgumentException();
                fields.put(pair[0], URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name()));
            }
            String address = fields.get("server");
            String origin = HostedOrigin.normalize(address);
            // A QR handoff names one exact origin, never an API/path alias or whitespace.
            if (!origin.equals(address) || !opaqueId(fields.get("invite"))) throw new IllegalArgumentException();
            return new PairingLink(origin, fields.get("invite"));
        } catch (Exception e) {
            // Do not retain the supplied URL in exception text or causes.
            throw new IllegalArgumentException("Invalid pairing link");
        }
    }

    /** A server QR uses the same invitation as its browser landing page. */
    static PairingLink scannedInvite(String input) {
        if (input == null || input.length() > 2048) return null;
        try {
            URI uri = new URI(input);
            if ("iptvnator".equals(uri.getScheme())) return parse(input);
            if (!"/pair-device".equals(uri.getRawPath()) || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || !opaqueId(uri.getRawFragment())) return null;
            return new PairingLink(originOf(uri), uri.getRawFragment());
        } catch (URISyntaxException | IllegalArgumentException ignored) {
            return null;
        }
    }

    /** Recognize an approval QR even when the phone has no selected library. */
    static boolean isApprovalCode(String address) {
        if (address == null || address.length() > 2048) return false;
        try {
            return approvalClaim(address, originOf(new URI(address))) != null;
        } catch (URISyntaxException | IllegalArgumentException ignored) {
            return false;
        }
    }

    private static String originOf(URI uri) throws URISyntaxException {
        if (uri.getHost() == null) throw new IllegalArgumentException("Missing host");
        return HostedOrigin.normalize(new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString());
    }

    /** Approval URLs carry only the public claim ID, never the claim secret. */
    public static String approvalOrigin(String address, String claimId) {
        return approvalOrigin(address, claimId, null);
    }

    static String approvalOrigin(String address, String claimId, String pairedOrigin) {
        try {
            if (address == null || address.length() > 2048 || !opaqueId(claimId)) return null;
            URI uri = new URI(address);
            if ((!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) || uri.getRawUserInfo() != null
                || !(("/approve-device/" + claimId).equals(uri.getRawPath())) || uri.getRawQuery() != null
                || uri.getRawFragment() != null) return null;
            String origin = originOf(uri);
            if ("http".equals(uri.getScheme()) && (!origin.equals(pairedOrigin) || uri.getPort() != 4334 || !privateIpv4(uri.getHost()))) return null;
            return origin;
        } catch (Exception e) { return null; }
    }

    /** HTTP QR links are allowed only for the exact paired private IPv4 origin. */
    public static String approvalClaim(String address, String pairedOrigin) {
        try {
            URI uri = new URI(address);
            String path = uri.getRawPath();
            if (path == null || !path.startsWith("/approve-device/")) return null;
            String claim = path.substring("/approve-device/".length());
            String origin = approvalOrigin(address, claim, pairedOrigin);
            if (origin == null) return null;
            if (origin.startsWith("http://")) {
                if (!origin.equals(pairedOrigin) || uri.getPort() != 4334 || !privateIpv4(uri.getHost())) return null;
            }
            return claim;
        } catch (Exception e) { return null; }
    }

    static boolean privateIpv4(String host) {
        if (host == null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] parts = host.split("\\.");
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            octets[i] = Integer.parseInt(parts[i]);
            if (octets[i] > 255 || (parts[i].length() > 1 && parts[i].startsWith("0"))) return false;
        }
        return octets[0] == 10 || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] == 192 && octets[1] == 168);
    }

    public static boolean opaqueId(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{43}");
    }
}
