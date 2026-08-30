"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { initVendorPushNotifications } from "@/lib/vendor/vendorPushClient";
import {
  getPendingOrderNavigation,
  clearPendingOrderNavigation,
  onOrderNotificationTapped,
} from "@/lib/vendor/orderAlertService";

/**
 * Mounted in VendorLayout to manage FCM registration and deep-link routing
 * for authenticated vendor sessions.
 */
export function VendorPushInit() {
  const { user, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user || (role && role !== "vendor")) return;

    const navigateToOrder = (orderId: string) => {
      if (!orderId) return;
      router.push(`/vendor/orders?orderId=${encodeURIComponent(orderId)}`);
    };

    // 1. Check for pending order navigation from killed app cold launch
    getPendingOrderNavigation().then((res) => {
      if (res.pending && res.orderId) {
        navigateToOrder(res.orderId);
        clearPendingOrderNavigation();
      }
    });

    // 2. Listen to native plugin tap events
    let unsubNativeTap: (() => void) | null = null;
    onOrderNotificationTapped((data) => {
      if (data?.orderId) {
        navigateToOrder(data.orderId);
      }
    }).then((cleanup) => {
      unsubNativeTap = cleanup;
    });

    // 3. Initialize FCM Push Notifications for Vendor Android App
    initVendorPushNotifications((orderId) => {
      navigateToOrder(orderId);
    });

    return () => {
      if (unsubNativeTap) unsubNativeTap();
    };
  }, [user, role, router]);

  return null;
}
