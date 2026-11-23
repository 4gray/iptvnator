package org.tvshell.iptvnator.ui;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.Toast;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.ReaderException;
import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.CaptureManager;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import java.io.IOException;
import java.io.InputStream;
import org.tvshell.iptvnator.R;

/** The phone's QR scanner keeps its portrait layout regardless of device rotation. */
public final class LibraryQrActivity extends CaptureActivity {
    private static final int PICK_QR_IMAGE = 1;
    private static final int MAX_IMAGE_SIDE = 2048;
    private DecoratedBarcodeView scanner;
    private Button imageButton;
    private boolean readingImage;
    private boolean resumed;

    @Override
    protected DecoratedBarcodeView initializeContent() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setContentView(R.layout.activity_library_qr);
        new TouchWindowInsets(this, findViewById(R.id.library_qr_root)).setActive(true);
        findViewById(R.id.library_qr_close).setOnClickListener(view -> finish());
        imageButton = findViewById(R.id.library_qr_image);
        imageButton.setOnClickListener(view -> pickImage());
        scanner = findViewById(R.id.zxing_barcode_scanner);
        return scanner;
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (readingImage) scanner.pause();
    }

    @Override
    protected void onPause() {
        resumed = false;
        super.onPause();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == CaptureManager.getCameraPermissionReqCode()
                && (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            // Leave the scanner open so the image picker is still available.
            Toast.makeText(this, R.string.scan_qr_camera_denied, Toast.LENGTH_LONG).show();
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private void pickImage() {
        try {
            startActivityForResult(new Intent(Intent.ACTION_GET_CONTENT)
                .addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"), PICK_QR_IMAGE);
        } catch (ActivityNotFoundException | SecurityException failure) {
            Toast.makeText(this, R.string.scan_qr_image_unreadable, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode != PICK_QR_IMAGE || resultCode != RESULT_OK
                || result == null || result.getData() == null || isFinishing()) return;
        Uri image = result.getData();
        readingImage = true;
        imageButton.setEnabled(false);
        imageButton.setText(R.string.scan_qr_image_reading);
        scanner.pause();
        new Thread(() -> {
            try {
                String contents = readImage(image);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setResult(RESULT_OK, new Intent(Intents.Scan.ACTION)
                        .putExtra(Intents.Scan.RESULT, contents)
                        .putExtra(Intents.Scan.RESULT_FORMAT, BarcodeFormat.QR_CODE.name()));
                    finish();
                });
            } catch (ReaderException noCode) {
                runOnUiThread(() -> imageFailed(R.string.scan_qr_image_no_code));
            } catch (IOException | RuntimeException unreadable) {
                runOnUiThread(() -> imageFailed(R.string.scan_qr_image_unreadable));
            }
        }, "library-qr-image").start();
    }

    private String readImage(Uri image) throws IOException, ReaderException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream input = getContentResolver().openInputStream(image)) {
            BitmapFactory.decodeStream(input, null, options);
        }
        if (options.outWidth < 1 || options.outHeight < 1) throw new IOException("Invalid image");
        options.inSampleSize = 1;
        int side = Math.max(options.outWidth, options.outHeight);
        while ((side - 1) / options.inSampleSize >= MAX_IMAGE_SIDE) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap;
        try (InputStream input = getContentResolver().openInputStream(image)) {
            bitmap = BitmapFactory.decodeStream(input, null, options);
        }
        if (bitmap == null) throw new IOException("Invalid image");
        try {
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            int[] pixels = new int[width * height];
            bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
            return QrImageDecoder.decode(pixels, width, height);
        } finally {
            bitmap.recycle();
        }
    }

    private void imageFailed(int message) {
        if (isFinishing() || isDestroyed()) return;
        readingImage = false;
        imageButton.setEnabled(true);
        imageButton.setText(R.string.scan_qr_image);
        if (resumed && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            scanner.resume();
        }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
