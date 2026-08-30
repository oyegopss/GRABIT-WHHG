import { createClient } from "@/lib/supabase/server";
import { resolveImageUrl } from "@/lib/utils/image";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type RecommendationCategory =
  | "ORDER_AGAIN"
  | "POPULAR_AT_CAMPUS"
  | "TRENDING_NOW"
  | "POPULAR_AT_CANTEEN"
  | "TIME_OF_DAY"
  | "FREQUENTLY_ORDERED"
  | "NEW_DISCOVERY"
  | "BEST_SELLER";

export interface RecommendationItem {
  itemId: string;
  title: string;
  reason: string;
  category: RecommendationCategory;
  score: number; // 0 - 100
  canteenId: string;
  canteenName: string;
  campusId: string;
  campusName: string;
  price: number; // Current menu price (menu_items.price) for display
  isAvailable: boolean;
  itemCategory: string;
  imageUrl: string;
}

export interface StudentRecommendationsPayload {
  recommendations: RecommendationItem[];
  timeBucket: "BREAKFAST" | "LUNCH" | "SNACK" | "DINNER" | "LATE_NIGHT";
  isPersonalized: boolean;
  campusId: string | null;
  campusName: string;
  updatedAt: string;
}

function getTimeBucket():
  "BREAKFAST" | "LUNCH" | "SNACK" | "DINNER" | "LATE_NIGHT" {
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 11) return "BREAKFAST";
  if (hour >= 11 && hour < 15) return "LUNCH";
  if (hour >= 15 && hour < 19) return "SNACK";
  if (hour >= 19 && hour < 23) return "DINNER";
  return "LATE_NIGHT";
}

/**
 * Derives deterministic, campus-scoped Student Recommendations & Popular Items.
 * Strictly scopes menu items, orders, and popularity to the given activeCampusId.
 * NEVER returns items from another campus or global fallbacks.
 */
