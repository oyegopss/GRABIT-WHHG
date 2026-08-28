package com.grabit.vendor;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "PdfDownload")
public class PdfDownloadPlugin extends Plugin {
    private static final String TAG = "PdfDownloadPlugin";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadPdf(PluginCall call) {
        String base64Data = call.getString("base64");
        String fileName = call.getString("fileName", "GRABIT_Vendor_Analytics.pdf");
        boolean openImmediately = call.getBoolean("openImmediately", true);

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("Base64 PDF data is required");
            return;
        }

        if (base64Data.contains(",")) {
            base64Data = base64Data.substring(base64Data.indexOf(",") + 1);
        }

        byte[] pdfBytes;
        try {
            pdfBytes = Base64.decode(base64Data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            Log.e(TAG, "Invalid base64 payload", e);
            call.reject("Invalid base64 PDF payload: " + e.getMessage());
            return;
        }

        if (pdfBytes == null || pdfBytes.length == 0) {
            call.reject("Decoded PDF data is empty");
            return;
        }

        try {
            // 1. Save file to public Android Downloads directory
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                ContentResolver resolver = getContext().getContentResolver();
                Uri downloadUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (downloadUri != null) {
                    try (OutputStream out = resolver.openOutputStream(downloadUri)) {
                        if (out != null) {
                            out.write(pdfBytes);
                            out.flush();
                        }
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(downloadUri, values, null, null);
                    Log.i(TAG, "PDF saved to MediaStore.Downloads: " + downloadUri);
                }
            } else {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (downloadsDir != null) {
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs();
                    }
                    File publicFile = new File(downloadsDir, fileName);
                    try (FileOutputStream fos = new FileOutputStream(publicFile)) {
                        fos.write(pdfBytes);
                        fos.flush();
                    }
                    MediaScannerConnection.scanFile(
                        getContext(),
                        new String[]{publicFile.getAbsolutePath()},
                        new String[]{"application/pdf"},
                        null
                    );
                    Log.i(TAG, "PDF saved to public Downloads folder: " + publicFile.getAbsolutePath());
                }
            }

            // 2. Also write to cache directory for FileProvider preview/open
            File cacheFile = new File(getContext().getCacheDir(), fileName);
            try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                fos.write(pdfBytes);
                fos.flush();
            }

            Uri contentUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                cacheFile
            );

            // 3. Open PDF Viewer via ACTION_VIEW intent if requested
            if (openImmediately) {
                try {
                    Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                    viewIntent.setDataAndType(contentUri, "application/pdf");
                    viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                    Intent chooser = Intent.createChooser(viewIntent, "Open " + fileName);
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    getContext().startActivity(chooser);
                } catch (Exception intentEx) {
                    Log.w(TAG, "Could not launch PDF viewer chooser: " + intentEx.getMessage());
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("fileName", fileName);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error writing PDF to device storage", e);
            call.reject("Error saving PDF: " + e.getMessage());
        }
    }
}
