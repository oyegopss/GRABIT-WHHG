import fs from "fs";
import path from "path";

export interface StoredInventoryItem {
  menuItemId: string;
  canteenId: string;
  stockQuantity: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface StoredInventoryLog {
  id: string;
  menuItemId: string;
  canteenId: string;
  menuItemName: string;
  previousQuantity: number;
  newQuantity: number;
  quantityChanged: number;
  adjustmentType: string;
  reason?: string;
  createdBy?: string;
  createdAt: string;
}

interface InventoryStoreData {
  items: Record<string, StoredInventoryItem>; // keyed by menuItemId
  logs: StoredInventoryLog[];
}

const STORE_PATH = path.join(process.cwd(), "data", "vendor_inventory.json");

function ensureStoreExists(): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const initialData: InventoryStoreData = {
      items: {},
      logs: [],
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(initialData, null, 2), "utf-8");
  }
}

function readStore(): InventoryStoreData {
  try {
    ensureStoreExists();
    const content = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(content) as InventoryStoreData;
  } catch {
    return { items: {}, logs: [] };
  }
}

function writeStore(data: InventoryStoreData): void {
  try {
    ensureStoreExists();
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist inventory store:", err);
  }
}

export function getStoredItemStock(
  menuItemId: string,
  canteenId: string,
  defaultAvailability: string,
): { stockQuantity: number; lowStockThreshold: number } {
  const store = readStore();
  const existing = store.items[menuItemId];
  if (existing) {
    return {
      stockQuantity: defaultAvailability === "unavailable" ? 0 : existing.stockQuantity,
      lowStockThreshold: existing.lowStockThreshold ?? 10,
    };
  }

  // Initial default: 20 units if available, 0 if unavailable
  const initialStock = defaultAvailability === "unavailable" ? 0 : 25;
  return {
    stockQuantity: initialStock,
    lowStockThreshold: 10,
  };
}

export function saveStoredItemStock(
  menuItemId: string,
  canteenId: string,
  stockQuantity: number,
  lowStockThreshold?: number,
): void {
  const store = readStore();
  const current = store.items[menuItemId];
  store.items[menuItemId] = {
    menuItemId,
    canteenId,
    stockQuantity: Math.max(0, stockQuantity),
    lowStockThreshold:
      lowStockThreshold !== undefined && lowStockThreshold >= 0
        ? lowStockThreshold
        : current?.lowStockThreshold ?? 10,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

export function appendInventoryLog(log: Omit<StoredInventoryLog, "id" | "createdAt">): StoredInventoryLog {
  const store = readStore();
  const newLog: StoredInventoryLog = {
    ...log,
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  store.logs.unshift(newLog); // newest first
  // Keep last 200 logs
  if (store.logs.length > 200) {
    store.logs = store.logs.slice(0, 200);
  }
  writeStore(store);
  return newLog;
}

export function getInventoryLogsForCanteen(canteenId: string): StoredInventoryLog[] {
  const store = readStore();
  return store.logs.filter((log) => log.canteenId === canteenId);
}
