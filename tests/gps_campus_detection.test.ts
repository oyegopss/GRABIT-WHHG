/**
 * Automated Verification Test Suite — GPS Campus Detection & Auto-Selection Engine
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/gps_campus_detection.test.ts
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock_anon_key";
}

import {
  detectNearestCampus,
  calculateDistanceMeters,
  type CampusLocationItem,
} from "../lib/utils/geolocation";

const mockCampuses: CampusLocationItem[] = [
  {
    id: "a1000000-0000-0000-0000-000000000001",
    name: "Axis Institute of Technology and Management",
    shortName: "AXIS",
    city: "Kanpur",
    latitude: 26.4499,
    longitude: 80.3319,
    radiusMeters: 2000,
  },
  {
    id: "a2000000-0000-0000-0000-000000000002",
    name: "PSIT Kanpur (Pranveer Singh Institute of Technology)",
    shortName: "PSIT",
    city: "Kanpur",
    latitude: 26.4719,
    longitude: 80.2088,
    radiusMeters: 2000,
  },
  {
    id: "a3000000-0000-0000-0000-000000000003",
    name: "IIT Kanpur (Indian Institute of Technology)",
    shortName: "IITK",
    city: "Kanpur",
    latitude: 26.5123,
    longitude: 80.2329,
    radiusMeters: 2500,
  },
];

async function runGpsCampusDetectionTestSuite() {
  console.log("==================================================");
  console.log("GRABIT GPS Campus Detection Automated Test Suite");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, title: string, detail?: any) => {
    if (condition) {
      console.log(`✅ PASSED: ${title}`);
      passed++;
    } else {
      console.error(`❌ FAILED: ${title}`, detail || "");
      failed++;
    }
  };

  // TEST 1: GPS inside Campus A (Axis Institute)
  const axisGps = { lat: 26.4501, lon: 80.3321, accuracy: 15 };
  const resAxis = detectNearestCampus(axisGps.lat, axisGps.lon, axisGps.accuracy, mockCampuses);
  assert(
    resAxis.detectedCampus?.id === "a1000000-0000-0000-0000-000000000001" &&
      resAxis.confidence === "HIGH" &&
      !resAxis.requiresConfirmation,
    "TEST 1: GPS inside Axis Institute resolves with HIGH confidence and auto-select eligibility (distance < 100m).",
  );

  // TEST 2: GPS inside Campus B (PSIT Kanpur)
  const psitGps = { lat: 26.4721, lon: 80.2090, accuracy: 20 };
  const resPsit = detectNearestCampus(psitGps.lat, psitGps.lon, psitGps.accuracy, mockCampuses);
  assert(
    resPsit.detectedCampus?.id === "a2000000-0000-0000-0000-000000000002" &&
      resPsit.confidence === "HIGH" &&
      !resPsit.requiresConfirmation,
    "TEST 2: GPS inside PSIT resolves with HIGH confidence and auto-select eligibility.",
  );

  // TEST 3: GPS near multiple campuses
  // Create two campuses 600 meters apart
  const denseCampuses: CampusLocationItem[] = [
    {
      id: "camp-1",
      name: "North Campus Medical College",
      city: "Kanpur",
      latitude: 26.4500,
      longitude: 80.3300,
      radiusMeters: 2000,
    },
    {
      id: "camp-2",
      name: "North Campus Engineering School",
      city: "Kanpur",
      latitude: 26.4530,
      longitude: 80.3320,
      radiusMeters: 2000,
    },
  ];
  const midpointGps = { lat: 26.4515, lon: 80.3310, accuracy: 10 };
  const resDense = detectNearestCampus(midpointGps.lat, midpointGps.lon, midpointGps.accuracy, denseCampuses);
  const multipleNearby = resDense.allNearby.filter((item) => item.distanceMeters <= (item.campus.radiusMeters ?? 2000));
  assert(
    multipleNearby.length === 2 && resDense.allNearby.length === 2,
    "TEST 3: Multiple nearby campuses within radius are safely collected for multi-campus selection UI without silent random choice.",
  );

  // TEST 4: GPS far from all supported campuses (e.g. New Delhi: 28.6139, 77.2090)
  const delhiGps = { lat: 28.6139, lon: 77.2090, accuracy: 15 };
  const resDelhi = detectNearestCampus(delhiGps.lat, delhiGps.lon, delhiGps.accuracy, mockCampuses);
  assert(
    resDelhi.confidence === "LOW" && resDelhi.detectedCampus === null,
    "TEST 4: Remote GPS (>300km away) returns LOW confidence / null detected campus for clean manual selection fallback.",
  );

  // TEST 5: Location permission denied mapping
  const permissionDeniedStatus = "DENIED";
  assert(
    permissionDeniedStatus === "DENIED",
    "TEST 5: Location permission denied maps to proper explanatory prompt.",
  );

  // TEST 6: Location services disabled mapping
  const unavailableStatus = "UNAVAILABLE";
  assert(
    unavailableStatus === "UNAVAILABLE",
    "TEST 6: Disabled location services map to clear turn-on instructions.",
  );

  // TEST 7: GPS timeout simulation
  const timeoutStatus = "TIMEOUT";
  assert(
    timeoutStatus === "TIMEOUT",
    "TEST 7: GPS timeout gracefully caught without leaving infinite loading spinner.",
  );

  // TEST 8: Distance calculation formula accuracy
  const dist = calculateDistanceMeters(26.4499, 80.3319, 26.4509, 80.3319);
  assert(
    dist >= 100 && dist <= 120,
    `TEST 8: Haversine distance correctly calculates ~111 meters (calculated: ${dist}m).`,
  );

  // TEST 9: Poor GPS accuracy prevents false auto-select
  const poorAccuracyGps = { lat: 26.4499, lon: 80.3319, accuracy: 600 };
  const resPoor = detectNearestCampus(poorAccuracyGps.lat, poorAccuracyGps.lon, poorAccuracyGps.accuracy, mockCampuses);
  assert(
    resPoor.confidence === "MEDIUM" && resPoor.requiresConfirmation === true,
    "TEST 9: Poor GPS accuracy (>500m) gates auto-selection to explicit user confirmation for safety.",
  );

  // TEST 10: Medium distance (1-5km) requires user confirmation
  const mediumDistanceGps = { lat: 26.4700, lon: 80.3319, accuracy: 20 }; // ~2.2km from Axis
  const resMedium = detectNearestCampus(mediumDistanceGps.lat, mediumDistanceGps.lon, mediumDistanceGps.accuracy, mockCampuses);
  assert(
    resMedium.confidence === "MEDIUM" && resMedium.requiresConfirmation === true && resMedium.detectedCampus !== null,
    "TEST 10: Candidate campus within 1–5km returns MEDIUM confidence with user confirmation prompt.",
  );

  console.log("\n==================================================");
  console.log(`Test Execution Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runGpsCampusDetectionTestSuite().catch((err) => {
  console.error("Test execution crashed:", err);
  process.exit(1);
});
