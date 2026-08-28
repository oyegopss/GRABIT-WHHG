import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "@/lib/capacitor/platform";
import type { VendorAnalyticsData } from "@/lib/supabase/vendor_analytics";

interface PdfDownloadPluginType {
  isAvailable?: () => Promise<{ available: boolean }>;
  downloadPdf: (options: {
    base64: string;
    fileName: string;
    openImmediately?: boolean;
  }) => Promise<{ success: boolean; fileName: string; uri?: string }>;
}

let cachedPdfPlugin: PdfDownloadPluginType | null | undefined;

function getPdfDownloadPlugin(): PdfDownloadPluginType | null {
  if (cachedPdfPlugin !== undefined) return cachedPdfPlugin;
  try {
    cachedPdfPlugin = registerPlugin<PdfDownloadPluginType>("PdfDownload");
    return cachedPdfPlugin;
  } catch (err) {
    console.warn("[pdf] Could not register PdfDownload plugin:", err);
    return null;
  }
}

const money = (n: number) => `Rs. ${(Number(n) || 0).toFixed(2)}`;
const fmtPercent = (n: number) => {
  const num = Number(n) || 0;
  return `${num >= 0 ? "+" : ""}${num.toFixed(1)}%`;
};

const TIMEFRAME_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  this_month: "This Month",
};

export interface ExportPdfOptions {
  data: VendorAnalyticsData;
  storeName?: string;
  timeframe?: string;
}

/**
 * Generates a clean, comprehensive PDF report for Vendor Analytics
 * and saves it to the Android device via native download plugin or browser download.
 */
