package org.tvshell.iptvnator.ui;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.NotFoundException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

/** Round-trip the server invitation and TV approval QR formats through ZXing. */
final class PairingQrTest {
    static void main(String[] args) throws Exception {
        String id = "a".repeat(43);
        for (String origin : new String[] {"https://server.example", "http://192.168.1.2:4334"}) {
            String url = origin + "/approve-device/" + id;
            String decoded = roundTrip(url);
            if (!url.equals(decoded) || !id.equals(PairingLink.approvalClaim(decoded, origin))) throw new AssertionError();
            PairingLink invite = PairingLink.scannedInvite(roundTrip(origin + "/pair-device#" + id));
            if (invite == null || !origin.equals(invite.origin) || !id.equals(invite.inviteId)) throw new AssertionError();
        }
        try {
            QrImageDecoder.decode(new int[128 * 128], 128, 128);
            throw new AssertionError("Blank image accepted");
        } catch (NotFoundException expected) {
            // The scanner lets the user choose another image.
        }
        System.out.println("Pairing QR round-trip checks passed");
    }

    private static String roundTrip(String url) throws Exception {
        BitMatrix matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 512, 512);
        int width = 720;
        int height = 1080;
        int[] pixels = new int[width * height];
        for (int y = 0; y < 512; y++) for (int x = 0; x < 512; x++) {
            // A rotated QR surrounded by other pixels, as in a saved photo.
            pixels[(200 + x) * width + 80 + 511 - y] = matrix.get(x, y) ? 0xff000000 : 0xffffffff;
        }
        return QrImageDecoder.decode(pixels, width, height);
    }
}
