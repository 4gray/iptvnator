package org.tvshell.iptvnator.ui;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.common.HybridBinarizer;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;

final class QrImageDecoder {
    private QrImageDecoder() {}

    static String decode(int[] pixels, int width, int height) throws ReaderException {
        for (int i = 0; i < pixels.length; i++) {
            if ((pixels[i] >>> 24) == 0) pixels[i] = 0xffffffff;
        }
        BinaryBitmap image = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels)));
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Collections.singletonList(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, true);
        hints.put(DecodeHintType.ALSO_INVERTED, true);
        return new MultiFormatReader().decode(image, hints).getText();
    }
}
