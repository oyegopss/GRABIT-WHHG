export interface VendorInventoryItem {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  stockQuantity: number;
  lowStockThreshold: number;
  inStock: boolean;
  imageUrl: string;
  stockStatus: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  updatedAtIso?: string;
}

export interface InventoryLogItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  previousQuantity: number;
  newQuantity: number;
  quantityChanged: number;
  adjustmentType: string;
  reason?: string;
  createdAtIso: string;
}

const DEFAULT_ITEM_IMAGE =
  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80";

export function getStockStatus(
  quantity: number,
  threshold: number = 10,
  availability: "available" | "unavailable" = "available",
): "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" {
  if (availability === "unavailable" || quantity <= 0) return "OUT_OF_STOCK";
  if (quantity <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

/**
 * Fetch live vendor inventory items from Supabase database via API.
 */
export async function getLiveVendorInventory(
  canteenId: string | null,
): Promise<VendorInventoryItem[]> {
  if (!canteenId) return [];

  try {
    const res = await fetch("/api/vendor/inventory", {
      headers: { "Cache-Control": "no-cache" },
    });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.items)) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.items.map((row: any) => {
      const isUnavailable = row.availability === "unavailable";
      const rawStock = row.stock_quantity !== null && row.stock_quantity !== undefined ? Number(row.stock_quantity) : 0;
      const stockQuantity = isUnavailable ? 0 : rawStock;
      const lowStockThreshold = Number(row.low_stock_threshold ?? 10);
      const isAvailable = !isUnavailable && stockQuantity > 0;

      return {
        id: row.id,
        name: row.name,
        category: row.category?.trim() || "General",
        description: row.description || "",
        price: Number(row.price || 0),
        stockQuantity: isUnavailable ? 0 : stockQuantity,
        lowStockThreshold,
        inStock: isAvailable,
        imageUrl: row.image_url || DEFAULT_ITEM_IMAGE,
        stockStatus: getStockStatus(stockQuantity, lowStockThreshold, row.availability),
        updatedAtIso: row.created_at,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Adjust stock for a menu item via server API.
 */
export async function adjustLiveVendorStock(payload: {
  menuItemId: string;
  quantityDelta?: number;
  exactQuantity?: number;
  lowStockThreshold?: number;
  adjustmentType?: string;
  reason?: string;
}): Promise<{ ok: boolean; newStock?: number; error?: string }> {
  try {
    const res = await fetch("/api/vendor/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? "Failed to adjust stock." };
    }

    return { ok: true, newStock: data.newQuantity };
  } catch {
    return { ok: false, error: "Network error adjusting stock." };
  }
}

/**
 * Fetch inventory adjustment history logs.
 */
export async function getLiveVendorInventoryLogs(): Promise<InventoryLogItem[]> {
  try {
    const res = await fetch("/api/vendor/inventory/history", {
      headers: { "Cache-Control": "no-cache" },
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !Array.isArray(data.logs)) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.logs.map((row: any) => ({
      id: row.id,
      menuItemId: row.menu_item_id,
      menuItemName: row.menu_items?.name ?? "Dish",
      previousQuantity: Number(row.previous_quantity || 0),
      newQuantity: Number(row.new_quantity || 0),
      quantityChanged: Number(row.quantity_changed || 0),
      adjustmentType: row.adjustment_type || "manual_correction",
      reason: row.reason ?? undefined,
      createdAtIso: row.created_at,
    }));
  } catch {
    return [];
  }
}