export async function exportVendorAnalyticsPdf({
  data,
  storeName = "GRABIT Store",
  timeframe = "7d",
}: ExportPdfOptions): Promise<{ success: boolean; fileName: string; error?: string }> {
  try {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 40;

    const brandOrange: [number, number, number] = [255, 109, 0];
    const textDark: [number, number, number] = [24, 24, 27];
    const textMuted: [number, number, number] = [113, 113, 122];

    const addFooterOnAllPages = () => {
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...textMuted);
        doc.text("GRABIT • Campus Canteen OS", marginX, pageHeight - 20);
        doc.text(
          `Page ${i} of ${pageCount}  |  Confidential`,
          pageWidth - marginX,
          pageHeight - 20,
          { align: "right" }
        );
      }
    };

    let y = 44;

    // Header Branding
    doc.setFontSize(22);
    doc.setTextColor(...brandOrange);
    doc.setFont("helvetica", "bold");
    doc.text("GRABIT", marginX, y);

    doc.setFontSize(10);
    doc.setTextColor(...textMuted);
    doc.setFont("helvetica", "normal");
    const genDateStr = new Date().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    doc.text(`Generated: ${genDateStr}`, pageWidth - marginX, y, { align: "right" });

    y += 18;
    doc.setFontSize(14);
    doc.setTextColor(...textDark);
    doc.setFont("helvetica", "bold");
    doc.text("Vendor Analytics & Insights Report", marginX, y);

    y += 14;
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(1);
    doc.line(marginX, y, pageWidth - marginX, y);

    y += 18;

    // Store & Period Meta Table
    const periodLabel = TIMEFRAME_LABELS[timeframe] || data.timeframe || timeframe;
    const metaRows = [
      ["Store / Outlet", storeName, "Reporting Period", `${periodLabel} (${data.dateRangeLabel || "Live"})`],
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      body: metaRows,
      theme: "plain",
      styles: { fontSize: 9.5, cellPadding: 3, textColor: textDark },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 90, textColor: textMuted },
        1: { fontStyle: "bold", cellWidth: 160 },
        2: { fontStyle: "bold", cellWidth: 100, textColor: textMuted },
        3: { fontStyle: "bold" },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 16;

    // 1. EXECUTIVE SUMMARY METRICS
    doc.setFontSize(11);
    doc.setTextColor(...brandOrange);
    doc.setFont("helvetica", "bold");
    doc.text("1. EXECUTIVE PERFORMANCE SUMMARY", marginX, y);
    y += 6;

    const m = data.metrics || {};
    const summaryRows = [
      [
        "Total Revenue",
        money(m.totalRevenue ?? 0),
        m.revenueGrowthPercent !== undefined ? `${fmtPercent(m.revenueGrowthPercent)} vs prev period` : "Live",
      ],
      [
        "Total Orders",
        String(m.totalOrders ?? 0),
        m.ordersGrowthPercent !== undefined ? `${fmtPercent(m.ordersGrowthPercent)} vs prev period` : "Live",
      ],
      [
        "Average Order Value (AOV)",
        money(m.avgOrderValue ?? 0),
        m.aovGrowthPercent !== undefined ? `${fmtPercent(m.aovGrowthPercent)} vs prev period` : "Live",
      ],
      ["Total Items Sold", String(m.itemsSold ?? 0), "-"],
      ["Fulfillment Completion Rate", `${(m.completionRate ?? 0).toFixed(1)}%`, `${m.completedOrders ?? 0} orders completed`],
      ["Cancellation Rate", `${(m.cancellationRate ?? 0).toFixed(1)}%`, `${m.cancelledOrders ?? 0} orders cancelled`],
    ];

    if (m.avgPrepTimeMinutes) {
      summaryRows.push(["Avg Preparation Time", `${m.avgPrepTimeMinutes} mins`, "Kitchen target met"]);
    }

    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [["Metric", "Value", "Growth / Details"]],
      body: summaryRows,
      theme: "grid",
      headStyles: { fillColor: brandOrange, textColor: 255, fontStyle: "bold", fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 170 },
        1: { fontStyle: "bold", cellWidth: 120 },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 16;

    // 2. ORDER FULFILLMENT BREAKDOWN
    if (data.orderStatusBreakdown) {
      doc.setFontSize(11);
      doc.setTextColor(...brandOrange);
      doc.setFont("helvetica", "bold");
      doc.text("2. ORDER FULFILLMENT STATUS BREAKDOWN", marginX, y);
      y += 6;

      const bd = data.orderStatusBreakdown;
      const total = (bd.placed || 0) + (bd.preparing || 0) + (bd.ready || 0) + (bd.completed || 0) + (bd.cancelled || 0) || 1;
      const bdRows = [
        ["Placed (New)", String(bd.placed || 0), `${(((bd.placed || 0) / total) * 100).toFixed(1)}%`],
        ["Preparing (Kitchen)", String(bd.preparing || 0), `${(((bd.preparing || 0) / total) * 100).toFixed(1)}%`],
        ["Ready for Pickup", String(bd.ready || 0), `${(((bd.ready || 0) / total) * 100).toFixed(1)}%`],
        ["Completed & Delivered", String(bd.completed || 0), `${(((bd.completed || 0) / total) * 100).toFixed(1)}%`],
        ["Cancelled", String(bd.cancelled || 0), `${(((bd.cancelled || 0) / total) * 100).toFixed(1)}%`],
      ];

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [["Order Stage", "Count", "% Share"]],
        body: bdRows,
        theme: "grid",
        headStyles: { fillColor: [40, 40, 45], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
        styles: { fontSize: 8.5, cellPadding: 4 },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 16;
    }

    // Check page space for Top Products
    if (y > pageHeight - 200) {
      doc.addPage();
      y = 44;
    }

    // 3. TOP SELLING PRODUCTS
    if (data.topProducts && data.topProducts.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(...brandOrange);
      doc.setFont("helvetica", "bold");
      doc.text("3. TOP SELLING DISHES & PRODUCTS", marginX, y);
      y += 6;

      const productRows = data.topProducts.slice(0, 10).map((p, idx) => [
        `#${idx + 1} ${p.name}`,
        p.category || "General",
        money(p.price || 0),
        String(p.unitsSold || 0),
        money(p.revenue || 0),
        `${(p.percentageOfTotal || 0).toFixed(1)}%`,
      ]);

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [["Product Name", "Category", "Unit Price", "Units Sold", "Revenue", "Revenue Share"]],
        body: productRows,
        theme: "grid",
        headStyles: { fillColor: brandOrange, textColor: 255, fontStyle: "bold", fontSize: 8.5 },
        styles: { fontSize: 8.5, cellPadding: 4 },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 150 },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 16;
    }

    // Check page space for Category / Peak hours
    if (y > pageHeight - 180) {
      doc.addPage();
      y = 44;
    }

    // 4. CATEGORY PERFORMANCE
    if (data.categoryAnalytics && data.categoryAnalytics.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(...brandOrange);
      doc.setFont("helvetica", "bold");
      doc.text("4. MENU CATEGORY CONTRIBUTION", marginX, y);
      y += 6;

      const catRows = data.categoryAnalytics.map((c) => [
        c.category,
        String(c.orderCount || 0),
        String(c.itemsSold || 0),
        money(c.revenue || 0),
        `${(c.percentageContribution || 0).toFixed(1)}%`,
      ]);

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [["Category", "Orders", "Items Sold", "Revenue", "Revenue Share"]],
        body: catRows,
        theme: "grid",
        headStyles: { fillColor: [40, 40, 45], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
        styles: { fontSize: 8.5, cellPadding: 4 },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 16;
    }

    // 5. CUSTOMER & INVENTORY INSIGHTS (if available)
    if (data.customerInsights || data.inventoryInsights) {
      if (y > pageHeight - 160) {
        doc.addPage();
        y = 44;
      }

      doc.setFontSize(11);
      doc.setTextColor(...brandOrange);
      doc.setFont("helvetica", "bold");
      doc.text("5. OPERATIONAL & CUSTOMER INSIGHTS", marginX, y);
      y += 6;

      const insightRows: string[][] = [];
      if (data.customerInsights) {
        insightRows.push([
          "Unique Customers Served",
          String(data.customerInsights.uniqueCustomersCount || 0),
          `Repeat Rate: ${(data.customerInsights.repeatOrderRate || 0).toFixed(1)}%`,
        ]);
        insightRows.push([
          "Customer Retention",
          `${data.customerInsights.returningCustomersCount || 0} returning`,
          `${data.customerInsights.newCustomersCount || 0} first-time customers`,
        ]);
      }
      if (data.peakHourSummary?.peakHourLabel) {
        insightRows.push([
          "Peak Ordering Window",
          data.peakHourSummary.peakHourLabel,
          `Avg ${data.peakHourSummary.avgOrdersPerHour || 0} orders/hr`,
        ]);
      }
      if (data.inventoryInsights) {
        insightRows.push([
          "Stock Alerts",
          `${data.inventoryInsights.lowStockCount || 0} Low Stock | ${data.inventoryInsights.outOfStockCount || 0} Out of Stock`,
          `${data.inventoryInsights.totalStockUnits || 0} Total Units in Inventory`,
        ]);
      }

      if (insightRows.length > 0) {
        autoTable(doc, {
          startY: y,
          margin: { left: marginX, right: marginX },
          head: [["Insight Area", "Current Observation", "Supporting Detail"]],
          body: insightRows,
          theme: "grid",
          headStyles: { fillColor: [40, 40, 45], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
          styles: { fontSize: 8.5, cellPadding: 4 },
          columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 } },
        });
      }
    }

    addFooterOnAllPages();

    const dateIsoStr = new Date().toISOString().split("T")[0];
    const fileName = `GRABIT_Vendor_Analytics_${dateIsoStr}.pdf`;

    // Save to Device or Browser
    if (isNativePlatform()) {
      const pdfBase64 = doc.output("datauristring");
      const plugin = getPdfDownloadPlugin();
      if (plugin) {
        const res = await plugin.downloadPdf({
          base64: pdfBase64,
          fileName,
          openImmediately: true,
        });
        if (res?.success) {
          return { success: true, fileName };
        }
      }
    }

    // Web Fallback: Direct Download
    doc.save(fileName);
    return { success: true, fileName };
  } catch (err) {
    console.error("[exportVendorAnalyticsPdf] Error generating PDF:", err);
    return {
      success: false,
      fileName: "",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
