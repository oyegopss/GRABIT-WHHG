"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { CampusHeader } from "@/components/student/CampusHeader";
import { CanteenStatusBanner } from "@/components/student/CanteenStatusBanner";
import { CategoryChips } from "@/components/student/CategoryChips";
import { CanteenCard } from "@/components/student/CanteenCard";
import { CampusSelectorModal } from "@/components/student/CampusSelectorModal";
import { CampusSwitchCartModal } from "@/components/student/CampusSwitchCartModal";
import { StudentRecommendationsSection } from "@/components/student/StudentRecommendationsSection";
import { CartBar } from "@/components/student/CartBar";
import { FoodSearchResultCard } from "@/components/student/search/FoodSearchResultCard";
import { useCart } from "@/lib/cart/CartContext";
import { performUnifiedSearch } from "@/lib/search/unifiedSearch";

import {
  getLiveCampusList,
  getLiveCampusDetails,
  getLiveCampusCanteens,
  getLiveCampusFoodItems,
  type SupabaseCampus,
  type CampusFoodItem,
} from "@/lib/supabase/data";

import {
  detectNearestCampus,
  type CampusLocationItem,
  type CampusDetectionResult,
} from "@/lib/utils/geolocation";
import { getUserLocation } from "@/lib/utils/user_location";
import {
  getActiveCampusId,
  setActiveCampusId,
  addRecentlyUsedCampusId,
} from "@/lib/campus/campus_storage";

import { mockCanteenCategories, type MockCanteen, type MockCanteenCategory } from "@/lib/mock/campus";

type CampusDetails = { id: string; name: string; canteensOpen: number; estWaitMinutes: number };

