export type CurrencyCode = "BDT" | "USD" | "EUR" | "INR" | "GBP" | "AED" | "PKR";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  label: string;
  flag: string;
  rateFromUsd: number;
  decimals: number;
  locale: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  BDT: { code: "BDT", symbol: "৳", label: "Bangladeshi Taka", flag: "🇧🇩", rateFromUsd: 110, decimals: 0, locale: "en-BD" },
  USD: { code: "USD", symbol: "$", label: "US Dollar",        flag: "🇺🇸", rateFromUsd: 1, decimals: 2, locale: "en-US" },
  EUR: { code: "EUR", symbol: "€", label: "Euro",              flag: "🇪🇺", rateFromUsd: 0.92, decimals: 2, locale: "de-DE" },
  GBP: { code: "GBP", symbol: "£", label: "British Pound",     flag: "🇬🇧", rateFromUsd: 0.79, decimals: 2, locale: "en-GB" },
  INR: { code: "INR", symbol: "₹", label: "Indian Rupee",      flag: "🇮🇳", rateFromUsd: 84,   decimals: 0, locale: "en-IN" },
  AED: { code: "AED", symbol: "د.إ",label: "UAE Dirham",       flag: "🇦🇪", rateFromUsd: 3.67, decimals: 2, locale: "en-AE" },
  PKR: { code: "PKR", symbol: "₨", label: "Pakistani Rupee",   flag: "🇵🇰", rateFromUsd: 278,  decimals: 0, locale: "en-PK" },
};

export const DEFAULT_CURRENCY: CurrencyCode = "BDT";

export function isCurrencyCode(v: string | null | undefined): v is CurrencyCode {
  return !!v && v in CURRENCIES;
}

/**
 * Convert a base USD amount (in cents) into the selected currency.
 * For BDT, prefer the explicit `priceAmountBdt` (paisa) when available — more accurate than FX conversion.
 */
export function convertFromUsdCents(
  usdCents: number,
  target: CurrencyCode,
  bdtPaisa?: number | null
): number {
  if (target === "BDT" && bdtPaisa != null && bdtPaisa > 0) {
    return bdtPaisa / 100;
  }
  const usd = usdCents / 100;
  const meta = CURRENCIES[target];
  return usd * meta.rateFromUsd;
}

export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const meta = CURRENCIES[currency];
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: meta.decimals,
  };
  return meta.symbol + new Intl.NumberFormat(meta.locale, opts).format(amount);
}

/** Format with currency symbol; rounds to whole numbers for currencies with decimals=0 */
export function formatPriceInCurrency(
  usdCents: number,
  currency: CurrencyCode,
  bdtPaisa?: number | null
): string {
  const value = convertFromUsdCents(usdCents, currency, bdtPaisa);
  return formatCurrency(value, currency);
}
