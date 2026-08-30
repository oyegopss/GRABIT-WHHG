package com.grabit.vendor;

import android.Manifest;
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
    public static final String PRIMARY_CHANNEL_ID = "grabit_new_orders";
    public static final String LEGACY_CHANNEL_ID = "grabit_new_orders_channel_v1";
    public static final String CHANNEL_NAME = "GRABIT New Orders";
    public static final String CHANNEL_DESCRIPTION = "High-priority real-time sound and vibration alerts for incoming customer orders";

    private static String pendingOrderId = null;
    private static String pendingOrderNumber = null;
    private static OrderAlertPlugin instance = null;

    @Override
    public void load() {
        super.load();
        instance = this;
        ensureNotificationChannels(getContext());
    }

    /**
     * Initializes both primary and legacy NotificationChannels for GRABIT New Orders with custom sound and vibration.
     * Safe to call repeatedly and statically from MainActivity.onCreate.
     */
    public static void ensureNotificationChannels(Context ctx) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        try {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            String[] channelIds = new String[]{PRIMARY_CHANNEL_ID, LEGACY_CHANNEL_ID};
            Uri soundUri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + ctx.getPackageName() + "/" + R.raw.order_alert);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .build();
            long[] vibrationPattern = new long[]{0, 600, 200, 600, 200, 600};

            for (String channelId : channelIds) {
                NotificationChannel existingChannel = manager.getNotificationChannel(channelId);
                if (existingChannel == null) {
                    NotificationChannel channel = new NotificationChannel(
                        channelId,
                        CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_HIGH
                    );
                    channel.setDescription(CHANNEL_DESCRIPTION);
                    channel.enableLights(true);
                    channel.setLightColor(Color.parseColor("#00E676"));
                    channel.enableVibration(true);
                    channel.setVibrationPattern(vibrationPattern);
                    channel.setShowBadge(true);
                    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                    channel.setSound(soundUri, audioAttributes);

                    manager.createNotificationChannel(channel);
                    Log.i(TAG, "Notification channel created: " + channelId);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to create notification channels", e);
        }
    }

    // ==========================================
    // Permission & Channel State Management
    // ==========================================

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        Context ctx = getContext();
        ensureNotificationChannels(ctx);

        JSObject ret = new JSObject();
        boolean areEnabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        boolean postNotificationsGranted = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            postNotificationsGranted = ActivityCompat.checkSelfPermission(
                ctx,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
        }

        boolean channelExists = false;
        boolean channelBlocked = false;
        boolean channelSoundEnabled = true;
        boolean channelVibrationEnabled = true;
        int channelImportance = 4; // IMPORTANCE_HIGH

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = manager.getNotificationChannel(PRIMARY_CHANNEL_ID);
                if (channel == null) {
                    channel = manager.getNotificationChannel(LEGACY_CHANNEL_ID);
                }

                if (channel != null) {
                    channelExists = true;
                    channelImportance = channel.getImportance();
                    channelBlocked = (channelImportance == NotificationManager.IMPORTANCE_NONE);
                    channelSoundEnabled = (channel.getSound() != null);
                    channelVibrationEnabled = channel.shouldVibrate();
                }
            }
        }

        boolean fullyGranted = areEnabled && postNotificationsGranted && !channelBlocked;

        ret.put("granted", fullyGranted);
        ret.put("areNotificationsEnabled", areEnabled);
        ret.put("postNotificationsGranted", postNotificationsGranted);
        ret.put("channelExists", channelExists);
        ret.put("channelBlocked", channelBlocked);
        ret.put("channelSoundEnabled", channelSoundEnabled);
        ret.put("channelVibrationEnabled", channelVibrationEnabled);
        ret.put("channelImportance", channelImportance);
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

    @PluginMethod
    public void openChannelNotificationSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                intent.putExtra(Settings.EXTRA_CHANNEL_ID, PRIMARY_CHANNEL_ID);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                call.resolve();
            } else {
                openNotificationSettings(call);
            }
        } catch (Exception e) {
            openNotificationSettings(call);
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
            String body = "Test alert: Order " + testOrderNumber + " • 2 items (₹250). Notification sound and vibration are working.";

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
        ensureNotificationChannels(ctx);

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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, PRIMARY_CHANNEL_ID)
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

        if (orderId == null || orderId.isEmpty()) {
            // Also check data URI or actionUrl if present
            if (intent.getData() != null) {
                String path = intent.getData().getPath();
                if (path != null && path.contains("/orders/")) {
                    String[] parts = path.split("/orders/");
                    if (parts.length > 1) {
                        orderId = parts[1];
                        type = "NEW_ORDER";
                    }
                }
            }
        }

        if (("NEW_ORDER".equals(type) || type == null) && orderId != null && !orderId.isEmpty()) {
            pendingOrderId = orderId;
            pendingOrderNumber = orderNumber;

            Log.i(TAG, "[FCM] Captured incoming order intent: orderId=" + orderId);

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