export function StudentDashboardClient({
  initialCampuses,
  initialCampusDetails,
  initialCanteens,
  initialFoodItems = [],
}: {
  initialCampuses: SupabaseCampus[];
  initialCampusDetails: CampusDetails | null;
  initialCanteens: MockCanteen[];
  initialFoodItems?: CampusFoodItem[];
}) {
  const [campuses, setCampuses] = useState<SupabaseCampus[]>(initialCampuses);
  const [activeCampus, setActiveCampus] = useState<{ id: string; name: string } | null>(
    initialCampusDetails,
  );
  const [canteenStats, setCanteenStats] = useState({
    canteensOpen: initialCampusDetails?.canteensOpen ?? 0,
    estWaitMinutes: initialCampusDetails?.estWaitMinutes ?? 0,
  });
  const [canteens, setCanteens] = useState<MockCanteen[]>(initialCanteens);
  const [foodItems, setFoodItems] = useState<CampusFoodItem[]>(initialFoodItems);
  const [isLoadingCanteens, setIsLoadingCanteens] = useState(false);

  // Monotonic request counter to prevent race conditions on fast campus switches
  const campusRequestIdRef = useRef(0);

  // Shared cart — same store the Menu screen and Checkout read from.
  const cart = useCart();
  const [lastCartSnapshot, setLastCartSnapshot] = useState<{ canteenName: string; total: number; itemCount: number } | null>(null);
  useEffect(() => {
    if (cart.canteenName) {
      setLastCartSnapshot({ canteenName: cart.canteenName, total: cart.subtotal, itemCount: cart.itemCount });
    }
  }, [cart.canteenName, cart.subtotal, cart.itemCount]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<MockCanteenCategory>("all");

  // Geolocation & Modal State
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [locationStatusMessage, setLocationStatusMessage] = useState<string | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingConfirmCampus, setPendingConfirmCampus] = useState<
    { campus: SupabaseCampus; distanceMeters: number } | null
  >(null);
  const [allNearbyCampuses, setAllNearbyCampuses] = useState<
    Array<{ campus: SupabaseCampus; distanceMeters: number }> | null
  >(null);

  // Cart conflict modal state
  const [isCartConflictModalOpen, setIsCartConflictModalOpen] = useState(false);
  const [targetCampusToSwitch, setTargetCampusToSwitch] = useState<SupabaseCampus | null>(null);

  // Load campus details, canteens & food items when active campus changes
  const loadCampusData = useCallback(async (campusId: string) => {
    const requestId = ++campusRequestIdRef.current;
    setIsLoadingCanteens(true);
    try {
      const [details, canteenList, foodList] = await Promise.all([
        getLiveCampusDetails(campusId),
        getLiveCampusCanteens(campusId),
        getLiveCampusFoodItems(campusId),
      ]);

      // Discard stale responses if a newer request was dispatched
      if (requestId !== campusRequestIdRef.current) return;

      if (details) {
        setActiveCampus({ id: details.id, name: details.name });
        setCanteenStats({
          canteensOpen: details.canteensOpen,
          estWaitMinutes: details.estWaitMinutes,
        });
      } else {
        setActiveCampus(null);
        setCanteenStats({ canteensOpen: 0, estWaitMinutes: 0 });
      }
      setCanteens(canteenList);
      setFoodItems(foodList);
    } catch {
      if (requestId === campusRequestIdRef.current) {
        setActiveCampus(null);
        setCanteens([]);
        setFoodItems([]);
      }
    } finally {
      if (requestId === campusRequestIdRef.current) {
        setIsLoadingCanteens(false);
      }
    }
  }, []);

  // Perform actual campus switch and persist MRU state
  const performCampusSwitch = useCallback(
    (campus: SupabaseCampus) => {
      setActiveCampusId(campus.id);
      addRecentlyUsedCampusId(campus.id);
      setLocationStatusMessage(undefined);
      setPendingConfirmCampus(null);
      setAllNearbyCampuses(null);
      loadCampusData(campus.id);
    },
    [loadCampusData],
  );

  // GPS-based campus detection — pure device location + Haversine distance.
  // When single campus is detected with high confidence (inside campus geofence), automatically selects and closes modal.
  // When multiple campuses are nearby, presents selectable choice.
  // When medium confidence (1-5km), asks user to confirm.
  // When low confidence (>5km), presents friendly message and manual selection.
  const triggerAutoDetection = useCallback(
    async (campusList: SupabaseCampus[]) => {
      if (isDetectingLocation) return;
      setIsDetectingLocation(true);
      setLocationStatusMessage(undefined);
      setPendingConfirmCampus(null);
      setAllNearbyCampuses(null);

      const { result, errorStatus } = await getUserLocation(8000);
      setIsDetectingLocation(false);

      if (!result) {
        if (errorStatus === "DENIED" || errorStatus === "PERMANENTLY_DENIED") {
          setLocationStatusMessage(
            "Location permission is required to automatically detect your campus. Please choose your campus manually below.",
          );
        } else if (errorStatus === "TIMEOUT") {
          setLocationStatusMessage(
            "Location request timed out. Please tap Auto-Detect to retry or choose your campus manually below.",
          );
        } else if (errorStatus === "UNSUPPORTED") {
          setLocationStatusMessage(
            "GPS location is not supported on this device. Please select your campus manually below.",
          );
        } else {
          setLocationStatusMessage(
            "Location services are turned off or unavailable on your device. Please choose your campus manually below.",
          );
        }
        return;
      }

      const campusItems: CampusLocationItem[] = campusList.map((c) => ({
        id: c.id,
        name: c.name,
        city: c.city,
        latitude: c.latitude,
        longitude: c.longitude,
        radiusMeters: c.radius_meters,
      }));

      let detection: CampusDetectionResult;
      try {
        const resp = await fetch("/api/location/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: result.latitude,
            longitude: result.longitude,
            accuracy: result.accuracy,
            campuses: campusItems,
          }),
        });

        if (resp.ok) {
          detection = await resp.json();
        } else {
          detection = detectNearestCampus(
            result.latitude,
            result.longitude,
            result.accuracy,
            campusItems,
          );
        }
      } catch {
        detection = detectNearestCampus(
          result.latitude,
          result.longitude,
          result.accuracy,
          campusItems,
        );
      }

      // Filter nearby campuses within their allowed geofence or <= 2500m
      const nearbyList = (detection.allNearby || []).filter((item) => {
        const radius = item.campus.radiusMeters ?? 2500;
        return item.distanceMeters <= radius;
      });

      const mappedNearby = nearbyList
        .map((item) => {
          const found = campusList.find((c) => c.id === item.campus.id);
          return found ? { campus: found, distanceMeters: item.distanceMeters } : null;
        })
        .filter((item): item is { campus: SupabaseCampus; distanceMeters: number } => Boolean(item));

      if (mappedNearby.length > 1) {
        // Multiple nearby campuses detected within detection radius — show selection cards
        setAllNearbyCampuses(mappedNearby);
        setLocationStatusMessage(undefined);
        return;
      }

      if (detection.detectedCampus && detection.distanceMeters != null) {
        const match = campusList.find((c) => c.id === detection.detectedCampus!.id);
        if (match) {
          const allowedRadius = match.radius_meters ?? 2000;
          const isHighConfidence =
            detection.confidence === "HIGH" || detection.distanceMeters <= allowedRadius;

          if (isHighConfidence) {
            // HIGH CONFIDENCE: Inside campus geofence -> AUTO-SELECT, PERSIST, CLOSE MODAL, REFRESH HOME
            if (activeCampus && match.id !== activeCampus.id && cart.itemCount > 0) {
              setTargetCampusToSwitch(match);
              setIsCartConflictModalOpen(true);
              return;
            }

            performCampusSwitch(match);
            setIsModalOpen(false);
            return;
          }

          if (detection.distanceMeters <= 5000) {
            // MEDIUM CONFIDENCE: Within 5km -> ask for confirmation
            setPendingConfirmCampus({ campus: match, distanceMeters: detection.distanceMeters });
            setLocationStatusMessage(undefined);
            return;
          }
        }
      }

      // LOW CONFIDENCE (> 5km or no campus match)
      setLocationStatusMessage(
        "No supported GRABIT campus found near your location. Please choose your campus manually below.",
      );
    },
    [isDetectingLocation, activeCampus, cart.itemCount, performCampusSwitch],
  );

  // Initial Load: restore any saved campus selection.
  useEffect(() => {
    async function init() {
      let liveCampuses = initialCampuses;
      if (liveCampuses.length === 0) {
        liveCampuses = await getLiveCampusList();
        setCampuses(liveCampuses);
      }

      const savedId = getActiveCampusId();
      const found = savedId ? liveCampuses.find((c) => c.id === savedId) : null;
      if (found) {
        addRecentlyUsedCampusId(found.id);
        if (found.id !== initialCampusDetails?.id) {
          loadCampusData(found.id);
        }
      } else if (initialCampusDetails) {
        setActiveCampusId(initialCampusDetails.id);
        addRecentlyUsedCampusId(initialCampusDetails.id);
      }
    }

    init();
  }, [initialCampuses, initialCampusDetails, loadCampusData]);

  // Handle manual campus selection attempt
  const handleSelectCampus = (campus: SupabaseCampus) => {
    if (activeCampus && campus.id !== activeCampus.id && cart.itemCount > 0) {
      setTargetCampusToSwitch(campus);
      setIsCartConflictModalOpen(true);
      return;
    }
    performCampusSwitch(campus);
  };

  const handleConfirmDetectedCampus = (campusOverride?: SupabaseCampus) => {
    const campus = campusOverride || pendingConfirmCampus?.campus;
    if (!campus) return;
    if (activeCampus && campus.id !== activeCampus.id && cart.itemCount > 0) {
      setTargetCampusToSwitch(campus);
      setIsCartConflictModalOpen(true);
      return;
    }
    performCampusSwitch(campus);
    setIsModalOpen(false);
  };

  const handleConfirmSwitchAndClearCart = () => {
    if (!targetCampusToSwitch) return;
    cart.clearCart();
    performCampusSwitch(targetCampusToSwitch);
    setIsCartConflictModalOpen(false);
    setTargetCampusToSwitch(null);
    setIsModalOpen(false);
  };

  const isSearching = searchQuery.trim().length > 0;

  // Filter canteens strictly within active campus by category when not searching
  const filteredCanteens = useMemo(() => {
    return canteens.filter((canteen) => {
      return selectedCategory === "all" || canteen.category === selectedCategory;
    });
  }, [canteens, selectedCategory]);

  // Unified search results across food items and stalls
  const searchResults = useMemo(() => {
    if (!isSearching) {
      return { foodItems: [], canteens: [], hasResults: false };
    }
    return performUnifiedSearch(searchQuery, foodItems, canteens);
  }, [isSearching, searchQuery, foodItems, canteens]);

  const handleOpenModal = () => {
    setLocationStatusMessage(undefined);
    setPendingConfirmCampus(null);
    setIsModalOpen(true);
  };

  if (!activeCampus) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-5 text-center">
        <span className="material-symbols-outlined text-[48px] text-muted mb-3">school</span>
        <p className="font-display text-body-sm font-bold text-foreground">
          No campus is available yet.
        </p>
        <p className="mt-1 font-body text-caption text-muted">
          Please check back later or contact your GRABIT campus admin.
        </p>
      </main>
    );
  }

  return (
    <>
      <CampusHeader
        campusName={activeCampus.name}
        isDetecting={isDetectingLocation}
        onOpenCampusSelector={handleOpenModal}
      />

      <main
        className={`mx-auto max-w-2xl px-4 pt-4 md:px-16 md:pt-6 ${
          cart.itemCount > 0
            ? "pb-[calc(10rem+var(--safe-area-inset-bottom,0px))]"
            : "pb-[calc(7.5rem+var(--safe-area-inset-bottom,0px))]"
        }`}
      >
        {/* Dynamic Canteen Status Banner */}
        <CanteenStatusBanner
          canteensOpen={canteenStats.canteensOpen}
          estWaitMinutes={canteenStats.estWaitMinutes}
        />

        {/* Hero & Search Section */}
        <section className="mb-6 space-y-4">
          <h1 className="text-balance font-display text-[28px] font-extrabold leading-[1.2] tracking-tight text-white md:text-display">
            Crave it. <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-orange-400">Grab it.</span>
          </h1>

          <div className="group relative">
            <span
              className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 text-[20px]"
              aria-hidden="true"
            >
              search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeCampus.name} stalls or dishes...`}
              aria-label="Search stalls or dishes"
              className="w-full rounded-2xl border border-white/[0.10] bg-white/[0.04] py-4 pl-12 pr-10 text-body text-white outline-none transition-all placeholder:text-zinc-500 backdrop-blur-xl focus:border-primary focus:bg-white/[0.07] focus:ring-2 focus:ring-primary/30 shadow-[0_4px_20px_rgba(0,0,0,0.3)] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:hidden"
            />
            {isSearching && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-zinc-400 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>
        </section>

        {!isSearching ? (
          <>
            {/* Campus-Scoped Recommendations */}
            <StudentRecommendationsSection
              campusId={activeCampus?.id}
              campusName={activeCampus?.name}
            />

            {/* Category Chips */}
            <section className="mb-6">
              <CategoryChips
                categories={mockCanteenCategories}
                selected={selectedCategory}
                onSelect={setSelectedCategory}
              />
            </section>

            {/* Canteen Cards Grid */}
            <section className="grid grid-cols-1 gap-4">
              {isLoadingCanteens ? (
                <div className="py-12 text-center text-primary">
                  <span className="material-symbols-outlined animate-spin text-[36px]">
                    progress_activity
                  </span>
                  <p className="mt-2 font-display text-caption font-bold text-zinc-400">
                    Loading stalls for {activeCampus.name}...
                  </p>
                </div>
              ) : (
                <>
                  {filteredCanteens.map((canteen) => (
                    <CanteenCard key={canteen.id} canteen={canteen} />
                  ))}

                  {filteredCanteens.length === 0 && (
                    <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 text-center backdrop-blur-xl">
                      <span className="material-symbols-outlined text-[40px] text-zinc-500 mb-2">
                        storefront
                      </span>
                      <p className="font-display text-body-sm font-bold text-white">
                        No food stalls available
                      </p>
                      <p className="mt-1 font-body text-caption text-zinc-400">
                        No active canteens open in this category right now.
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenModal}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary/15 border border-primary/30 px-4 py-2 font-display text-caption font-bold text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                      >
                        Switch Campus
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          /* Unified Search Results View */
          <section className="space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <h2 className="flex items-center gap-2 text-body font-bold text-white">
                <span className="material-symbols-outlined text-primary text-lg">search</span>
                Results for <span className="text-primary italic">&ldquo;{searchQuery.trim()}&rdquo;</span>
              </h2>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs font-semibold text-zinc-400 hover:text-primary transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>

            {/* 1. Matching Food / Menu Items */}
            {searchResults.foodItems.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-caption font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">restaurant</span>
                  Dishes &amp; Food Items ({searchResults.foodItems.length})
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {searchResults.foodItems.map((item) => (
                    <FoodSearchResultCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* 2. Matching Food Stalls */}
            {searchResults.canteens.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-caption font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">storefront</span>
                  Food Stalls ({searchResults.canteens.length})
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {searchResults.canteens.map(({ canteen }) => (
                    <CanteenCard key={canteen.id} canteen={canteen} />
                  ))}
                </div>
              </div>
            )}

            {/* 3. Empty State when No Matches Found */}
            {!searchResults.hasResults && (
              <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 text-center space-y-4 backdrop-blur-xl">
                <span className="material-symbols-outlined text-[44px] text-zinc-500">
                  search_off
                </span>
                <div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {["Masala Maggi", "Cold Coffee", "Veg Sandwich", "CHAI", "Burger King", "Starbuck"].map(
                      (tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSearchQuery(tag)}
                          className="rounded-full border border-border-subtle bg-surface px-3 py-1 text-caption text-zinc-300 hover:border-primary/50 hover:text-primary transition-all active:scale-95 cursor-pointer"
                        >
                          {tag}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {lastCartSnapshot && (
        <CartBar
          canteenName={lastCartSnapshot.canteenName}
          itemCount={cart.itemCount > 0 ? cart.itemCount : lastCartSnapshot.itemCount}
          total={cart.itemCount > 0 ? cart.subtotal : lastCartSnapshot.total}
          visible={cart.itemCount > 0}
        />
      )}

      {/* Interactive Campus Selector Modal */}
      <CampusSelectorModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setPendingConfirmCampus(null);
          setAllNearbyCampuses(null);
        }}
        campuses={campuses}
        selectedCampusId={activeCampus.id}
        onSelectCampus={handleSelectCampus}
        onDetectLocation={() => triggerAutoDetection(campuses)}
        isDetectingLocation={isDetectingLocation}
        locationStatusMessage={locationStatusMessage}
        pendingConfirmCampus={pendingConfirmCampus}
        allNearbyCampuses={allNearbyCampuses}
        onConfirmDetectedCampus={handleConfirmDetectedCampus}
        onDismissConfirm={() => {
          setPendingConfirmCampus(null);
          setAllNearbyCampuses(null);
        }}
        cartItemCount={cart.itemCount}
        currentCampusName={activeCampus.name}
        onAttemptSwitchWithCart={(target) => {
          setTargetCampusToSwitch(target);
          setIsCartConflictModalOpen(true);
        }}
      />

      {/* Cart Conflict Protection Modal */}
      <CampusSwitchCartModal
        isOpen={isCartConflictModalOpen}
        onClose={() => {
          setIsCartConflictModalOpen(false);
          setTargetCampusToSwitch(null);
        }}
        targetCampus={targetCampusToSwitch}
        currentCampusName={activeCampus.name}
        cartItemCount={cart.itemCount}
        onConfirmSwitchAndClearCart={handleConfirmSwitchAndClearCart}
      />
    </>
  );
}
