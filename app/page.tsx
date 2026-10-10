"use client";

import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePersonalLedger } from "./use-personal-ledger";

const AMOUNT_VISIBILITY_KEY = "finance-personal.amounts-visible.v1";
const EARLIEST_MONTH = "2025-01";
const DEFAULT_FORECAST_BASE_MONTH = currentMonthKey();
const DEFAULT_MONTH = currentMonthKey();
const COLORS = [
  "#245d84",
  "#4b7d9d",
  "#779bb3",
  "#9bb8c8",
  "#406d91",
  "#6a8da7",
  "#86a9bd",
  "#b4cad7",
];

type Asset = { id: string; name: string; color: string };
type AssetPlan = { monthlyBudget: number; annualRate: number };
type StoredAssetPlan = Partial<AssetPlan> & { monthlyRate?: number };
type FundHolding = { code: string; units: number };
type FundQuote = { price: number; asOfDate: string; updatedAt?: string };
type FundQuoteHistory = Record<string, Record<string, FundQuote>>;
type FundPriceCache = {
  funds?: Record<string, FundQuote>;
  history?: FundQuoteHistory;
};
type BudgetCategory = "budget" | "other";
type BudgetGroup = { id: string; name: string; category: BudgetCategory };
type BudgetPeriod = {
  id: string;
  category: BudgetCategory;
  groupId?: string;
  mode: "single" | "range" | "recurring";
  intervalMonths: number;
  memo: string;
  startMonth: string;
  endMonth: string;
  income: number;
  expense: number;
  investments: Record<string, number>;
};
type WorkspaceTab = "assets" | "plans" | "settings";
type ChartRange = "S" | "L" | "LL";
type PlanSortOrder = "asc" | "desc";

const CHART_RANGE_MONTHS: Record<ChartRange, number> = {
  S: 12,
  L: 60,
  LL: 180,
};
type Ledger = {
  assets: Asset[];
  selectedMonth: string;
  inputMonths: string[];
  forecastBaseMonth: string;
  values: Record<string, Record<string, number>>;
  plans: Record<string, AssetPlan>;
  fundAssets: string[];
  fundHoldings: Record<string, FundHolding>;
  budgetGroups: BudgetGroup[];
  budgetPeriods: BudgetPeriod[];
};
const EMPTY_ASSET_PLAN: AssetPlan = { monthlyBudget: 0, annualRate: 0 };

function currentMonthKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function zeroInvestments(assets: Asset[]) {
  return Object.fromEntries(
    assets
      .filter((asset) => asset.id !== "cash")
      .map((asset) => [asset.id, 0]),
  );
}

function createInitialLedger(): Ledger {
  return {
    assets: [
      { id: "cash", name: "現金", color: COLORS[0] },
      { id: "item-1", name: "商品1", color: COLORS[1] },
      { id: "item-2", name: "商品2", color: COLORS[2] },
    ],
    selectedMonth: DEFAULT_MONTH,
    inputMonths: [],
    forecastBaseMonth: DEFAULT_FORECAST_BASE_MONTH,
    values: { [DEFAULT_MONTH]: {} },
    plans: {},
    fundAssets: [],
    fundHoldings: {},
    budgetGroups: [],
    budgetPeriods: [],
  };
}

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
}

function monthShortLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year.slice(2)}.${value}`;
}

function monthRange(start: string, end: string) {
  const result: string[] = [];
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  let cursor = startYear * 12 + startMonth - 1;
  const last = endYear * 12 + endMonth - 1;

  while (cursor <= last) {
    const year = Math.floor(cursor / 12);
    const month = (cursor % 12) + 1;
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    cursor += 1;
  }
  return result;
}

function shiftMonth(month: string, amount: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(startMonth: string, endMonth: string) {
  const [startYear, startValue] = startMonth.split("-").map(Number);
  const [endYear, endValue] = endMonth.split("-").map(Number);
  return (endYear - startYear) * 12 + endValue - startValue;
}

function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function displayedYen(value: number, visible: boolean) {
  return visible ? formatYen(value) : "••••";
}

function CurrencyInput({
  value,
  hasValue = value !== 0,
  showAmounts,
  readOnly = false,
  allowNegative = false,
  className,
  ariaLabel,
  placeholder = "0",
  onValueChange,
}: {
  value: number;
  hasValue?: boolean;
  showAmounts: boolean;
  readOnly?: boolean;
  allowNegative?: boolean;
  className?: string;
  ariaLabel: string;
  placeholder?: string;
  onValueChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const rawValue = hasValue ? String(value) : "";

  useEffect(() => {
    if (!editing) setDraft(rawValue);
  }, [editing, rawValue]);

  const sanitize = (input: string) => {
    const cleaned = input.replace(allowNegative ? /[^0-9-]/g : /[^0-9]/g, "");
    if (!allowNegative) return cleaned;
    const negative = cleaned.startsWith("-") ? "-" : "";
    return `${negative}${cleaned.replace(/-/g, "")}`;
  };

  return (
    <input
      ref={inputRef}
      className={className}
      type="text"
      draggable={false}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={editing ? draft : (hasValue ? displayedYen(value, showAmounts) : "")}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={ariaLabel}
      onFocus={(event) => {
        if (readOnly) return;
        const caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
        const rawCaret = event.currentTarget.value.slice(0, caret).replace(/[^0-9-]/g, "").length;
        setDraft(rawValue);
        setEditing(true);
        window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(rawCaret, rawCaret));
      }}
      onChange={(event) => {
        const next = sanitize(event.target.value);
        setDraft(next);
        onValueChange(next);
      }}
      onDragStart={(event) => event.stopPropagation()}
      onBlur={() => setEditing(false)}
    />
  );
}

function formatAxis(value: number) {
  if (value >= 100_000_000) return `${Number((value / 100_000_000).toFixed(1))}億`;
  if (value >= 10_000) return `${Number((value / 10_000).toFixed(1))}万`;
  return formatYen(Math.round(value));
}

function niceMaximum(value: number) {
  if (value <= 0) return 100_000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function annualRateFromMonthlyRate(monthlyRate: number) {
  const normalizedMonthlyRate = Math.max(-100, monthlyRate) / 100;
  const annualRate = ((1 + normalizedMonthlyRate) ** 12 - 1) * 100;
  return Math.round(annualRate * 1_000_000) / 1_000_000;
}

function monthlyRateFromAnnualRate(annualRate: number) {
  return (1 + Math.max(-100, annualRate) / 100) ** (1 / 12) - 1;
}

function validMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= EARLIEST_MONTH;
}

function normalizeFundCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function validFundDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value);
}

function quoteForFund(code: string, quotes: Record<string, FundQuote>) {
  const quote = quotes[normalizeFundCode(code)];
  return quote && Number.isFinite(quote.price) && quote.price >= 0 && validFundDate(quote.asOfDate)
    ? quote
    : null;
}

function quoteForFundMonth(
  code: string,
  month: string,
  quotes: Record<string, FundQuote>,
  history: FundQuoteHistory,
) {
  const normalizedCode = normalizeFundCode(code);
  const historical = history[normalizedCode]?.[month];
  if (historical && Number.isFinite(historical.price) && historical.price >= 0 && validFundDate(historical.asOfDate)) {
    return historical;
  }
  const current = quoteForFund(normalizedCode, quotes);
  return current?.asOfDate.slice(0, 7) === month ? current : null;
}

function fundValueForMonth(
  ledger: Ledger,
  quotes: Record<string, FundQuote>,
  history: FundQuoteHistory,
  month: string,
  assetId: string,
) {
  const holding = ledger.fundHoldings[assetId];
  if (!holding || !holding.code || !Number.isFinite(holding.units) || holding.units <= 0) return null;
  const quote = quoteForFundMonth(holding.code, month, quotes, history);
  if (!quote) return null;
  return Math.round((holding.units * quote.price) / 10_000);
}

function carriesBalanceForward(asset: Asset) {
  const name = asset.name.replace(/\s+/g, "").toUpperCase();
  return asset.id === "cash" || name.includes("SBI") || name.includes("FX");
}

function ledgerWithFundQuotes(
  ledger: Ledger,
  quotes: Record<string, FundQuote>,
  history: FundQuoteHistory,
): Ledger {
  let values = ledger.values;
  let inputMonths = ledger.inputMonths;

  for (const asset of ledger.assets) {
    const holding = ledger.fundHoldings[asset.id];
    if (!holding || holding.units <= 0) continue;

    const normalizedCode = normalizeFundCode(holding.code);
    const quotesByMonth = { ...(history[normalizedCode] || {}) };
    const latestQuote = quoteForFund(normalizedCode, quotes);
    if (latestQuote) {
      const month = latestQuote.asOfDate.slice(0, 7);
      const saved = quotesByMonth[month];
      if (!saved || saved.asOfDate <= latestQuote.asOfDate) quotesByMonth[month] = latestQuote;
    }

    for (const [month, quote] of Object.entries(quotesByMonth)) {
      if (month < EARLIEST_MONTH || !validFundDate(quote.asOfDate)) continue;
      const autoValue = Math.round((holding.units * quote.price) / 10_000);
      values = {
        ...values,
        [month]: { ...(values[month] || {}), [asset.id]: autoValue },
      };
      if (!inputMonths.includes(month)) inputMonths = [...inputMonths, month].sort();
    }
  }

  const knownMonths = [...inputMonths].sort();
  if (knownMonths.length > 0) {
    const lastMonth = [knownMonths.at(-1) || EARLIEST_MONTH, currentMonthKey()].sort().at(-1) || EARLIEST_MONTH;
    const months = monthRange(knownMonths[0], lastMonth);
    for (const asset of ledger.assets) {
      if (!carriesBalanceForward(asset)) continue;
      let previousValue: number | undefined;
      for (const month of months) {
        const value = values[month]?.[asset.id];
        if (value !== undefined) {
          previousValue = value;
          continue;
        }
        if (previousValue === undefined) continue;
        values = {
          ...values,
          [month]: { ...(values[month] || {}), [asset.id]: previousValue },
        };
        if (!inputMonths.includes(month)) inputMonths = [...inputMonths, month];
      }
    }
    inputMonths = Array.from(new Set(inputMonths)).sort();
  }

  return values === ledger.values && inputMonths === ledger.inputMonths
    ? ledger
    : { ...ledger, values, inputMonths };
}

function activeBudgetPeriods(ledger: Ledger, month: string) {
  return ledger.budgetPeriods.filter(
    (period) => period.startMonth <= month
      && month <= period.endMonth
      && (period.mode !== "recurring"
        || monthsBetween(period.startMonth, month) % Math.max(1, period.intervalMonths) === 0),
  );
}

function budgetForMonth(ledger: Ledger, month: string, assetId: string) {
  const periods = activeBudgetPeriods(ledger, month);
  if (periods.length > 0) {
    return periods.reduce((total, period) => total + (period.investments[assetId] || 0), 0);
  }
  return Math.max(0, ledger.plans[assetId]?.monthlyBudget || 0);
}

function cashFlowForMonth(ledger: Ledger, month: string) {
  const periods = activeBudgetPeriods(ledger, month);
  if (periods.length === 0) {
    return Math.max(0, ledger.plans.cash?.monthlyBudget || 0);
  }
  const investmentExpense = ledger.assets
    .filter((asset) => asset.id !== "cash")
    .reduce((total, asset) => total + budgetForMonth(ledger, month, asset.id), 0);
  const income = periods.reduce((total, period) => total + period.income, 0);
  const expense = periods.reduce((total, period) => total + period.expense, 0);
  return income - expense - investmentExpense;
}

function forecastValuesForMonth(ledger: Ledger, targetMonth: string) {
  const baseMonth = ledger.forecastBaseMonth;
  if (targetMonth < baseMonth) return null;

  const balances = Object.fromEntries(
    ledger.assets.map((asset) => [asset.id, ledger.values[baseMonth]?.[asset.id] || 0]),
  ) as Record<string, number>;

  for (const month of monthRange(shiftMonth(baseMonth, 1), targetMonth)) {
    for (const asset of ledger.assets) {
      const plan = ledger.plans[asset.id] || EMPTY_ASSET_PLAN;
      const contribution = asset.id === "cash"
        ? cashFlowForMonth(ledger, month)
        : budgetForMonth(ledger, month, asset.id);
      balances[asset.id] = (balances[asset.id] + contribution)
        * (1 + monthlyRateFromAnnualRate(plan.annualRate));
    }
  }

  return balances;
}

function hasNegativeForecast(ledger: Ledger, latestMonth: string, forecastMonths: string[]) {
  const baseMonth = ledger.forecastBaseMonth;
  const balances = new Map(
    ledger.assets.map((asset) => [asset.id, ledger.values[baseMonth]?.[asset.id] || 0]),
  );

  const lastMonth = forecastMonths.at(-1) || latestMonth;
  for (const month of monthRange(shiftMonth(baseMonth, 1), lastMonth)) {
    for (const asset of ledger.assets) {
      const plan = ledger.plans[asset.id] || EMPTY_ASSET_PLAN;
      const contribution = asset.id === "cash"
        ? cashFlowForMonth(ledger, month)
        : budgetForMonth(ledger, month, asset.id);
      const next = ((balances.get(asset.id) || 0) + contribution)
        * (1 + monthlyRateFromAnnualRate(plan.annualRate));
      if (next < 0) return true;
      balances.set(asset.id, next);
    }
  }

  return false;
}

function restoreLedger(input: unknown): Ledger | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Partial<Ledger>;
  if (!Array.isArray(candidate.assets) || candidate.assets.length === 0) return null;
  if (!candidate.values || typeof candidate.values !== "object") return null;

  const assets = candidate.assets.map((asset, index) => {
    if (!asset || typeof asset !== "object") return null;
    const item = asset as Partial<Asset>;
    if (typeof item.id !== "string" || typeof item.name !== "string") return null;
    return { id: item.id, name: item.name, color: COLORS[index % COLORS.length] };
  });
  if (assets.some((asset) => asset === null)) return null;

  const assetIds = new Set(assets.map((asset) => asset?.id));
  const values: Ledger["values"] = {};
  for (const [month, record] of Object.entries(candidate.values)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < EARLIEST_MONTH) continue;
    if (!record || typeof record !== "object") return null;
    values[month] = {};
    for (const [assetId, amount] of Object.entries(record)) {
      if (!assetIds.has(assetId)) continue;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
      values[month][assetId] = amount;
    }
  }

  const inputMonths = Object.entries(values)
    .filter(([, record]) => Object.keys(record).length > 0)
    .map(([month]) => month)
    .sort();
  const selectedMonth =
    typeof candidate.selectedMonth === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate.selectedMonth) &&
    candidate.selectedMonth >= EARLIEST_MONTH
      ? candidate.selectedMonth
      : inputMonths.at(-1) || DEFAULT_MONTH;
  const forecastBaseMonth =
    validMonth(candidate.forecastBaseMonth)
      ? candidate.forecastBaseMonth
      : DEFAULT_FORECAST_BASE_MONTH;

  if (!values[selectedMonth]) values[selectedMonth] = {};

  const rawPlans =
    candidate.plans && typeof candidate.plans === "object"
      ? candidate.plans
      : {};
  const plans = Object.fromEntries(
    (assets as Asset[]).map((asset) => {
      const rawPlan = rawPlans[asset.id] as StoredAssetPlan | undefined;
      const monthlyBudget =
        rawPlan && Number.isFinite(rawPlan.monthlyBudget)
          ? Math.max(0, rawPlan.monthlyBudget as number)
          : 0;
      const annualRate =
        rawPlan && Number.isFinite(rawPlan.annualRate)
          ? Math.max(-100, rawPlan.annualRate as number)
          : rawPlan && Number.isFinite(rawPlan.monthlyRate)
            ? annualRateFromMonthlyRate(rawPlan.monthlyRate as number)
            : 0;
      return [asset.id, { monthlyBudget, annualRate }];
    }),
  );

  const rawFundHoldings =
    candidate.fundHoldings && typeof candidate.fundHoldings === "object"
      ? candidate.fundHoldings
      : {};
  const fundHoldings = Object.fromEntries(
    (assets as Asset[]).flatMap((asset) => {
      const rawHolding = rawFundHoldings[asset.id] as Partial<FundHolding> | undefined;
      if (!rawHolding || typeof rawHolding !== "object") return [];
      const code = typeof rawHolding.code === "string" ? normalizeFundCode(rawHolding.code) : "";
      const units = typeof rawHolding.units === "number" && Number.isFinite(rawHolding.units)
        ? Math.max(0, rawHolding.units)
        : 0;
      return code || units > 0 ? [[asset.id, { code, units }]] : [];
    }),
  ) as Record<string, FundHolding>;
  const fundAssets = Array.from(new Set(
    (Array.isArray(candidate.fundAssets) ? candidate.fundAssets : Object.keys(fundHoldings))
      .filter((assetId): assetId is string => typeof assetId === "string" && assetId !== "cash" && assetIds.has(assetId)),
  ));

  const legacyGroups = candidate as Partial<Ledger> & { otherGroups?: unknown };
  const rawBudgetGroups = Array.isArray(candidate.budgetGroups)
    ? candidate.budgetGroups
    : Array.isArray(legacyGroups.otherGroups)
      ? legacyGroups.otherGroups
      : [];
  const budgetGroups: BudgetGroup[] = rawBudgetGroups.flatMap((rawGroup) => {
        if (!rawGroup || typeof rawGroup !== "object") return [];
        const group = rawGroup as Partial<BudgetGroup>;
        if (typeof group.id !== "string" || typeof group.name !== "string") return [];
        const name = group.name.trim();
        return name ? [{
          id: group.id,
          name,
          category: (group.category === "budget" ? "budget" : "other") as BudgetCategory,
        }] : [];
      })
  const groupCategories = new Map(budgetGroups.map((group) => [group.id, group.category]));

  const budgetPeriods = Array.isArray(candidate.budgetPeriods)
    ? candidate.budgetPeriods.flatMap((rawPeriod) => {
        if (!rawPeriod || typeof rawPeriod !== "object") return [];
        const period = rawPeriod as Partial<BudgetPeriod>;
        if (
          typeof period.id !== "string" ||
          !validMonth(period.startMonth) ||
          !validMonth(period.endMonth) ||
          period.startMonth > period.endMonth
        ) {
          return [];
        }
        const amount = (value: unknown) =>
          typeof value === "number" && Number.isFinite(value) ? value : 0;
        const investments = Object.fromEntries(
          (assets as Asset[])
            .filter((asset) => asset.id !== "cash")
            .map((asset) => [asset.id, amount(period.investments?.[asset.id])]),
        );
        const category = (period.category === "other" || (!period.category && period.mode === "single")
          ? "other"
          : "budget") as BudgetCategory;
        return [{
          id: period.id,
          category,
          groupId: typeof period.groupId === "string" && groupCategories.get(period.groupId) === category
            ? period.groupId
            : undefined,
          mode: (period.mode === "single" || period.mode === "recurring" ? period.mode : "range") as BudgetPeriod["mode"],
          intervalMonths: typeof period.intervalMonths === "number" && Number.isFinite(period.intervalMonths)
            ? Math.max(1, Math.min(120, Math.floor(period.intervalMonths)))
            : 1,
          memo: typeof period.memo === "string" ? period.memo : "",
          startMonth: period.startMonth,
          endMonth: period.endMonth,
          income: amount(period.income),
          expense: amount(period.expense),
          investments,
        }];
      })
    : [];

  return {
    assets: assets as Asset[], selectedMonth, inputMonths, forecastBaseMonth,
    values, plans, fundAssets, fundHoldings, budgetGroups, budgetPeriods,
  };
}

function AssetChart({
  ledger,
  months,
  forecastMonths,
  selectedAssetId,
  onSelectAsset,
  showAmounts,
}: {
  ledger: Ledger;
  months: string[];
  forecastMonths: string[];
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  showAmounts: boolean;
}) {
  const width = 760;
  const height = 286;
  const plot = { left: 70, right: 18, top: 24, bottom: 48 };
  const chartWidth = width - plot.left - plot.right;
  const chartHeight = height - plot.top - plot.bottom;
  const displayedAssets = selectedAssetId
    ? ledger.assets.filter((asset) => asset.id === selectedAssetId)
    : ledger.assets;
  const chartColorByAssetId = new Map(
    ledger.assets.map((asset, index) => [asset.id, COLORS[index % COLORS.length]]),
  );
  const chartColor = (asset: Asset) => chartColorByAssetId.get(asset.id) || COLORS[0];
  const displayMonths = [...months, ...forecastMonths];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const actualTotals = months.map((month) =>
    displayedAssets.reduce(
      (total, asset) => total + (ledger.values[month]?.[asset.id] || 0),
      0,
    ),
  );
  const latestMonth = months.at(-1) || ledger.selectedMonth;
  const forecastByAssetId = new Map<string, number[]>();
  ledger.assets.forEach((asset) => forecastByAssetId.set(asset.id, []));
  forecastMonths.forEach((month) => {
    const values = forecastValuesForMonth(ledger, month);
    ledger.assets.forEach((asset) => {
      forecastByAssetId.get(asset.id)?.push(values?.[asset.id] || 0);
    });
  });
  const forecastValues = displayedAssets.map((asset) => forecastByAssetId.get(asset.id) || []);
  const forecastTotals = forecastMonths.map((_, monthIndex) =>
    forecastValues.reduce((total, values) => total + values[monthIndex], 0),
  );
  const maximum = niceMaximum(Math.max(...actualTotals, ...forecastTotals, 0));
  const labelStep = Math.max(1, Math.ceil(displayMonths.length / 8));
  const xFor = (index: number) =>
    displayMonths.length === 1
      ? plot.left + chartWidth / 2
      : plot.left + (index / (displayMonths.length - 1)) * chartWidth;
  const yFor = (value: number) => plot.top + chartHeight - (value / maximum) * chartHeight;
  const actualCumulative = months.map(() => 0);
  const actualSeries = displayedAssets.map((asset) => {
    const points = months.map((month, index) => {
      const value = ledger.values[month]?.[asset.id] || 0;
      const lowerValue = actualCumulative[index];
      const upperValue = lowerValue + value;
      actualCumulative[index] = upperValue;
      return {
        month,
        value,
        x: xFor(index),
        y: yFor(upperValue),
        lowerY: yFor(lowerValue),
      };
    });
    const line = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
      .join(" ");
    const lowerBoundary = [...points]
      .reverse()
      .map((point) => `L${point.x} ${point.lowerY}`)
      .join(" ");
    const area = `${line} ${lowerBoundary} Z`;
    return { asset, points, line, area };
  });
  const forecastCumulative = Array.from({ length: forecastMonths.length + 1 }, () => 0);
  const forecastSeries = displayedAssets.map((asset, assetIndex) => {
    const values = [
      forecastValuesForMonth(ledger, latestMonth)?.[asset.id] || 0,
      ...forecastValues[assetIndex],
    ];
    const seriesMonths = [latestMonth, ...forecastMonths];
    const points = seriesMonths.map((month, index) => {
      const value = values[index];
      const lowerValue = forecastCumulative[index];
      const upperValue = lowerValue + value;
      forecastCumulative[index] = upperValue;
      return {
        month,
        value,
        x: xFor(months.length - 1 + index),
        y: yFor(upperValue),
        lowerY: yFor(lowerValue),
      };
    });
    const line = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
      .join(" ");
    const lowerBoundary = [...points]
      .reverse()
      .map((point) => `L${point.x} ${point.lowerY}`)
      .join(" ");
    const area = `${line} ${lowerBoundary} Z`;
    return { asset, points, line, area };
  });
  const selectLabel = (asset: Asset) =>
    selectedAssetId === asset.id
      ? "全項目を表示"
      : `${asset.name || "名称未設定"}だけを表示`;
  const handleKeySelect = (
    event: KeyboardEvent<SVGPathElement>,
    assetId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectAsset(assetId);
    }
  };
  const hoveredMonth = hoverIndex === null ? null : displayMonths[hoverIndex];
  const hoveredIsForecast = hoverIndex !== null && hoverIndex >= months.length;
  const tooltipValues = hoverIndex === null
    ? []
    : ledger.assets.map((asset) => ({
        asset,
        value: hoverIndex < months.length
          ? ledger.values[displayMonths[hoverIndex]]?.[asset.id] || 0
          : forecastByAssetId.get(asset.id)?.[hoverIndex - months.length] || 0,
      }));
  const tooltipTotal = tooltipValues.reduce((total, { value }) => total + value, 0);
  const hoveredX = hoverIndex === null ? 0 : xFor(hoverIndex);
  const tooltipRatio = hoveredX / width;
  const tooltipPlacement = tooltipRatio < 0.28
    ? "start"
    : tooltipRatio > 0.72
      ? "end"
      : "center";
  const tooltipPositionStyle = {
    ...(tooltipPlacement === "start"
      ? { left: "6px" }
      : tooltipPlacement === "end"
        ? { right: "6px" }
        : { left: `${tooltipRatio * 100}%` }),
  } as CSSProperties;

  return (
    <div className="chart-wrap" onPointerLeave={() => setHoverIndex(null)}>
      <svg
        className="asset-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${monthLabel(months[0])}から${monthLabel(forecastMonths.at(-1) || latestMonth)}までの積み上げ資産推移と予測`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const pointX = ((event.clientX - bounds.left) / bounds.width) * width;
          const index = displayMonths.length === 1
            ? 0
            : Math.round(((pointX - plot.left) / chartWidth) * (displayMonths.length - 1));
          setHoverIndex(Math.max(0, Math.min(displayMonths.length - 1, index)));
        }}
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = plot.top + chartHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={plot.left} x2={width - plot.right} y1={y} y2={y} className="grid-line" />
              <text x={plot.left - 12} y={y + 4} textAnchor="end" className="axis-text">
                {showAmounts ? formatAxis(maximum * ratio) : "—"}
              </text>
            </g>
          );
        })}

        {hoverIndex !== null && (
          <line
            className="hover-guide"
            x1={hoveredX}
            x2={hoveredX}
            y1={plot.top}
            y2={plot.top + chartHeight}
          />
        )}

        {actualSeries.map(({ asset, area }) => (
          <path
            key={`${asset.id}-area`}
            d={area}
            fill={chartColor(asset)}
            className="series-area"
            onPointerDown={() => onSelectAsset(asset.id)}
            role="button"
            tabIndex={0}
            aria-label={selectLabel(asset)}
            onKeyDown={(event) => handleKeySelect(event, asset.id)}
          />
        ))}

        {actualSeries.map(({ asset, line }) => (
          <g key={asset.id}>
            <path d={line} stroke={chartColor(asset)} className="series-line" />
          </g>
        ))}

        {forecastSeries.map(({ asset, area }) => (
          <path
            key={`${asset.id}-forecast-area`}
            d={area}
            fill={chartColor(asset)}
            className="forecast-area"
            onPointerDown={() => onSelectAsset(asset.id)}
            role="button"
            tabIndex={0}
            aria-label={selectLabel(asset)}
            onKeyDown={(event) => handleKeySelect(event, asset.id)}
          />
        ))}

        {forecastSeries.map(({ asset, line }) => (
          <g key={`${asset.id}-forecast`}>
            <path d={line} stroke={chartColor(asset)} className="forecast-line" />
          </g>
        ))}

        {displayMonths.map((month, index) =>
          index % labelStep === 0 && index !== displayMonths.length - 1 ? (
            <text key={month} x={xFor(index)} y={height - 15} textAnchor="middle" className="axis-text">
              {monthShortLabel(month)}
            </text>
          ) : null,
        )}
      </svg>
      {hoveredMonth && (
        <div
          className={`chart-tooltip is-${tooltipPlacement}`}
          role="status"
          style={tooltipPositionStyle}
        >
          <p>
            {monthLabel(hoveredMonth)}
            {hoveredIsForecast && <span>予測</span>}
          </p>
          <div className="tooltip-total">
            <span>資産合計</span>
            <strong>{displayedYen(Math.round(tooltipTotal), showAmounts)}円</strong>
          </div>
          <ul>
            {tooltipValues.map(({ asset, value }) => (
              <li key={asset.id}>
                <span className="tooltip-name">
                  <i style={{ background: chartColor(asset) }} aria-hidden="true" />
                  {asset.name || "名称未設定"}
                </span>
                <strong>{displayedYen(Math.round(value), showAmounts)}円</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { ledger, setLedger, ready, saved, cloudUser, syncStatus, syncError,
    signInForSync, signOutFromSync } = usePersonalLedger(createInitialLedger, restoreLedger);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("assets");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("S");
  const [planSortOrder, setPlanSortOrder] = useState<PlanSortOrder>("asc");
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [dropTargetAssetId, setDropTargetAssetId] = useState<string | null>(null);
  const [newGroupNames, setNewGroupNames] = useState<Record<BudgetCategory, string>>({
    budget: "",
    other: "",
  });
  const [showAmounts, setShowAmounts] = useState(true);
  const [fundQuotes, setFundQuotes] = useState<Record<string, FundQuote>>({});
  const [fundQuoteHistory, setFundQuoteHistory] = useState<FundQuoteHistory>({});
  const [fundAssetToAdd, setFundAssetToAdd] = useState("");
  const newestNameRef = useRef<HTMLInputElement>(null);
  const [focusNewest, setFocusNewest] = useState(false);
  const pricedLedger = useMemo(
    () => ledgerWithFundQuotes(ledger, fundQuotes, fundQuoteHistory),
    [ledger, fundQuotes, fundQuoteHistory],
  );
  useEffect(() => {
    let cancelled = false;
    const loadFundPrices = async () => {
      try {
        const response = await fetch("https://kensuke5704.github.io/finance-app/price-cache.json", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const cache = await response.json() as FundPriceCache;
        if (!cache.funds || cancelled) return;
        const quotes = Object.fromEntries(
          Object.entries(cache.funds).flatMap(([code, quote]) => {
            if (!quote || !Number.isFinite(quote.price) || !validFundDate(quote.asOfDate)) return [];
            return [[normalizeFundCode(code), quote]];
          }),
        ) as Record<string, FundQuote>;
        const history = Object.fromEntries(
          Object.entries(cache.history || {}).map(([code, byMonth]) => [
            normalizeFundCode(code),
            Object.fromEntries(
              Object.entries(byMonth || {}).flatMap(([month, quote]) => (
                validMonth(month) && quote && Number.isFinite(quote.price) && validFundDate(quote.asOfDate)
                  ? [[month, quote]]
                  : []
              )),
            ),
          ]),
        ) as FundQuoteHistory;
        setFundQuotes(quotes);
        setFundQuoteHistory(history);
      } catch {
        // 価格キャッシュを読み込めない場合も、手入力の資産記録はそのまま利用する。
      }
    };
    void loadFundPrices();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const savedVisibility = window.localStorage.getItem(AMOUNT_VISIBILITY_KEY);
    if (savedVisibility !== null) setShowAmounts(savedVisibility === "true");
  }, []);

  const toggleAmountVisibility = () => {
    setShowAmounts((current) => {
      const next = !current;
      window.localStorage.setItem(AMOUNT_VISIBILITY_KEY, String(next));
      return next;
    });
  };
  const changeTab = (
    tab: WorkspaceTab,
    event?: KeyboardEvent<HTMLButtonElement>,
  ) => {
    setActiveTab(tab);
    if (event) {
      const button = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
        `[data-tab="${tab}"]`,
      );
      button?.focus();
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: WorkspaceTab,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs: WorkspaceTab[] = ["assets", "plans", "settings"];
    const currentIndex = tabs.indexOf(tab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    changeTab(tabs[(currentIndex + direction + tabs.length) % tabs.length], event);
  };

  useEffect(() => {
    if (!focusNewest) return;
    newestNameRef.current?.focus();
    newestNameRef.current?.select();
    setFocusNewest(false);
  }, [focusNewest, ledger.assets.length]);

  const months = useMemo(() => {
    const sortedInputMonths = [...pricedLedger.inputMonths].sort();
    const firstMonth = sortedInputMonths[0] || pricedLedger.selectedMonth;
    const lastMonth = sortedInputMonths.at(-1) || pricedLedger.selectedMonth;
    return monthRange(firstMonth, lastMonth);
  }, [pricedLedger.inputMonths, pricedLedger.selectedMonth]);
  const forecastMonths = useMemo(() => {
    const latestMonth = pricedLedger.inputMonths.at(-1) || pricedLedger.selectedMonth;
    const plannedEnd = pricedLedger.budgetPeriods
      .map((period) => period.endMonth)
      .filter((month) => month > latestMonth)
      .sort()
      .at(-1);
    const endMonth = plannedEnd && plannedEnd > shiftMonth(latestMonth, 180)
      ? plannedEnd
      : shiftMonth(latestMonth, 180);
    return monthRange(shiftMonth(latestMonth, 1), endMonth);
  }, [pricedLedger.budgetPeriods, pricedLedger.inputMonths, pricedLedger.selectedMonth]);

  const visibleMonths = useMemo(() => {
    const rangeMonths = months.slice(-CHART_RANGE_MONTHS[chartRange]);
    if (chartRange !== "LL") return rangeMonths;
    // 15年表示は月次データを2か月に1点へ間引き、SVGの描画負荷を抑える。
    return rangeMonths.filter((_, index) => index % 2 === 0 || index === rangeMonths.length - 1);
  }, [chartRange, months]);
  const visibleForecastMonths = useMemo(() => {
    const rangeMonths = forecastMonths.slice(0, CHART_RANGE_MONTHS[chartRange]);
    if (chartRange !== "LL") return rangeMonths;
    return rangeMonths.filter((_, index) => index % 2 === 0 || index === rangeMonths.length - 1);
  }, [chartRange, forecastMonths]);
  const hasForecastWarning = useMemo(() => {
    const latestMonth = pricedLedger.inputMonths.at(-1) || pricedLedger.selectedMonth;
    return hasNegativeForecast(pricedLedger, latestMonth, forecastMonths);
  }, [forecastMonths, pricedLedger]);
  const orderedBudgetPeriods = (category: BudgetCategory) =>
    ledger.budgetPeriods
      .filter((period) => period.category === category)
      .sort((a, b) => {
        const groups = ledger.budgetGroups.filter((group) => group.category === category);
        const groupA = groups.findIndex((group) => group.id === a.groupId);
        const groupB = groups.findIndex((group) => group.id === b.groupId);
        const normalizedA = groupA < 0 ? Number.MAX_SAFE_INTEGER : groupA;
        const normalizedB = groupB < 0 ? Number.MAX_SAFE_INTEGER : groupB;
        if (normalizedA !== normalizedB) return normalizedA - normalizedB;
        return planSortOrder === "asc"
          ? a.startMonth.localeCompare(b.startMonth)
          : b.startMonth.localeCompare(a.startMonth);
      });
  const selectedValues = pricedLedger.values[pricedLedger.selectedMonth] || {};
  const selectedMonthForecastValues = useMemo(
    () => pricedLedger.inputMonths.includes(pricedLedger.selectedMonth)
      ? null
      : forecastValuesForMonth(pricedLedger, pricedLedger.selectedMonth),
    [pricedLedger],
  );
  const selectedMonthFundDates = Array.from(new Set(
    ledger.fundAssets.flatMap((assetId) => {
      const holding = ledger.fundHoldings[assetId];
      const quote = holding
        ? quoteForFundMonth(holding.code, ledger.selectedMonth, fundQuotes, fundQuoteHistory)
        : null;
      return quote ? [quote.asOfDate] : [];
    }),
  )).sort();
  const selectMonth = (month: string) => {
    if (!month || month < EARLIEST_MONTH) return;
    setLedger((current) => ({
      ...current,
      selectedMonth: month,
      values: current.values[month] ? current.values : { ...current.values, [month]: {} },
    }));
  };

  const setAmount = (assetId: string, rawValue: string) => {
    const digits = rawValue.replace(/[^0-9]/g, "");
    setLedger((current) => {
      const monthValues = { ...(current.values[current.selectedMonth] || {}) };

      if (digits === "") {
        delete monthValues[assetId];
      } else {
        monthValues[assetId] = Math.max(0, Number(digits) || 0);
      }

      const hasAnyValue = Object.keys(monthValues).length > 0;
      return {
        ...current,
        inputMonths: hasAnyValue
          ? current.inputMonths.includes(current.selectedMonth)
            ? current.inputMonths
            : [...current.inputMonths, current.selectedMonth].sort()
          : current.inputMonths.filter((month) => month !== current.selectedMonth),
        values: {
          ...current.values,
          [current.selectedMonth]: monthValues,
        },
      };
    });
  };

  const renameAsset = (assetId: string, name: string) => {
    setLedger((current) => ({
      ...current,
      assets: current.assets.map((asset) => (asset.id === assetId ? { ...asset, name } : asset)),
    }));
  };

  const setPlan = (
    assetId: string,
    field: keyof AssetPlan,
    rawValue: string,
  ) => {
    const parsed = rawValue === "" ? 0 : Number(rawValue);
    const value = Number.isFinite(parsed)
      ? field === "monthlyBudget"
        ? Math.max(0, parsed)
        : Math.max(-100, parsed)
      : 0;
    setLedger((current) => ({
      ...current,
      plans: {
        ...current.plans,
        [assetId]: {
          ...(current.plans[assetId] || EMPTY_ASSET_PLAN),
          [field]: value,
        },
      },
    }));
  };

  const setFundHolding = (
    assetId: string,
    field: keyof FundHolding,
    rawValue: string,
  ) => {
    setLedger((current) => {
      const currentHolding = current.fundHoldings[assetId] || { code: "", units: 0 };
      const nextHolding = field === "code"
        ? { ...currentHolding, code: normalizeFundCode(rawValue) }
        : { ...currentHolding, units: Math.max(0, Number(rawValue) || 0) };
      const fundHoldings = { ...current.fundHoldings };
      if (!nextHolding.code && nextHolding.units === 0) {
        delete fundHoldings[assetId];
      } else {
        fundHoldings[assetId] = nextHolding;
      }
      return {
        ...current,
        fundAssets: current.fundAssets.includes(assetId)
          ? current.fundAssets
          : [...current.fundAssets, assetId],
        fundHoldings,
      };
    });
  };

  const addFundAsset = (assetId: string) => {
    if (!assetId || assetId === "cash") return;
    setLedger((current) => current.fundAssets.includes(assetId)
      ? current
      : { ...current, fundAssets: [...current.fundAssets, assetId] });
  };

  const removeFundAsset = (assetId: string) => {
    const asset = ledger.assets.find((item) => item.id === assetId);
    if (!asset) return;
    if (!window.confirm(`「${asset.name || "名称未設定"}」を投資信託から外しますか？`)) return;
    setLedger((current) => {
      const fundHoldings = { ...current.fundHoldings };
      delete fundHoldings[assetId];
      return {
        ...current,
        fundAssets: current.fundAssets.filter((id) => id !== assetId),
        fundHoldings,
      };
    });
  };

  const updateForecastBaseMonth = () => {
    const latestMonth = ledger.inputMonths.at(-1);
    if (!latestMonth) return;
    setLedger((current) => ({ ...current, forecastBaseMonth: latestMonth }));
  };

  const addBudgetPeriod = (category: BudgetCategory, groupId?: string) => {
    setLedger((current) => {
      const latestMonth = current.inputMonths.at(-1) || current.selectedMonth;
      const latestPlannedEnd = current.budgetPeriods
        .filter((period) => period.category === category)
        .map((period) => period.endMonth)
        .sort()
        .at(-1);
      const startMonth = shiftMonth(latestPlannedEnd || latestMonth, 1);
      return {
        ...current,
        budgetPeriods: [
          ...current.budgetPeriods,
          {
            id: `period-${category}-${Date.now()}`,
            category,
            groupId,
            mode: "range",
            intervalMonths: 1,
            memo: "",
            startMonth,
            endMonth: shiftMonth(startMonth, 11),
            income: 0,
            expense: 0,
            investments: zeroInvestments(current.assets),
          },
        ],
      };
    });
  };

  const updateBudgetPeriod = (
    category: BudgetCategory,
    periodId: string,
    change: Partial<Omit<BudgetPeriod, "id" | "category" | "investments">>,
  ) => {
    setLedger((current) => ({
      ...current,
      budgetPeriods: current.budgetPeriods.map((period) => {
        if (period.category !== category || period.id !== periodId) return period;
        const next = { ...period, ...change };
        if (next.mode === "single") next.endMonth = next.startMonth;
        next.intervalMonths = Math.max(1, Math.min(120, Math.floor(next.intervalMonths || 1)));
        if (next.startMonth > next.endMonth) {
          if (change.startMonth) next.endMonth = next.startMonth;
          if (change.endMonth) next.startMonth = next.endMonth;
        }
        return next;
      }),
    }));
  };

  const setBudgetAmount = (
    category: BudgetCategory,
    periodId: string,
    field: "income" | "expense" | "investment",
    rawValue: string,
    assetId?: string,
  ) => {
    const normalized = rawValue.replace(/[^0-9-]/g, "");
    const digits = normalized.replace(/-/g, "");
    const parsed = digits === "" ? 0 : Number(`${normalized.includes("-") ? "-" : ""}${digits}`);
    const value = Number.isFinite(parsed) ? parsed : 0;

    setLedger((current) => ({
      ...current,
      budgetPeriods: current.budgetPeriods.map((period) => {
        if (period.category !== category || period.id !== periodId) return period;
        if (field === "investment" && assetId) {
          return { ...period, investments: { ...period.investments, [assetId]: value } };
        }
        return { ...period, [field]: value };
      }),
    }));
  };

  const removeBudgetPeriod = (category: BudgetCategory, periodId: string) => {
    const period = ledger.budgetPeriods.find(
      (item) => item.category === category && item.id === periodId,
    );
    if (!period) return;
    const periodLabel = period.mode === "single"
      ? monthLabel(period.startMonth)
      : `${monthLabel(period.startMonth)}〜${monthLabel(period.endMonth)}`;
    if (!window.confirm(`${periodLabel}の計画を削除しますか？\nこの操作は元に戻せません。`)) return;

    setLedger((current) => ({
      ...current,
      budgetPeriods: current.budgetPeriods.filter(
        (period) => period.category !== category || period.id !== periodId,
      ),
    }));
  };

  const duplicateBudgetPeriod = (category: BudgetCategory, periodId: string) => {
    setLedger((current) => {
      const source = current.budgetPeriods.find(
        (period) => period.category === category && period.id === periodId,
      );
      if (!source) return current;
      return {
        ...current,
        budgetPeriods: [
          ...current.budgetPeriods,
          {
            ...source,
            id: `period-${category}-${Date.now()}`,
            investments: { ...source.investments },
          },
        ],
      };
    });
  };

  const addBudgetGroup = (category: BudgetCategory) => {
    const name = newGroupNames[category].trim();
    if (!name) return;
    setLedger((current) => ({
      ...current,
      budgetGroups: [
        ...current.budgetGroups,
        { id: `group-${category}-${Date.now()}`, name, category },
      ],
    }));
    setNewGroupNames((current) => ({ ...current, [category]: "" }));
  };

  const renameBudgetGroup = (groupId: string, name: string) => {
    setLedger((current) => ({
      ...current,
      budgetGroups: current.budgetGroups.map((group) => (
        group.id === groupId ? { ...group, name: name.trim() || "名称未設定" } : group
      )),
    }));
  };

  const removeBudgetGroup = (groupId: string) => {
    const group = ledger.budgetGroups.find((item) => item.id === groupId);
    if (!group) return;
    const periodCount = ledger.budgetPeriods.filter(
      (period) => period.category === group.category && period.groupId === groupId,
    ).length;
    const message = periodCount > 0
      ? `「${group.name}」を削除しますか？\n${periodCount}件の予算は未分類になります。`
      : `「${group.name}」を削除しますか？`;
    if (!window.confirm(`${message}\nこの操作は元に戻せません。`)) return;
    setLedger((current) => ({
      ...current,
      budgetGroups: current.budgetGroups.filter((group) => group.id !== groupId),
      budgetPeriods: current.budgetPeriods.map((period) => (
        period.groupId === groupId ? { ...period, groupId: undefined } : period
      )),
    }));
  };

  const addAsset = () => {
    setLedger((current) => {
      const index = current.assets.length;
      const id = `asset-${Date.now()}`;
      return {
        ...current,
        assets: [
          ...current.assets,
          {
            id,
            name: `商品${index}`,
            color: COLORS[index % COLORS.length],
          },
        ],
        plans: {
          ...current.plans,
          [id]: EMPTY_ASSET_PLAN,
        },
      };
    });
    setFocusNewest(true);
  };

  const removeAsset = (assetId: string) => {
    if (ledger.assets.length === 1) return;
    const asset = ledger.assets.find((item) => item.id === assetId);
    if (!asset) return;
    if (!window.confirm(`「${asset.name || "名称未設定"}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    if (selectedAssetId === assetId) setSelectedAssetId(null);
    setLedger((current) => {
      const plans = { ...current.plans };
      const fundHoldings = { ...current.fundHoldings };
      delete plans[assetId];
      delete fundHoldings[assetId];
      return {
        ...current,
        assets: current.assets.filter((asset) => asset.id !== assetId),
        plans,
        fundAssets: current.fundAssets.filter((id) => id !== assetId),
        fundHoldings,
      };
    });
  };

  const reorderAssets = (sourceId: string, destinationId: string) => {
    if (sourceId === destinationId) return;
    setLedger((current) => {
      const source = current.assets.find((asset) => asset.id === sourceId);
      if (!source) return current;
      const remaining = current.assets.filter((asset) => asset.id !== sourceId);
      const destinationIndex = remaining.findIndex((asset) => asset.id === destinationId);
      if (destinationIndex < 0) return current;
      return {
        ...current,
        assets: [
          ...remaining.slice(0, destinationIndex),
          source,
          ...remaining.slice(destinationIndex),
        ],
      };
    });
  };

  return (
    <div className="app-shell ui-refinement">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Finance">
          <span aria-hidden="true">¥</span>
        </div>
        <nav className="workspace-tabs" role="tablist" aria-label="画面切り替え">
          <button
            type="button"
            role="tab"
            data-tab="assets"
            aria-selected={activeTab === "assets"}
            tabIndex={activeTab === "assets" ? 0 : -1}
            className={activeTab === "assets" ? "is-active" : ""}
            onClick={() => changeTab("assets")}
            onKeyDown={(event) => handleTabKeyDown(event, "assets")}
            aria-label="資産"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 18V6m0 12h16M7 14l4-4 3 2 5-6" />
            </svg>
            <span className="tab-label">
              <span className="tab-text">資産</span>
              {hasForecastWarning && (
                <span className="tab-alert" aria-label="予測に警告があります">!</span>
              )}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            data-tab="plans"
            aria-selected={activeTab === "plans"}
            tabIndex={activeTab === "plans" ? 0 : -1}
            className={activeTab === "plans" ? "is-active" : ""}
            onClick={() => changeTab("plans")}
            onKeyDown={(event) => handleTabKeyDown(event, "plans")}
            aria-label="計画"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 18V6m0 12h16M7 14l4-4 3 2 5-6" />
            </svg>
            <span className="tab-text">計画</span>
          </button>
          <button
            type="button"
            role="tab"
            data-tab="settings"
            aria-selected={activeTab === "settings"}
            tabIndex={activeTab === "settings" ? 0 : -1}
            className={activeTab === "settings" ? "is-active" : ""}
            onClick={() => changeTab("settings")}
            onKeyDown={(event) => handleTabKeyDown(event, "settings")}
            aria-label="設定"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.4-6.4-2.1 2.1M7.7 16.3l-2.1 2.1m12.8 0-2.1-2.1M7.7 7.7 5.6 5.6" />
            </svg>
            <span className="tab-text">設定</span>
          </button>
        </nav>
        <div className="sidebar-status">
          <span className={saved ? "status-dot is-saved" : "status-dot"} aria-hidden="true" />
          <span aria-live="polite">{saved ? "保存済み" : "保存中"}</span>
        </div>
      </aside>

      <main className="page-shell">
        <header className="topbar">
          <div className="topbar-actions">
            <button
              type="button"
              className="amount-visibility-toggle"
              aria-pressed={!showAmounts}
              aria-label={showAmounts ? "金額を非表示にする" : "金額を表示する"}
              title={showAmounts ? "金額を非表示" : "金額を表示"}
              onClick={toggleAmountVisibility}
            >
              {showAmounts ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12 18.1 17.5 12 17.5 2.5 12 2.5 12Z" />
                  <circle cx="12" cy="12" r="2.7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m3 3 18 18M10.6 6.7A10.2 10.2 0 0 1 12 6.5c6.1 0 9.5 5.5 9.5 5.5a17.7 17.7 0 0 1-3.3 3.8M6.2 6.2A17.4 17.4 0 0 0 2.5 12s3.4 5.5 9.5 5.5c1.2 0 2.2-.2 3.1-.5M9.8 9.8a3.1 3.1 0 0 0 4.4 4.4" />
                </svg>
              )}
            </button>
            {cloudUser ? (
              <div className="sync-control is-synced" title={cloudUser.email || ""}>
                <span className={syncStatus === "synced" ? "status-dot is-saved" : "status-dot"} aria-hidden="true" />
                <span aria-live="polite">{syncStatus === "saving" ? "同期中" : syncStatus === "synced" ? "同期済み" : syncStatus === "error" ? "同期エラー" : "接続中…"}</span>
                <button type="button" onClick={() => void signOutFromSync()}>ログアウト</button>
              </div>
            ) : (
              <button type="button" className="sync-control" onClick={() => void signInForSync()}>
                {syncStatus === "connecting" ? "接続中…" : "Googleで同期"}
              </button>
            )}
            <span className="save-badge">
              <span className={saved ? "status-dot is-saved" : "status-dot"} aria-hidden="true" />
              {saved ? "保存済み" : "保存中"}
            </span>
          </div>
        </header>
        {syncError && <p className="sync-error" role="alert">{syncError}</p>}

        <section className="ledger" aria-label="Finance" aria-busy={!ready}>
          {!ready ? <p className="sync-loading" role="status">データを読み込んでいます…</p> : <>
          {activeTab === "assets" ? (
          <>
            <div className="assets-layout">
              <section className="chart-panel" aria-labelledby="chart-title">
              <div className="section-heading">
                <div>
                  <div className="chart-title-row">
                    <h2 id="chart-title">資産の推移</h2>
                    {hasForecastWarning && (
                      <span className="forecast-warning" role="status">
                        予測上、残高が不足する月があります
                      </span>
                    )}
                  </div>
                </div>
                <div className="range-switch" role="group" aria-label="グラフの表示期間">
                  {([
                    ["S", "1年"],
                    ["L", "5年"],
                    ["LL", "15年"],
                  ] as const).map(([range, label]) => (
                    <button
                      aria-label={`${label}表示`}
                      aria-pressed={chartRange === range}
                      className={chartRange === range ? "is-active" : ""}
                      key={range}
                      onClick={() => setChartRange(range)}
                      title={`${label}表示`}
                      type="button"
                    >
                      <strong>{range}</strong>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <ul className="legend" aria-label="資産項目の凡例">
                {ledger.assets.map((asset, index) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      className={selectedAssetId === asset.id ? "is-selected" : ""}
                      aria-pressed={selectedAssetId === asset.id}
                      onClick={() =>
                        setSelectedAssetId((current) => (current === asset.id ? null : asset.id))
                      }
                    >
                      <span style={{ background: COLORS[index % COLORS.length] }} />
                      {asset.name || "名称未設定"}
                    </button>
                  </li>
                ))}
                <li className="forecast-key"><span />予測</li>
              </ul>
              <AssetChart
                ledger={pricedLedger}
                months={visibleMonths}
                forecastMonths={visibleForecastMonths}
                selectedAssetId={selectedAssetId}
                showAmounts={showAmounts}
                onSelectAsset={(assetId) =>
                  setSelectedAssetId((current) => (current === assetId ? null : assetId))
                }
              />
              </section>

              <section className="entry-panel" aria-labelledby="entry-title">
              <div className="entry-heading">
                <div>
                  <div className="entry-title-row">
                    <h2 id="entry-title">{monthLabel(ledger.selectedMonth)}の資産</h2>
                    {selectedMonthFundDates.length > 0 && (
                      <span className="entry-fund-date">
                        基準日 {selectedMonthFundDates.map((date) => date.replaceAll("-", "/")).join("・")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="asset-toolbar">
                  <div className="month-picker" aria-label="入力する月を選択">
                    <button
                      type="button"
                      onClick={() => selectMonth(shiftMonth(ledger.selectedMonth, -1))}
                      disabled={ledger.selectedMonth === EARLIEST_MONTH}
                      aria-label="前の月"
                    >←</button>
                    <input
                      type="month"
                      min={EARLIEST_MONTH}
                      value={ledger.selectedMonth}
                      onChange={(event) => selectMonth(event.target.value)}
                      aria-label="入力月"
                    />
                    <button
                      type="button"
                      onClick={() => selectMonth(shiftMonth(ledger.selectedMonth, 1))}
                      aria-label="次の月"
                    >→</button>
                  </div>
                </div>
              </div>

              <div className="asset-grid">
                {ledger.assets.map((asset, index) => {
                  const fundAutomaticValue = fundValueForMonth(
                    ledger,
                    fundQuotes,
                    fundQuoteHistory,
                    ledger.selectedMonth,
                    asset.id,
                  );
                  const automaticValue = fundAutomaticValue;
                  const isAutomaticallyUpdated = automaticValue !== null;
                  return (
                  <article
                    aria-label={`${asset.name || `資産項目${index + 1}`}。ドラッグして並び替え`}
                    className={`asset-field${isAutomaticallyUpdated ? " is-automatic" : ""}${draggedAssetId === asset.id ? " is-dragging" : ""}${dropTargetAssetId === asset.id ? " is-drop-target" : ""}`}
                    key={asset.id}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggedAssetId && draggedAssetId !== asset.id) {
                        setDropTargetAssetId(asset.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedAssetId) reorderAssets(draggedAssetId, asset.id);
                      setDraggedAssetId(null);
                      setDropTargetAssetId(null);
                    }}
                  >
                    <div className="asset-name-row">
                      <span
                        className="drag-handle"
                        draggable
                        aria-label={`${asset.name || `資産項目${index + 1}`}をドラッグして並び替え`}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          setDraggedAssetId(asset.id);
                        }}
                        onDragEnd={() => {
                          setDraggedAssetId(null);
                          setDropTargetAssetId(null);
                        }}
                      >⠿</span>
                      <span className="color-dot" style={{ background: COLORS[index % COLORS.length] }} aria-hidden="true" />
                      <input
                        ref={index === ledger.assets.length - 1 ? newestNameRef : undefined}
                        className={`asset-name${isAutomaticallyUpdated ? " is-automatic" : ""}`}
                        value={asset.name}
                        onChange={(event) => renameAsset(asset.id, event.target.value)}
                        aria-label={`資産項目${index + 1}の名称`}
                      />
                      <button
                        type="button"
                        className="remove-button"
                        onClick={() => removeAsset(asset.id)}
                        disabled={ledger.assets.length === 1}
                        aria-label={`${asset.name || `資産項目${index + 1}`}を削除`}
                        title="項目を削除"
                      >×</button>
                    </div>
                    <label>
                      <span className="sr-only">{asset.name || `資産項目${index + 1}`}の金額</span>
                      <CurrencyInput
                        className="amount-input"
                        value={automaticValue ?? selectedValues[asset.id] ?? 0}
                        hasValue={automaticValue !== null || asset.id in selectedValues}
                        showAmounts={showAmounts}
                        readOnly={!showAmounts || automaticValue !== null}
                        placeholder={selectedMonthForecastValues
                          ? displayedYen(Math.round(selectedMonthForecastValues[asset.id] || 0), showAmounts)
                          : "0"}
                        onValueChange={(value) => setAmount(asset.id, value)}
                        ariaLabel={`${asset.name || `資産項目${index + 1}`}の金額`}
                      />
                      <span className="yen">円</span>
                    </label>
                  </article>
                  );
                })}
              </div>

              <div className="add-row">
                <button type="button" className="add-asset" onClick={addAsset} aria-label="資産項目を追加">
                  ＋
                </button>
              </div>
              </section>
            </div>
          </>
          ) : activeTab === "plans" ? (
            <>
              <div className="planning-sections">
              {(["budget", "other"] as BudgetCategory[]).map((category) => {
                const periods = orderedBudgetPeriods(category);
                const title = category === "budget" ? "予算" : "その他";
                return (
              <section className="planning-panel" aria-labelledby={`planning-${category}-title`} key={category}>
                <div className="settings-heading">
                  <div>
                    <h2 id={`planning-${category}-title`}>{title}</h2>
                  </div>
                  <div className="planning-actions">
                  {periods.length > 0 && (
                    <button type="button" className="add-period" onClick={() => addBudgetPeriod(category)}>
                      期間を追加
                    </button>
                  )}
                  {periods.length > 1 && (
                    <div className="plan-sort" role="group" aria-label="計画の並び順">
                      <button
                        type="button"
                        className={planSortOrder === "asc" ? "is-active" : ""}
                        aria-pressed={planSortOrder === "asc"}
                        onClick={() => setPlanSortOrder("asc")}
                      >
                        開始月：昇順
                      </button>
                      <button
                        type="button"
                        className={planSortOrder === "desc" ? "is-active" : ""}
                        aria-pressed={planSortOrder === "desc"}
                        onClick={() => setPlanSortOrder("desc")}
                      >
                        降順
                      </button>
                    </div>
                  )}
                  </div>
                </div>
                <div className="other-group-manager" aria-label={`${title}のグループ`}>
                    <div className="other-group-create">
                      <input
                        type="text"
                        value={newGroupNames[category]}
                        placeholder="グループ名"
                        onChange={(event) => setNewGroupNames((current) => ({
                          ...current,
                          [category]: event.target.value,
                        }))}
                        aria-label={`新しい${title}グループ名`}
                      />
                      <button type="button" onClick={() => addBudgetGroup(category)} disabled={!newGroupNames[category].trim()}>
                        グループを追加
                      </button>
                    </div>
                    {ledger.budgetGroups.some((group) => group.category === category) && (
                      <div className="other-group-list">
                        {ledger.budgetGroups.filter((group) => group.category === category).map((group) => (
                          <div className="other-group-item" key={group.id}>
                            <input
                              type="text"
                              value={group.name}
                              onChange={(event) => renameBudgetGroup(group.id, event.target.value)}
                              aria-label={`${group.name}のグループ名`}
                            />
                            <span>{ledger.budgetPeriods.filter((period) => period.category === category && period.groupId === group.id).length}件</span>
                            <button type="button" onClick={() => addBudgetPeriod(category, group.id)}>
                              追加
                            </button>
                            <button
                              type="button"
                              className="remove-group"
                              onClick={() => removeBudgetGroup(group.id)}
                            >
                              削除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                {periods.length === 0 ? (
                  <div className="empty-plan">
                    <p>設定済みの期間はありません。</p>
                    <button type="button" onClick={() => addBudgetPeriod(category)}>最初の期間を追加</button>
                  </div>
                ) : (
                  <div className="budget-periods">
                    {periods.map((period, index) => {
                      const investmentTotal = ledger.assets
                        .filter((asset) => asset.id !== "cash")
                        .reduce((total, asset) => total + (period.investments[asset.id] || 0), 0);
                      const group = ledger.budgetGroups.find((item) => item.id === period.groupId);
                      const isGroupStart = category === "other" && (
                        index === 0 || periods[index - 1].groupId !== period.groupId
                      );
                      return (
                        <div className="budget-period-group" key={period.id}>
                          {isGroupStart && (
                            <p className="budget-group-heading">
                              {group?.name || "未分類"}
                            </p>
                          )}
                        <details className="budget-period">
                          <summary>
                            <span>
                              {period.mode === "single"
                                ? monthLabel(period.startMonth)
                                : period.mode === "recurring"
                                  ? `${monthLabel(period.startMonth)} 〜 ${monthLabel(period.endMonth)} / ${period.intervalMonths}ヶ月ごと`
                                  : `${monthLabel(period.startMonth)} 〜 ${monthLabel(period.endMonth)}`}
                            </span>
                            <span className="period-summary-memo">
                              {period.memo || "メモなし"}
                            </span>
                          </summary>
                          <div className="period-body">
                            <fieldset className="period-mode">
                              <legend>計画の期間</legend>
                              <label>
                                <input
                                  type="radio"
                                  name={`${period.id}-mode`}
                                  checked={period.mode === "single"}
                                  onChange={() => updateBudgetPeriod(category, period.id, { mode: "single" })}
                                />
                                単月
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name={`${period.id}-mode`}
                                  checked={period.mode === "range"}
                                  onChange={() => updateBudgetPeriod(category, period.id, { mode: "range" })}
                                />
                                複数月
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name={`${period.id}-mode`}
                                  checked={period.mode === "recurring"}
                                  onChange={() => updateBudgetPeriod(category, period.id, { mode: "recurring" })}
                                />
                                定期
                              </label>
                            </fieldset>
                            <div className="period-header">
                            <div className="period-range">
                              <label>
                                <span className="sr-only">開始月</span>
                                <input
                                  type="month"
                                  min={EARLIEST_MONTH}
                                  value={period.startMonth}
                                  onChange={(event) => updateBudgetPeriod(category, period.id, { startMonth: event.target.value })}
                                />
                              </label>
                              {period.mode !== "single" && (
                                <>
                                  <span aria-hidden="true">〜</span>
                                  <label>
                                    <span className="sr-only">終了月</span>
                                    <input
                                      type="month"
                                      min={period.startMonth}
                                      value={period.endMonth}
                                      onChange={(event) => updateBudgetPeriod(category, period.id, { endMonth: event.target.value })}
                                    />
                                  </label>
                                </>
                              )}
                            </div>
                            <div className="period-actions">
                              <button
                                type="button"
                                className="duplicate-period"
                                onClick={() => duplicateBudgetPeriod(category, period.id)}
                                aria-label={`${monthLabel(period.startMonth)}から${monthLabel(period.endMonth)}の計画を複製`}
                              >
                                複製
                              </button>
                              <button
                                type="button"
                                className="remove-period"
                                onClick={() => removeBudgetPeriod(category, period.id)}
                                aria-label={`${monthLabel(period.startMonth)}から${monthLabel(period.endMonth)}の計画を削除`}
                              >
                                削除
                              </button>
                            </div>
                            </div>
                            {period.mode === "recurring" && (
                              <label className="period-interval">
                                <span>繰り返し</span>
                                <span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="120"
                                    inputMode="numeric"
                                    value={period.intervalMonths}
                                    onChange={(event) => updateBudgetPeriod(category, period.id, {
                                      intervalMonths: Number(event.target.value) || 1,
                                    })}
                                    aria-label={`${monthLabel(period.startMonth)}からの繰り返し間隔`}
                                  />
                                  <em>ヶ月ごと</em>
                                </span>
                              </label>
                            )}
                            <div className="period-budget-grid">
                            <label className="period-budget income">
                              <span>収入</span>
                              <span className="plan-input-wrap">
                                <CurrencyInput
                                  value={period.income}
                                  showAmounts={showAmounts}
                                  readOnly={!showAmounts}
                                  allowNegative
                                  onValueChange={(value) => setBudgetAmount(category, period.id, "income", value)}
                                  ariaLabel={`${monthLabel(period.startMonth)}からの収入予算`}
                                />
                                <span>円</span>
                              </span>
                            </label>
                            <label className="period-budget expense">
                              <span>支出</span>
                              <span className="plan-input-wrap">
                                <CurrencyInput
                                  value={period.expense}
                                  showAmounts={showAmounts}
                                  readOnly={!showAmounts}
                                  allowNegative
                                  onValueChange={(value) => setBudgetAmount(category, period.id, "expense", value)}
                                  ariaLabel={`${monthLabel(period.startMonth)}からの支出予算`}
                                />
                                <span>円</span>
                              </span>
                            </label>
                            {ledger.assets.filter((asset) => asset.id !== "cash").map((asset, index) => (
                              <label className="period-budget" key={asset.id}>
                                <span className="budget-label">
                                  <i style={{ background: COLORS[(index + 1) % COLORS.length] }} aria-hidden="true" />
                                  {asset.name || "名称未設定"}
                                </span>
                                <span className="plan-input-wrap">
                                  <CurrencyInput
                                    value={period.investments[asset.id] || 0}
                                    showAmounts={showAmounts}
                                    readOnly={!showAmounts}
                                    allowNegative
                                    onValueChange={(value) => setBudgetAmount(category, period.id, "investment", value, asset.id)}
                                    ariaLabel={`${asset.name || "名称未設定"}への投資予算`}
                                  />
                                  <span>円</span>
                                </span>
                              </label>
                            ))}
                            </div>
                            <p className="cash-flow-preview">
                              <span>現金への毎月の反映額</span>
                              <strong>{displayedYen(period.income - period.expense - investmentTotal, showAmounts)}円</strong>
                            </p>
                            <label className="period-memo">
                              <span>メモ</span>
                              <input
                                type="text"
                                value={period.memo}
                                placeholder="例：夏季の旅行費用を含む"
                                onChange={(event) => updateBudgetPeriod(category, period.id, { memo: event.target.value })}
                                aria-label={`${monthLabel(period.startMonth)}からの計画メモ`}
                              />
                            </label>
                            <label className="period-group-select">
                              <span>グループ</span>
                              <select
                                value={period.groupId || ""}
                                onChange={(event) => updateBudgetPeriod(category, period.id, {
                                  groupId: event.target.value || undefined,
                                })}
                                aria-label={`${monthLabel(period.startMonth)}からの${title}グループ`}
                              >
                                <option value="">未分類</option>
                                {ledger.budgetGroups.filter((group) => group.category === category).map((group) => (
                                  <option key={group.id} value={group.id}>{group.name}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </details>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
                );
              })}
              </div>
            </>
          ) : activeTab === "settings" ? (
            <>
              <section className="settings-panel fund-holdings-panel" aria-labelledby="fund-holdings-title">
                <div className="settings-heading">
                  <div>
                    <h2 id="fund-holdings-title">投資信託</h2>
                  </div>
                </div>
                <div className="fund-holding-list">
                  {ledger.fundAssets.map((assetId) => {
                    const asset = ledger.assets.find((item) => item.id === assetId);
                    if (!asset || asset.id === "cash") return null;
                    const index = ledger.assets.findIndex((item) => item.id === asset.id);
                    const holding = ledger.fundHoldings[asset.id] || { code: "", units: 0 };
                    const quote = quoteForFund(holding.code, fundQuotes);
                    return (
                      <article className="fund-holding-row" key={asset.id}>
                        <div className="fund-holding-heading">
                          <div className="plan-asset">
                            <span
                              className="color-dot"
                              style={{ background: COLORS[index % COLORS.length] }}
                              aria-hidden="true"
                            />
                            <strong>{asset.name || "名称未設定"}</strong>
                          </div>
                          <button
                            type="button"
                            className="remove-fund-asset"
                            onClick={() => removeFundAsset(asset.id)}
                          >
                            外す
                          </button>
                        </div>
                        <label>
                          <span>銘柄コード</span>
                          <input
                            className="fund-code-input"
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={holding.code}
                            onChange={(event) => setFundHolding(asset.id, "code", event.target.value)}
                            aria-label={`${asset.name || "名称未設定"}の銘柄コード`}
                          />
                        </label>
                        <label>
                          <span>保有数</span>
                          <span className="plan-input-wrap">
                            <CurrencyInput
                              value={holding.units}
                              hasValue={holding.units > 0}
                              showAmounts={showAmounts}
                              onValueChange={(value) => setFundHolding(asset.id, "units", value)}
                              ariaLabel={`${asset.name || "名称未設定"}の保有数`}
                            />
                            <span>口</span>
                          </span>
                        </label>
                        <div className="fund-quote" aria-live="polite">
                          <span>基準価額</span>
                          <strong>{quote ? `${displayedYen(quote.price, showAmounts)}円` : "—"}</strong>
                          <small>{quote ? quote.asOfDate.replaceAll("-", "/") : "未取得"}</small>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {(() => {
                  const availableAssets = ledger.assets.filter(
                    (asset) => asset.id !== "cash" && !ledger.fundAssets.includes(asset.id),
                  );
                  return availableAssets.length > 0 ? (
                    <div className="fund-asset-add">
                      <select
                        value={fundAssetToAdd}
                        onChange={(event) => setFundAssetToAdd(event.target.value)}
                        aria-label="投資信託に追加する項目"
                      >
                        <option value="">項目を選択</option>
                        {availableAssets.map((asset) => (
                          <option value={asset.id} key={asset.id}>{asset.name || "名称未設定"}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!fundAssetToAdd}
                        onClick={() => {
                          addFundAsset(fundAssetToAdd);
                          setFundAssetToAdd("");
                        }}
                      >
                        追加
                      </button>
                    </div>
                  ) : null;
                })()}
              </section>
              <section className="settings-panel" aria-labelledby="settings-title">
                <div className="settings-heading">
                  <div>
                    <h2 id="settings-title">年利</h2>
                  </div>
                </div>
                <div className="forecast-base-control">
                  <div>
                    <span>予測の基準月</span>
                    <strong>{monthLabel(ledger.forecastBaseMonth)}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={updateForecastBaseMonth}
                    disabled={ledger.inputMonths.length === 0}
                  >
                    最新月を基準にする
                  </button>
                </div>
                <div className="plan-list">
                  {ledger.assets.map((asset, index) => {
                    const plan = ledger.plans[asset.id] || EMPTY_ASSET_PLAN;
                    return (
                      <article className="plan-row" key={asset.id}>
                        <div className="plan-asset">
                          <span
                            className="color-dot"
                            style={{ background: COLORS[index % COLORS.length] }}
                            aria-hidden="true"
                          />
                          <strong>{asset.name || "名称未設定"}</strong>
                        </div>
                        <label>
                          <span>年利</span>
                          <span className="plan-input-wrap rate">
                            <input
                              type="number"
                              min="-100"
                              step="0.1"
                              inputMode="decimal"
                              value={plan.annualRate || ""}
                              placeholder="0"
                              onChange={(event) => setPlan(asset.id, "annualRate", event.target.value)}
                              aria-label={`${asset.name || "名称未設定"}の年利`}
                            />
                            <span>%</span>
                          </span>
                        </label>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}
          </>}
        </section>
      </main>
    </div>
  );
}
