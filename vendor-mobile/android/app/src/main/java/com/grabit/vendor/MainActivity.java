package com.grabit.vendor;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private int topInsetDp = 0;
    private int bottomInsetDp = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        OrderAlertPlugin.ensureNotificationChannels(this);
        registerPlugin(NativeSettingsPlugin.class);
        registerPlugin(ThermalPrinterPlugin.class);
        registerPlugin(OrderAlertPlugin.class);
        registerPlugin(PdfDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        
        OrderAlertPlugin.handleIncomingIntent(getIntent());

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            topInsetDp = Math.round(systemBars.top / density);
            bottomInsetDp = Math.round(systemBars.bottom / density);
            applySafeAreaToWebView();
            return insets;
        });

        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    applySafeAreaToWebView();
                }
            });
        }
    }

    private void applySafeAreaToWebView() {
        runOnUiThread(() -> {
            Bridge bridge = getBridge();
            if (bridge != null && bridge.getWebView() != null && topInsetDp > 0) {
                String js = "document.documentElement.style.setProperty('--safe-area-inset-top', '" + topInsetDp + "px');" +
                            "document.documentElement.style.setProperty('--safe-area-inset-bottom', '" + bottomInsetDp + "px');";
                bridge.getWebView().evaluateJavascript(js, null);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        applySafeAreaToWebView();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        OrderAlertPlugin.handleIncomingIntent(intent);
    }
}
