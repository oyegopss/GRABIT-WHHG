import { registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "@/lib/capacitor/platform";

export interface NotificationPermissionDetails {
  granted: boolean;
  areNotificationsEnabled: boolean;
  postNotificationsGranted: boolean;
  channelExists: boolean;
  channelBlocked: boolean;
  channelSoundEnabled: boolean;
  channelVibrationEnabled: boolean;
  channelImportance: number;
  isPermanentlyDenied: boolean;
}

interface OrderAlertPluginType {
  checkNotificationPermission: () => Promise<NotificationPermissionDetails>;
  requestNotificationPermission: () => Promise<NotificationPermissionDetails>;
  openNotificationSettings: () => Promise<void>;
  openChannelNotificationSettings: () => Promise<void>;
  showOrderNotification: (options: {
    orderId: string;
    orderNumber: string;
    title?: string;
    body?: string;
    itemCount?: number;
    totalAmount?: number;
  }) => Promise<{ posted: boolean; notificationId: number }>;
  sendTestAlert: () => Promise<{
    success: boolean;
    orderId: string;
    orderNumber: string;
  }>;
  getPendingOrderNavigation: () => Promise<{
    pending: boolean;
    orderId: string | null;
    orderNumber: string | null;
  }>;
  clearPendingOrderNavigation: () => Promise<{ cleared: boolean }>;
  addListener: (
    eventName: "orderNotificationTapped",
    listenerFunc: (data: { orderId: string; orderNumber: string; type: string }) => void
  ) => Promise<{ remove: () => Promise<void> }>;
}

let cachedPlugin: OrderAlertPluginType | null | undefined;

function getNativePlugin(): OrderAlertPluginType | null {
  if (!isNativePlatform() || typeof window === "undefined") return null;
  if (cachedPlugin !== undefined) return cachedPlugin;
  try {
    cachedPlugin = registerPlugin<OrderAlertPluginType>("OrderAlert");
    return cachedPlugin;
  } catch (err) {
    console.warn("[orderAlertService] Failed to load OrderAlert native plugin:", err);
    return null;
  }
}

// In-memory & storage deduplication cache to ensure each order is alerted exactly ONCE
const ALERTED_ORDERS_STORAGE_KEY = "grabit_vendor_alerted_orders_v2";
const memoryAlertedIds = new Set<string>();

function loadStoredAlertedIds(): Set<string> {
  if (typeof window === "undefined") return memoryAlertedIds;
  try {
    const raw = sessionStorage.getItem(ALERTED_ORDERS_STORAGE_KEY);
    if (raw) {
      const parsed: string[] = JSON.parse(raw);
      parsed.forEach((id) => memoryAlertedIds.add(id));
    }
  } catch {
    // Ignore storage issues
  }
  return memoryAlertedIds;
}

function persistAlertedId(orderId: string) {
  memoryAlertedIds.add(orderId);
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(memoryAlertedIds).slice(-100); // keep last 100
    sessionStorage.setItem(ALERTED_ORDERS_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Ignore
  }
}

/**
 * Checks if an order ID has already been alerted in the current session.
 */
export function isOrderAlreadyAlerted(orderId: string): boolean {
  loadStoredAlertedIds();
  return memoryAlertedIds.has(orderId);
}

/**
 * Marks an order ID as alerted to prevent duplicate chimes or notifications.
 */
export function markOrderAlerted(orderId: string) {
  persistAlertedId(orderId);
}

/**
 * Checks Android notification permission & notification channel status in real time.
 */
export async function checkNotificationPermission(): Promise<NotificationPermissionDetails> {
  const plugin = getNativePlugin();
  if (!plugin) {
    // Web / browser environment: check standard Notification API
    if (typeof window !== "undefined" && "Notification" in window) {
      const granted = Notification.permission === "granted";
      return {
        granted,
        areNotificationsEnabled: Notification.permission !== "denied",
        postNotificationsGranted: granted,
        channelExists: true,
        channelBlocked: false,
        channelSoundEnabled: true,
        channelVibrationEnabled: true,
        channelImportance: 4,
        isPermanentlyDenied: Notification.permission === "denied",
      };
    }
    return {
      granted: true,
      areNotificationsEnabled: true,
      postNotificationsGranted: true,
      channelExists: true,
      channelBlocked: false,
      channelSoundEnabled: true,
      channelVibrationEnabled: true,
      channelImportance: 4,
      isPermanentlyDenied: false,
    };
  }

  try {
    return await plugin.checkNotificationPermission();
  } catch (err) {
    console.error("[orderAlertService] Error checking notification permission:", err);
    return {
      granted: false,
      areNotificationsEnabled: false,
      postNotificationsGranted: false,
      channelExists: false,
      channelBlocked: true,
      channelSoundEnabled: false,
      channelVibrationEnabled: false,
      channelImportance: 0,
      isPermanentlyDenied: true,
    };
  }
}

/**
 * Requests Android notification runtime permission (POST_NOTIFICATIONS on Android 13+).
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionDetails> {
  const plugin = getNativePlugin();
  if (!plugin) {
    if (typeof window !== "undefined" && "Notification" in window) {
      const res = await Notification.requestPermission();
      const granted = res === "granted";
      return {
        granted,
        areNotificationsEnabled: res !== "denied",
        postNotificationsGranted: granted,
        channelExists: true,
        channelBlocked: false,
        channelSoundEnabled: true,
        channelVibrationEnabled: true,
        channelImportance: 4,
        isPermanentlyDenied: res === "denied",
      };
    }
    return checkNotificationPermission();
  }

  try {
    return await plugin.requestNotificationPermission();
  } catch (err) {
    console.error("[orderAlertService] Error requesting notification permission:", err);
    return checkNotificationPermission();
  }
}

/**
 * Opens direct Application Notification Settings on Android OS.
 */
export async function openNotificationSettings(): Promise<void> {
  const plugin = getNativePlugin();
  if (plugin) {
    try {
      await plugin.openNotificationSettings();
      return;
    } catch (err) {
      console.warn("[orderAlertService] Could not open notification settings:", err);
    }
  }

  try {
    const { openAppSettings } = await import("@/lib/capacitor/settings");
    await openAppSettings();
  } catch {
    // Web fallback
  }
}

/**
 * Opens direct Notification Channel Settings for GRABIT New Orders on Android OS.
 */
export async function openChannelNotificationSettings(): Promise<void> {
  const plugin = getNativePlugin();
  if (plugin) {
    try {
      await plugin.openChannelNotificationSettings();
      return;
    } catch (err) {
      console.warn("[orderAlertService] Could not open channel settings:", err);
    }
  }

  await openNotificationSettings();
}

/**
 * Triggers a test order alert notification on the device with sound and vibration.
 */
export async function sendTestOrderAlert(): Promise<boolean> {
  const plugin = getNativePlugin();
  if (plugin) {
    try {
      const res = await plugin.sendTestAlert();
      return res.success;
    } catch (err) {
      console.error("[orderAlertService] Error sending native test alert:", err);
      return false;
    }
  }

  // Web fallback test audio
  try {
    const { orderAlertSoundManager } = await import("./orderAlertSoundManager");
    orderAlertSoundManager.start();
    setTimeout(() => {
      orderAlertSoundManager.stop();
    }, 4000);
    return true;
  } catch (err) {
    console.warn("[orderAlertService] Web audio fallback failed:", err);
    return false;
  }
}

/**
 * Queries native layer for any pending order navigation from a notification tap.
 */
export async function getPendingOrderNavigation(): Promise<{
  pending: boolean;
  orderId: string | null;
  orderNumber: string | null;
}> {
  const plugin = getNativePlugin();
  if (!plugin) return { pending: false, orderId: null, orderNumber: null };
  try {
    return await plugin.getPendingOrderNavigation();
  } catch {
    return { pending: false, orderId: null, orderNumber: null };
  }
}

/**
 * Clears pending order navigation in native memory once handled.
 */
export async function clearPendingOrderNavigation(): Promise<void> {
  const plugin = getNativePlugin();
  if (!plugin) return;
  try {
    await plugin.clearPendingOrderNavigation();
  } catch {
    // Ignore
  }
}

/**
 * Listens for notification tap events while the app is active.
 */
export async function onOrderNotificationTapped(
  callback: (data: { orderId: string; orderNumber: string }) => void
): Promise<(() => void) | null> {
  const plugin = getNativePlugin();
  if (!plugin) return null;

  try {
    const handle = await plugin.addListener("orderNotificationTapped", (data) => {
      if (data && data.orderId) {
        callback({ orderId: data.orderId, orderNumber: data.orderNumber });
      }
    });
    return () => {
      handle.remove();
    };
  } catch (err) {
    console.warn("[orderAlertService] Error adding notification tap listener:", err);
    return null;
  }
}

/**
 * Registers device push token to backend for authenticated vendor.
 */
export async function registerDevicePushToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch("/api/vendor/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        deviceType: isNativePlatform() ? "android" : "web",
        deviceName: isNativePlatform() ? "GRABIT Vendor Android" : "Vendor Web",
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("[orderAlertService] Failed to register push token:", err);
    return false;
  }
}
