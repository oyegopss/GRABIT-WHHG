package com.grabit.vendor;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "OrderAlert",
    permissions = {
        @Permission(
            strings = {
                Manifest.permission.POST_NOTIFICATIONS
            },
            alias = "notifications"
        )
    }
)
public class OrderAlertPlugin extends Plugin {

    private static final String TAG = "OrderAlertPlugin";
    public static final String CHANNEL_ID = "grabit_new_orders_channel_v1";
    public static final String CHANNEL_NAME = "GRABIT New Orders";
    public static final String CHANNEL_DESCRIPTION = "High-priority sound and vibration alerts for incoming customer orders";

    private static String pendingOrderId = null;
    private static String pendingOrderNumber = null;
    private static OrderAlertPlugin instance = null;

    @Override
    public void load() {
        super.load();
        instance = this;
        ensureNotificationChannel();
    }

    /**
     * Initializes the dedicated NotificationChannel for GRABIT New Orders with custom sound and vibration.
     */
    public void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager == null) return;

                NotificationChannel existingChannel = manager.getNotificationChannel(CHANNEL_ID);
                if (existingChannel != null) {
                    return; // Channel already configured
                }

                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription(CHANNEL_DESCRIPTION);
                channel.enableLights(true);
                channel.setLightColor(Color.parseColor("#00E676"));
                channel.enableVibration(true);
                long[] vibrationPattern = new long[]{0, 600, 200, 600, 200, 600};
                channel.setVibrationPattern(vibrationPattern);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);

                Uri soundUri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getContext().getPackageName() + "/" + R.raw.order_alert);
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build();
                channel.setSound(soundUri, audioAttributes);

                manager.createNotificationChannel(channel);
                Log.i(TAG, "Notification channel created: " + CHANNEL_ID);
            } catch (Exception e) {
                Log.e(TAG, "Failed to create notification channel", e);
            }
        }
    }

    // ==========================================
    // Permission Management
    // ==========================================

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        JSObject ret = new JSObject();
        boolean areEnabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        boolean permissionGranted = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionGranted = ActivityCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
        }

        boolean fullyGranted = areEnabled && permissionGranted;
        ret.put("granted", fullyGranted);
        ret.put("areNotificationsEnabled", areEnabled);
        ret.put("isPermanentlyDenied", !fullyGranted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
                return;
            }
        }
        checkNotificationPermission(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        checkNotificationPermission(call);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", ctx.getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Fallback to application details settings
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.fromParts("package", getContext().getPackageName(), null));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception ex) {
                call.reject("Unable to open notification settings: " + ex.getMessage());
            }
        }
    }

    // ==========================================
    // Notification Dispatch & Testing
    // ==========================================

    @PluginMethod
    public void showOrderNotification(PluginCall call) {
        String orderId = call.getString("orderId", "");
        String orderNumber = call.getString("orderNumber", "New Order");
        String title = call.getString("title", "New Order Received");
        String body = call.getString("body", "Order " + orderNumber + " is ready for preparation.");

        if (orderId == null || orderId.isEmpty()) {
            call.reject("orderId is required");
            return;
        }

        try {
            int notifId = Math.abs(orderId.hashCode());
            triggerNativeOrderNotification(orderId, orderNumber, title, body, notifId);

            JSObject ret = new JSObject();
            ret.put("posted", true);
            ret.put("notificationId", notifId);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error posting order notification", e);
            call.reject("Failed to post order notification: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendTestAlert(PluginCall call) {
        try {
            String testOrderId = "TEST-" + System.currentTimeMillis() % 10000;
            String testOrderNumber = "#" + (1000 + (int)(Math.random() * 9000));
            String title = "GRABIT Vendor — Test Order Alert";
            String body = "Test alert: Order " + testOrderNumber + " • 2 items (₹250). Notification sound and vibration are working perfectly.";

            int notifId = 9999;
            triggerNativeOrderNotification(testOrderId, testOrderNumber, title, body, notifId);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("orderId", testOrderId);
            ret.put("orderNumber", testOrderNumber);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to send test alert: " + e.getMessage());
        }
    }

    private void triggerNativeOrderNotification(String orderId, String orderNumber, String title, String body, int notifId) {
        Context ctx = getContext();
        ensureNotificationChannel();

        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.putExtra("type", "NEW_ORDER");
        intent.putExtra("orderId", orderId);
        intent.putExtra("orderNumber", orderNumber);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(ctx, notifId, intent, flags);

        int iconRes = ctx.getApplicationInfo().icon;
        if (iconRes == 0) {
            iconRes = android.R.drawable.ic_dialog_info;
        }

        Uri soundUri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + ctx.getPackageName() + "/" + R.raw.order_alert);
        long[] vibrationPattern = new long[]{0, 600, 200, 600, 200, 600};

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(iconRes)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setSound(soundUri)
            .setVibrate(vibrationPattern)
            .setLights(Color.parseColor("#00E676"), 500, 500)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(pendingIntent);

        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(ctx);
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            notificationManager.notify(notifId, builder.build());
        }
    }

    // ==========================================
    // Pending Navigation Handling
    // ==========================================

    @PluginMethod
    public void getPendingOrderNavigation(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingOrderId != null) {
            ret.put("pending", true);
            ret.put("orderId", pendingOrderId);
            ret.put("orderNumber", pendingOrderNumber);
        } else {
            ret.put("pending", false);
            ret.put("orderId", (String) null);
            ret.put("orderNumber", (String) null);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void clearPendingOrderNavigation(PluginCall call) {
        pendingOrderId = null;
        pendingOrderNumber = null;
        JSObject ret = new JSObject();
        ret.put("cleared", true);
        call.resolve(ret);
    }

    /**
     * Called by MainActivity whenever a new intent or launch intent contains order extras.
     */
    public static void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String type = intent.getStringExtra("type");
        String orderId = intent.getStringExtra("orderId");
        String orderNumber = intent.getStringExtra("orderNumber");

        if ("NEW_ORDER".equals(type) && orderId != null && !orderId.isEmpty()) {
            pendingOrderId = orderId;
            pendingOrderNumber = orderNumber;

            if (instance != null) {
                JSObject data = new JSObject();
                data.put("orderId", orderId);
                data.put("orderNumber", orderNumber);
                data.put("type", "NEW_ORDER");
                instance.notifyListeners("orderNotificationTapped", data);
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }
}