export async function getStudentRecommendations(
  targetCampusId?: string | null,
): Promise<StudentRecommendationsPayload> {
  const adminSupabase = getSupabaseAdminClient();
  const timeBucket = getTimeBucket();

  // 1. Authenticate student via server cookies (if available)
  let studentUserId: string | null = null;
  try {
    const serverSupabase = await createClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();
    studentUserId = user?.id ?? null;
  } catch {
    studentUserId = null;
  }

  // 2. Resolve authoritative campus
  let activeCampusId = targetCampusId?.trim() || null;
  let campusName = "Campus";

  if (activeCampusId) {
    const { data: campusRecord } = await adminSupabase
      .from("campuses")
      .select("id, name")
      .eq("id", activeCampusId)
      .single();
    if (campusRecord) {
      campusName = campusRecord.name;
    }
  } else {
    // If no campus passed, check if student profile has an associated campus
    if (studentUserId) {
      const { data: profile } = await adminSupabase
        .from("profiles")
        .select("campus_id, campuses(id, name)")
        .eq("id", studentUserId)
        .single();
      if (profile?.campus_id) {
        activeCampusId = profile.campus_id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        campusName = (profile.campuses as any)?.name || "Campus";
      }
    }

    // Default to the first available active campus if still unresolved
    if (!activeCampusId) {
      const { data: defaultCampus } = await adminSupabase
        .from("campuses")
        .select("id, name")
        .eq("is_active", true)
        .limit(1)
        .single();
      if (defaultCampus) {
        activeCampusId = defaultCampus.id;
        campusName = defaultCampus.name;
      }
    }
  }

  if (!activeCampusId) {
    return {
      recommendations: [],
      timeBucket,
      isPersonalized: false,
      campusId: null,
      campusName: "Campus",
      updatedAt: new Date().toISOString(),
    };
  }

  // 3. Fetch canteens belonging strictly to this campus
  const { data: campusCanteens } = await adminSupabase
    .from("canteens")
    .select("id, name, campus_id, campuses(id, name)")
    .eq("campus_id", activeCampusId);

  const canteenList = campusCanteens ?? [];
  const canteenIds = canteenList.map((c) => c.id);

  if (canteenIds.length === 0) {
    return {
      recommendations: [],
      timeBucket,
      isPersonalized: false,
      campusId: activeCampusId,
      campusName,
      updatedAt: new Date().toISOString(),
    };
  }

  // 4. Fetch available menu items belonging strictly to this campus's canteens
  const { data: dbMenuItems } = await adminSupabase
    .from("menu_items")
    .select(
      "id, canteen_id, name, category, price, availability, image_url, canteens(id, name, campus_id, campuses(id, name))",
    )
    .in("canteen_id", canteenIds)
    .eq("availability", "available");

  const menuItemsList = dbMenuItems ?? [];

  // Filter ONLY available items belonging strictly to active campus
  const availableItemsMap = new Map<
    string,
    {
      id: string;
      canteenId: string;
      campusId: string;
      name: string;
      category: string;
      price: number;
      canteenName: string;
      campusName: string;
      imageUrl: string;
    }
  >();

  menuItemsList.forEach((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canteen = m.canteens as any;
    // Mandatory Safety Layer: Validate canteen.campus_id === activeCampusId
    if (canteen?.campus_id === activeCampusId) {
      availableItemsMap.set(m.id, {
        id: m.id,
        canteenId: m.canteen_id,
        campusId: activeCampusId,
        name: m.name,
        category: m.category || "General",
        price: Number(m.price) || 0,
        canteenName: canteen?.name || "Campus Canteen",
        campusName: canteen?.campuses?.name || campusName,
        imageUrl: resolveImageUrl(m.image_url, "dish"),
      });
    }
  });

  if (availableItemsMap.size === 0) {
    return {
      recommendations: [],
      timeBucket,
      isPersonalized: false,
      campusId: activeCampusId,
      campusName,
      updatedAt: new Date().toISOString(),
    };
  }

  const recommendationList: RecommendationItem[] = [];
  let isPersonalized = false;

  // 5. ORDER AGAIN ENGINE (Scoped strictly to this student and this campus)
  if (studentUserId) {
    const { data: studentOrders } = await adminSupabase
      .from("orders")
      .select("id, status, created_at, canteen_id")
      .eq("student_id", studentUserId)
      .in("canteen_id", canteenIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(30);

    const completedOrderIds = (studentOrders ?? []).map((o) => o.id);

    if (completedOrderIds.length > 0) {
      const { data: studentItems } = await adminSupabase
        .from("order_items")
        .select("menu_item_id, quantity, created_at")
        .in("order_id", completedOrderIds);

      const itemFrequencyMap = new Map<
        string,
        { count: number; lastOrdered: string }
      >();

      (studentItems ?? []).forEach((si) => {
        const existing = itemFrequencyMap.get(si.menu_item_id) ?? {
          count: 0,
          lastOrdered: si.created_at || new Date().toISOString(),
        };
        existing.count += Number(si.quantity) || 1;
        if (new Date(si.created_at) > new Date(existing.lastOrdered)) {
          existing.lastOrdered = si.created_at;
        }
        itemFrequencyMap.set(si.menu_item_id, existing);
      });

      // Score and rank student's previous items strictly for this campus
      Array.from(itemFrequencyMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([itemId, stats]) => {
          const item = availableItemsMap.get(itemId);
          if (item) {
            const freqScore = Math.min(100, stats.count * 25);
            const score = Math.round(freqScore * 0.45 + 90 * 0.35 + 100 * 0.2);
            isPersonalized = true;

            recommendationList.push({
              itemId: item.id,
              title: item.name,
              reason: `Ordered ${stats.count} time${stats.count > 1 ? "s" : ""} by you`,
              category: "ORDER_AGAIN",
              score,
              canteenId: item.canteenId,
              canteenName: item.canteenName,
              campusId: item.campusId,
              campusName: item.campusName,
              price: item.price,
              isAvailable: true,
              itemCategory: item.category,
              imageUrl: item.imageUrl,
            });
          }
        });
    }
  }

  // 6. CAMPUS POPULARITY ENGINE (Scoped strictly to orders from this campus's canteens)
  const { data: campusRecentOrders } = await adminSupabase
    .from("orders")
    .select("id, student_id, canteen_id, created_at")
    .in("canteen_id", canteenIds)
    .order("created_at", { ascending: false })
    .limit(200);

  const campusOrderIds = (campusRecentOrders ?? []).map((o) => o.id);
  const campusPopularityMap = new Map<string, { totalQty: number; uniqueStudents: Set<string> }>();

  if (campusOrderIds.length > 0) {
    const { data: campusOrderItems } = await adminSupabase
      .from("order_items")
      .select("order_id, menu_item_id, quantity, created_at")
      .in("order_id", campusOrderIds);

    const orderStudentMap = new Map<string, string>();
    (campusRecentOrders ?? []).forEach((o) => {
      if (o.student_id) orderStudentMap.set(o.id, o.student_id);
    });

    (campusOrderItems ?? []).forEach((oi) => {
      const stats = campusPopularityMap.get(oi.menu_item_id) ?? {
        totalQty: 0,
        uniqueStudents: new Set<string>(),
      };
      stats.totalQty += Number(oi.quantity) || 1;
      const studentId = orderStudentMap.get(oi.order_id);
      if (studentId) stats.uniqueStudents.add(studentId);
      campusPopularityMap.set(oi.menu_item_id, stats);
    });
  }

  const popularItems = Array.from(campusPopularityMap.entries()).sort(
    (a, b) => b[1].totalQty - a[1].totalQty,
  );

  // Add Popular at Campus items
  popularItems.forEach(([itemId, stats]) => {
    const item = availableItemsMap.get(itemId);
    if (item && !recommendationList.some((r) => r.itemId === item.id)) {
      const popularityScore = Math.min(
        98,
        70 + stats.totalQty * 3 + stats.uniqueStudents.size * 2,
      );
      recommendationList.push({
        itemId: item.id,
        title: item.name,
        reason: `Popular at ${item.campusName}`,
        category: "POPULAR_AT_CAMPUS",
        score: popularityScore,
        canteenId: item.canteenId,
        canteenName: item.canteenName,
        campusId: item.campusId,
        campusName: item.campusName,
        price: item.price,
        isAvailable: true,
        itemCategory: item.category,
        imageUrl: item.imageUrl,
      });
    }
  });

  // 7. TRENDING NOW ENGINE (Short-window demand velocity for this campus)
  popularItems.slice(0, 3).forEach(([itemId, stats]) => {
    const item = availableItemsMap.get(itemId);
    if (
      item &&
      !recommendationList.some(
        (r) => r.itemId === item.id && r.category === "TRENDING_NOW",
      )
    ) {
      recommendationList.push({
        itemId: item.id,
        title: item.name,
        reason: `Trending ${timeBucket.replace(/_/g, " ").toLowerCase()} pick`,
        category: "TRENDING_NOW",
        score: Math.min(99, 82 + stats.totalQty * 3),
        canteenId: item.canteenId,
        canteenName: item.canteenName,
        campusId: item.campusId,
        campusName: item.campusName,
        price: item.price,
        isAvailable: true,
        itemCategory: item.category,
        imageUrl: item.imageUrl,
      });
    }
  });

  // 8. TIME-OF-DAY ENGINE (Matching items strictly available in this campus)
  availableItemsMap.forEach((item) => {
    let matchesTime = false;
    const catLower = item.category.toLowerCase();
    const nameLower = item.name.toLowerCase();

    if (
      timeBucket === "BREAKFAST" &&
      (catLower.includes("snack") ||
        catLower.includes("breakfast") ||
        nameLower.includes("tea") ||
        nameLower.includes("dosa") ||
        nameLower.includes("sandwich") ||
        nameLower.includes("paratha"))
    )
      matchesTime = true;
    if (
      timeBucket === "LUNCH" &&
      (catLower.includes("meal") ||
        catLower.includes("lunch") ||
        nameLower.includes("thali") ||
        nameLower.includes("rice") ||
        nameLower.includes("combo") ||
        nameLower.includes("paneer"))
    )
      matchesTime = true;
    if (
      timeBucket === "SNACK" &&
      (catLower.includes("beverage") ||
        catLower.includes("snack") ||
        nameLower.includes("burger") ||
        nameLower.includes("maggi") ||
        nameLower.includes("coffee") ||
        nameLower.includes("tea") ||
        nameLower.includes("fries"))
    )
      matchesTime = true;
    if (
      timeBucket === "DINNER" &&
      (catLower.includes("meal") ||
        catLower.includes("dinner") ||
        nameLower.includes("thali") ||
        nameLower.includes("combo") ||
        nameLower.includes("paneer") ||
        nameLower.includes("roti"))
    )
      matchesTime = true;
    if (
      timeBucket === "LATE_NIGHT" &&
      (catLower.includes("snack") ||
        nameLower.includes("maggi") ||
        nameLower.includes("coffee") ||
        nameLower.includes("sandwich") ||
        nameLower.includes("burger"))
    )
      matchesTime = true;

    if (matchesTime && !recommendationList.some((r) => r.itemId === item.id)) {
      recommendationList.push({
        itemId: item.id,
        title: item.name,
        reason: `Popular during ${timeBucket.replace(/_/g, " ").toLowerCase()}`,
        category: "TIME_OF_DAY",
        score: 85,
        canteenId: item.canteenId,
        canteenName: item.canteenName,
        campusId: item.campusId,
        campusName: item.campusName,
        price: item.price,
        isAvailable: true,
        itemCategory: item.category,
        imageUrl: item.imageUrl,
      });
    }
  });

  // 9. CAMPUS-SCOPED FALLBACK (Only from active campus items when no order history exists yet)
  if (recommendationList.length === 0) {
    availableItemsMap.forEach((item) => {
      recommendationList.push({
        itemId: item.id,
        title: item.name,
        reason: `Best Seller at ${item.canteenName}`,
        category: "BEST_SELLER",
        score: 80,
        canteenId: item.canteenId,
        canteenName: item.canteenName,
        campusId: item.campusId,
        campusName: item.campusName,
        price: item.price,
        isAvailable: true,
        itemCategory: item.category,
        imageUrl: item.imageUrl,
      });
    });
  }

  // 10. RECOMMENDATION DIVERSITY RULES (Max 2 items per category, max 3 items per canteen, max 6 items)
  const categoryCounts = new Map<string, number>();
  const canteenCounts = new Map<string, number>();
  const finalRecommendations: RecommendationItem[] = [];

  recommendationList.sort((a, b) => b.score - a.score);

  for (const rec of recommendationList) {
    const catCount = categoryCounts.get(rec.itemCategory) ?? 0;
    const cantCount = canteenCounts.get(rec.canteenId) ?? 0;

    if (catCount < 2 && cantCount < 3) {
      finalRecommendations.push(rec);
      categoryCounts.set(rec.itemCategory, catCount + 1);
      canteenCounts.set(rec.canteenId, cantCount + 1);
    }

    if (finalRecommendations.length >= 6) break;
  }

  return {
    recommendations: finalRecommendations,
    timeBucket,
    isPersonalized,
    campusId: activeCampusId,
    campusName,
    updatedAt: new Date().toISOString(),
  };
}
