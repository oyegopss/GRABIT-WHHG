import { NextResponse } from "next/server";
import { getAuthenticatedVendorContext } from "@/lib/supabase/vendor_auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getStoredItemStock,
  saveStoredItemStock,
  appendInventoryLog,
} from "@/lib/vendor/inventoryStore";

interface AdjustStockPayload {
  menuItemId: string;
  quantityDelta?: number;
  exactQuantity?: number;
  lowStockThreshold?: number;
  adjustmentType?: string;
  reason?: string;
}

export async function GET() {
  try {
    const vendorCtx = await getAuthenticatedVendorContext();
    if (!vendorCtx) {
      return NextResponse.json(
        { ok: false, error: "Access denied. Please sign in with a vendor account." },
        { status: 401 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const { data: dbItems, error } = await supabase
      .from("menu_items")
      .select("*")
      .eq("canteen_id", vendorCtx.canteenId)
      .order("name", { ascending: true });

    if (error) {
      console.error("Vendor inventory GET error:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch inventory items." },
        { status: 500 },
      );
    }

    const enrichedItems = (dbItems || []).map((item) => {
      const stockInfo = getStoredItemStock(
        item.id,
        vendorCtx.canteenId,
        item.availability,
      );
      return {
        ...item,
        stock_quantity: stockInfo.stockQuantity,
        low_stock_threshold: stockInfo.lowStockThreshold,
      };
    });

    return NextResponse.json({ ok: true, items: enrichedItems });
  } catch (err) {
    console.error("Vendor inventory GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const vendorCtx = await getAuthenticatedVendorContext();
    if (!vendorCtx) {
      return NextResponse.json(
        { ok: false, error: "Access denied. Please sign in with a vendor account." },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as AdjustStockPayload;

    if (!payload.menuItemId) {
      return NextResponse.json(
        { ok: false, error: "Menu item ID is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();

    // Verify dish belongs to authorized vendor's canteen
    const { data: dbItem, error: findErr } = await supabase
      .from("menu_items")
      .select("id, canteen_id, name, availability")
      .eq("id", payload.menuItemId)
      .limit(1);

    if (findErr || !dbItem || dbItem.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Menu item not found." },
        { status: 404 },
      );
    }

    const targetItem = dbItem[0];
    if (targetItem.canteen_id !== vendorCtx.canteenId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden. You do not have permission to modify this menu item's inventory." },
        { status: 403 },
      );
    }

    const currentStockInfo = getStoredItemStock(
      targetItem.id,
      vendorCtx.canteenId,
      targetItem.availability,
    );
    const currentStock = currentStockInfo.stockQuantity;
    let newStock = currentStock;

    if (payload.exactQuantity !== undefined) {
      newStock = Math.max(0, Number(payload.exactQuantity) || 0);
    } else if (payload.quantityDelta !== undefined) {
      newStock = Math.max(0, currentStock + Number(payload.quantityDelta));
    }

    const qtyChanged = newStock - currentStock;
    const newAvailability = newStock <= 0 ? "unavailable" : "available";

    // Update availability on Supabase menu_items table
    if (targetItem.availability !== newAvailability) {
      await supabase
        .from("menu_items")
        .update({ availability: newAvailability })
        .eq("id", targetItem.id);
    }

    // Persist new stock & low stock threshold
    saveStoredItemStock(
      targetItem.id,
      vendorCtx.canteenId,
      newStock,
      payload.lowStockThreshold,
    );

    // Record audit log
    appendInventoryLog({
      menuItemId: targetItem.id,
      canteenId: vendorCtx.canteenId,
      menuItemName: targetItem.name,
      previousQuantity: currentStock,
      newQuantity: newStock,
      quantityChanged: qtyChanged,
      adjustmentType:
        payload.adjustmentType ||
        (qtyChanged > 0
          ? "stock_added"
          : qtyChanged < 0
            ? "stock_removed"
            : "manual_correction"),
      reason:
        payload.reason?.trim() ||
        (qtyChanged > 0
          ? "Restock added"
          : qtyChanged < 0
            ? "Stock reduced"
            : "Manual quantity override"),
      createdBy: vendorCtx.userId,
    });

    return NextResponse.json({
      ok: true,
      menuItemId: targetItem.id,
      previousQuantity: currentStock,
      newQuantity: newStock,
      availability: newAvailability,
    });
  } catch (err) {
    console.error("Vendor inventory POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error adjusting inventory." },
      { status: 500 },
    );
  }
}
