"use client";

import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from "@capacitor/push-notifications";
import { startOrderAlert, stopOrderAlert } from "./orderAlertSoundManager";

export interface VendorOrderPushData {
  type?: string;
  orderId?: string;
  orderNumber?: string;
  canteenId?: string;
  title?: string;
  body?: string;
  timestamp?: string;
}

let listenersRegistered = false;
let lastKnownVendorToken: string | null = null;
let activeTapHandler: ((orderId: string, orderNumber?: string) => void) | null = null;

export function isNativeVendorApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Registers this device for incoming vendor order push notifications via FCM.
 * Lazily called only after the vendor is authenticated with an active session.
 */
export async function initVendorPushNotifications(
  onOrderNotificationTap: (orderId: string, orderNumber?: string) => void
): Promise<void> {
  if (!isNativeVendorApp()) return;

  activeTapHandler = onOrderNotificationTap;

  if (!listenersRegistered) {
    listenersRegistered = true;

    // Token Registration / Refresh
    PushNotifications.addListener("registration", async (token: Token) => {
      lastKnownVendorToken = token.value;
      console.info("[FCM] Token received:", token.value.slice(0, 16) + "...");

      try {
        const res = await fetch("/api/vendor/push-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: token.value,
            deviceType: "android",
            deviceName: "GRABIT Vendor Terminal",
          }),
        });

        if (res.ok) {
          console.info("[FCM] Token registered successfully with GRABIT backend.");
        } else {
          console.warn("[FCM] Token registration failed with status:", res.status);
        }
      } catch (err) {
        console.warn("[FCM] Token registration network error:", err);
      }
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.warn("[FCM] Push registration error:", err);
    });

    // Foreground Notification Received
    PushNotifications.addListener("pushNotificationReceived", (notification: PushNotificationSchema) => {
      const data = notification.data as VendorOrderPushData | undefined;
      const orderId = data?.orderId || "";
      const orderNumber = data?.orderNumber || "";

      console.info("[FCM] New order notification received in FOREGROUND");
      console.info(`[FCM] Order ID: ${orderId || "unknown"}`);
      console.info("[FCM] App state: foreground");

      // Trigger strong ring alert & vibration in foreground
      startOrderAlert();

      // Dispatch event to refresh live order feeds in WebView
      window.dispatchEvent(
        new CustomEvent("grabit:vendor-new-order", {
          detail: { orderId, orderNumber, data },
        })
      );
    });

    // Background / Tray Tap Action Performed
    PushNotifications.addListener("pushNotificationActionPerformed", (action: ActionPerformed) => {
      const data = action.notification?.data as VendorOrderPushData | undefined;
      const orderId = data?.orderId;
      const orderNumber = data?.orderNumber;

      console.info("[FCM] Notification clicked / action performed");
      console.info(`[FCM] Target Order ID: ${orderId || "none"}`);

      // Stop any sounding alert
      stopOrderAlert();

      if (orderId && activeTapHandler) {
        activeTapHandler(orderId, orderNumber);
      }
    });
  }

  try {
    const permStatus = await PushNotifications.checkPermissions();
    let granted = permStatus.receive === "granted";

    if (permStatus.receive === "prompt" || permStatus.receive === "prompt-with-rationale") {
      const requested = await PushNotifications.requestPermissions();
      granted = requested.receive === "granted";
    }

    if (!granted) {
      console.info("[FCM] Notification permission not granted yet.");
      return;
    }

    await PushNotifications.register();
  } catch (err) {
    console.warn("[FCM] Error initializing push notifications:", err);
  }
}

/**
 * Called on vendor logout to deactivate this device token in Supabase.
 */
export async function unregisterVendorPushToken(): Promise<void> {
  if (!isNativeVendorApp() || !lastKnownVendorToken) return;

  try {
    await fetch("/api/vendor/push-token", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: lastKnownVendorToken }),
    });
    console.info("[FCM] Device push token unregistered on logout.");
  } catch (err) {
    console.warn("[FCM] Error unregistering push token:", err);
  }
}
