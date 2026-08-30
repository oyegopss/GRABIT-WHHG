/**
 * GRABIT Campus Storage & Multi-Campus Management
 * 
 * Rules:
 * 1. Exactly ONE active campus at any given time.
 * 2. Recently used campuses stored in MRU (Most Recently Used) order.
 * 3. Max 5 recently used campuses, deduplicated.
 * 4. Active campus is always persisted to localStorage / sessionStorage.
 */

export const SAVED_CAMPUS_KEY = "grabit_selected_campus_id";
export const RECENT_CAMPUSES_KEY = "grabit_recent_campus_ids";
export const MAX_RECENT_CAMPUSES = 5;

/**
 * Retrieves the currently active campus ID from storage.
 */
export function getActiveCampusId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.localStorage.getItem(SAVED_CAMPUS_KEY) ||
      window.sessionStorage.getItem(SAVED_CAMPUS_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Sets the active campus ID in storage.
 */
export function setActiveCampusId(campusId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_CAMPUS_KEY, campusId);
    window.sessionStorage.setItem(SAVED_CAMPUS_KEY, campusId);
  } catch {
    // Storage quota protection
  }
}

/**
 * Retrieves the array of recently used campus IDs.
 */
export function getRecentlyUsedCampusIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(RECENT_CAMPUSES_KEY) ||
      window.sessionStorage.getItem(RECENT_CAMPUSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Adds a campus ID to the recently used list.
 * Deduplicates and moves the new campus ID to index 0 (MRU).
 * Enforces MAX_RECENT_CAMPUSES limit.
 */
export function addRecentlyUsedCampusId(campusId: string): string[] {
  if (!campusId || typeof window === "undefined") return [];
  try {
    const current = getRecentlyUsedCampusIds();
    const updated = [campusId, ...current.filter((id) => id !== campusId)].slice(
      0,
      MAX_RECENT_CAMPUSES,
    );
    const json = JSON.stringify(updated);
    window.localStorage.setItem(RECENT_CAMPUSES_KEY, json);
    window.sessionStorage.setItem(RECENT_CAMPUSES_KEY, json);
    return updated;
  } catch {
    return [campusId];
  }
}

/**
 * Removes a campus ID from the recently used list if deleted or invalidated.
 */
export function removeRecentlyUsedCampusId(campusId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const current = getRecentlyUsedCampusIds();
    const updated = current.filter((id) => id !== campusId);
    const json = JSON.stringify(updated);
    window.localStorage.setItem(RECENT_CAMPUSES_KEY, json);
    window.sessionStorage.setItem(RECENT_CAMPUSES_KEY, json);
    return updated;
  } catch {
    return [];
  }
}
