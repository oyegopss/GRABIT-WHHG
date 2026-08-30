/**
 * Utility to resolve official Indian Bank Name from IFSC code prefix.
 */
export function getBankNameFromIfsc(ifsc?: string | null, customBankName?: string | null): string {
  if (customBankName && customBankName.trim()) {
    return customBankName.trim();
  }
  if (!ifsc || typeof ifsc !== "string" || ifsc.trim().length < 4) {
    return "Bank Account";
  }

  const code = ifsc.trim().substring(0, 4).toUpperCase();
  const BANK_MAP: Record<string, string> = {
    HDFC: "HDFC Bank",
    ICIC: "ICICI Bank",
    SBIN: "State Bank of India",
    KKBK: "Kotak Mahindra Bank",
    AXIS: "Axis Bank",
    UTIB: "Axis Bank",
    PUNB: "Punjab National Bank",
    BARB: "Bank of Baroda",
    CNRB: "Canara Bank",
    UBIN: "Union Bank of India",
    IDIB: "Indian Bank",
    YESB: "YES Bank",
    IDFB: "IDFC First Bank",
    INDB: "IndusInd Bank",
    BKID: "Bank of India",
    CBIN: "Central Bank of India",
    IOBA: "Indian Overseas Bank",
    MAHB: "Bank of Maharashtra",
    PSIB: "Punjab & Sind Bank",
    UCOB: "UCO Bank",
    FDRL: "Federal Bank",
    KVBL: "Karur Vysya Bank",
    SIBL: "South Indian Bank",
    RBLN: "RBL Bank",
    RATN: "RBL Bank",
    CSBK: "CSB Bank",
    DCBL: "DCB Bank",
    TMBL: "Tamilnad Mercantile Bank",
    AUBL: "AU Small Finance Bank",
    ESFB: "Equitas Small Finance Bank",
    UJJV: "Ujjivan Small Finance Bank",
    AIRP: "Airtel Payments Bank",
    PYTM: "Paytm Payments Bank",
    IPOS: "India Post Payments Bank",
    JSBP: "Janata Sahakari Bank",
    NKGS: "NKGSB Co-op Bank",
    SVCB: "SVC Co-operative Bank",
    TBSA: "Thane Bharat Sahakari Bank",
  };

  return BANK_MAP[code] || `${code} Bank`;
}
