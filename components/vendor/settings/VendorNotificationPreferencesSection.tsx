"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { App } from "@capacitor/app";
import { isNativePlatform } from "@/lib/capacitor/platform";
import {
  checkNotificationPermission,
  requestNotificationPermission,
  openNotificationSettings,
  openChannelNotificationSettings,
  sendTestOrderAlert,
  type NotificationPermissionDetails,
} from "@/lib/vendor/orderAlertService";

export function VendorNotificationPreferencesSection() {
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermissionDetails>({
    granted: true,
    areNotificationsEnabled: true,
    postNotificationsGranted: true,
    channelExists: true,
    channelBlocked: false,
    channelSoundEnabled: true,
    channelVibrationEnabled: true,
    channelImportance: 4,
    isPermanentlyDenied: false,
  });
  const [isChecking, setIsChecking] = useState(true);
  const [testSending, setTestSending] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refreshPermissions = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await checkNotificationPermission();
      setPermissionStatus(res);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    refreshPermissions();

    // 1. Refresh whenever window or tab regains focus
    const handleFocus = () => refreshPermissions();
    window.addEventListener("focus", handleFocus);

    // 2. Refresh on document visibility change (e.g. returning from Android Settings)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshPermissions();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // 3. Refresh on Capacitor app resume event
    let appStateHandle: { remove: () => void } | null = null;
    if (isNativePlatform()) {
      App.addListener("appStateChange", (state) => {
        if (state.isActive) {
          refreshPermissions();
        }
      }).then((h) => {
        appStateHandle = h;
      });
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (appStateHandle) appStateHandle.remove();
    };
  }, [refreshPermissions]);

  const handleEnableOrOpenSettings = async () => {
    if (!permissionStatus.postNotificationsGranted && !permissionStatus.isPermanentlyDenied) {
      const res = await requestNotificationPermission();
      setPermissionStatus(res);
      if (res.granted) return;
    }
    await openNotificationSettings();
  };

  const handleOpenChannelSettings = async () => {
    await openChannelNotificationSettings();
  };

  const handleSendTestAlert = async () => {
    setTestSending(true);
    try {
      const success = await sendTestOrderAlert();
      if (success) {
        setToastMsg("Test order alert dispatched! Check your notification bar, audio chime, and vibration.");
      } else {
        setToastMsg("Could not dispatch alert. Please check your Android notification permissions.");
      }
    } catch {
      setToastMsg("Error dispatching test alert.");
    } finally {
      setTestSending(false);
      setTimeout(() => setToastMsg(null), 4000);
    }
  };

  const isNotificationsOn = permissionStatus.granted && permissionStatus.areNotificationsEnabled && !permissionStatus.channelBlocked;
  const isSoundWarning = isNotificationsOn && !permissionStatus.channelSoundEnabled;

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface-elevated p-6 shadow-lg">
      {/* Header */}
      <div className="border-b border-border/60 pb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-title font-bold text-foreground">
            Order Notifications & Alert Settings
          </h3>
          <p className="text-caption text-muted">
            Instant audible rings, vibration, and Android heads-up notifications for customer orders
          </p>
        </div>
        <span className="material-symbols-outlined text-primary text-[26px]">notifications_active</span>
      </div>

      {toastMsg && (
        <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-center text-body-sm font-semibold text-primary animate-fade-in">
          {toastMsg}
        </div>
      )}

      {/* Primary Permission Status Box */}
      <div className="rounded-2xl border border-border/80 bg-background/80 p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5">
              {isNotificationsOn ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-primary" />
                </>
              ) : (
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-danger" />
              )}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-body-sm font-bold text-foreground">
                  Order Notifications
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-wider ${
                    isNotificationsOn
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "bg-danger/20 text-danger border border-danger/30"
                  }`}
                >
                  Status: {isNotificationsOn ? "ON" : "OFF"}
                </span>
              </div>
              <p className="text-caption text-muted mt-0.5">
                Receive instant alerts when a new order is placed by students
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEnableOrOpenSettings}
              className={`rounded-xl px-4 py-2 font-display text-caption font-bold uppercase tracking-wider transition-all active:scale-95 ${
                isNotificationsOn
                  ? "border border-border bg-surface text-muted hover:text-foreground hover:bg-surface-elevated"
                  : "bg-danger text-white shadow-lg shadow-danger/25 hover:opacity-90"
              }`}
            >
              {isNotificationsOn ? "Open Notification Settings" : "Enable Notifications"}
            </button>
            <button
              type="button"
              onClick={refreshPermissions}
              disabled={isChecking}
              title="Refresh Permission State"
              className="rounded-xl border border-border bg-surface p-2 text-muted hover:text-foreground hover:bg-surface-elevated transition-all"
            >
              <span className={`material-symbols-outlined text-[18px] ${isChecking ? "animate-spin" : ""}`}>
                refresh
              </span>
            </button>
          </div>
        </div>

        {/* Status Explanation */}
        {isNotificationsOn ? (
          <div className="flex items-start gap-2.5 text-body-sm text-foreground/90">
            <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">
              check_circle
            </span>
            <div>
              <span className="font-semibold text-primary">Notifications are enabled.</span>
              <p className="text-caption text-muted mt-0.5">
                You will receive real-time new-order alerts with ring sound and vibration even when the app is running in the background or closed.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft/30 p-3.5 text-body-sm text-danger">
            <span className="material-symbols-outlined text-danger text-[22px] shrink-0 mt-0.5">
              warning
            </span>
            <div>
              <span className="font-bold uppercase tracking-wide">Notifications are disabled</span>
              <p className="text-caption text-foreground/90 mt-1 leading-relaxed">
                Android system notifications are turned off. <strong>You may miss new incoming orders</strong> when the app is in the background or your device is locked. Please tap <strong>Enable Notifications</strong> to allow notifications in Android Settings.
              </p>
            </div>
          </div>
        )}

        {/* Channel Sound Warning if sound was muted in Android Channel settings */}
        {isSoundWarning && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft/30 p-3.5 text-body-sm">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-warning text-[22px] shrink-0 mt-0.5">
                volume_off
              </span>
              <div>
                <span className="font-bold text-warning uppercase tracking-wide">
                  Order notification alerts are disabled or muted
                </span>
                <p className="text-caption text-foreground/90 mt-1">
                  Please enable notification sound in Android Settings to avoid missing urgent customer orders.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenChannelSettings}
              className="shrink-0 rounded-lg bg-warning px-3 py-1.5 font-display text-[11px] font-bold text-on-warning hover:opacity-90"
            >
              Open Channel Settings
            </button>
          </div>
        )}
      </div>

      {/* Android Channel & Hardware Specs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Audio Channel */}
        <div className="rounded-xl border border-border/80 bg-background/60 p-4 flex flex-col justify-between gap-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-caption font-bold text-muted uppercase tracking-wider">
                Audible Alert Sound
              </span>
              <h4 className="font-display text-body-sm font-bold text-foreground mt-0.5">
                GRABIT Kitchen Chime
              </h4>
              <p className="text-[11px] text-faint mt-1">
                High-penetration audio chime designed for kitchen & counter environments
              </p>
            </div>
            <span className="material-symbols-outlined text-primary text-[22px]">volume_up</span>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            <span className="text-[11px] font-semibold text-foreground">
              Direct Hardware Channel Resource (@raw/order_alert)
            </span>
          </div>
        </div>

        {/* Vibration Pattern */}
        <div className="rounded-xl border border-border/80 bg-background/60 p-4 flex flex-col justify-between gap-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-caption font-bold text-muted uppercase tracking-wider">
                Vibration Pattern
              </span>
              <h4 className="font-display text-body-sm font-bold text-foreground mt-0.5">
                Multi-Pulse Haptic Alert
              </h4>
              <p className="text-[11px] text-faint mt-1">
                Triple 600ms pulses with 200ms rest for immediate pocket notice
              </p>
            </div>
            <span className="material-symbols-outlined text-primary text-[22px]">vibration</span>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            <span className="text-[11px] font-semibold text-foreground">
              Hardware Haptics Enabled
            </span>
          </div>
        </div>
      </div>

      {/* Android Notification Channel Details */}
      <div className="rounded-xl border border-border/70 bg-surface p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
          <div>
            <span className="font-display text-body-sm font-bold text-foreground">
              Android Notification Channel: GRABIT New Orders
            </span>
            <p className="text-[12px] text-muted">
              Channel ID: <code>grabit_new_orders</code> • Importance: High (Heads-Up Banner, Ring & Vibration)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenChannelSettings}
          className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 font-display text-[12px] font-semibold text-muted hover:text-foreground hover:bg-surface transition-all"
        >
          Channel Settings
        </button>
      </div>

      {/* Test Alert Button */}
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <span className="font-display text-body-sm font-bold text-foreground">
            Test Order Alert System
          </span>
          <p className="text-caption text-muted mt-0.5">
            Trigger a local test order notification to verify sound, vibration, and heads-up banner on this device.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSendTestAlert}
          disabled={testSending}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-caption font-extrabold uppercase tracking-wider text-on-primary shadow-glow-primary hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">
            {testSending ? "hourglass_top" : "campaign"}
          </span>
          <span>{testSending ? "Triggering..." : "Send Test Alert"}</span>
        </button>
      </div>

      {/* Operational Preferences Link */}
      <div className="rounded-xl border border-border/60 bg-background/40 p-4 flex items-center justify-between">
        <div>
          <span className="font-display text-body-sm font-semibold text-foreground">
            Operational Notification Preferences
          </span>
          <p className="text-caption text-muted">
            Configure low-stock alerts, settlement reports, and customer review notifications
          </p>
        </div>

        <Link
          href="/vendor/notifications"
          className="inline-flex items-center gap-1 text-caption font-bold text-primary hover:underline"
        >
          <span>Preferences</span>
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </Link>
      </div>
    </div>
  );
}
