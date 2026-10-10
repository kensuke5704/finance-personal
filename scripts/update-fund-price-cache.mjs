import { readFile, writeFile } from "node:fs/promises";

const targets = JSON.parse(await readFile("public/price-targets.json", "utf8"));
const cachePath = "public/price-cache.json";
let existingCache = { funds: {}, history: {} };
try {
  existingCache = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  // 初回実行時は空のキャッシュから作成する。
}

const OFFICIAL_FUND_PAGES = {
  "03313188": {
    url: "https://fs.bk.mufg.jp/webasp/mufg/fund/detail/m00353320.html",
    parser: parseMufgFundPage,
    source: "mufg-public",
  },
  "0931123C": {
    url: "https://www.sbiokasan-am.co.jp/fund/553175/",
    parser: parseSbiOkasanFundPage,
    source: "sbiokasan-public",
  },
};

function normalizeCode(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function uniqueCodes(values) {
  return [...new Set((values ?? []).map(normalizeCode).filter(Boolean))];
}

function parseHistory(html) {
  const text = html
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
  const match = text.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})\s+([0-9][0-9,]*)円/);
  if (!match) return null;

  const price = Number(match[4].replace(/,/g, ""));
  if (!Number.isFinite(price)) return null;
  return {
    price,
    asOfDate: `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
  };
}

function parseMufgFundPage(html) {
  const price = html.match(/id="kijyunKagaku">\s*([0-9,]+)\s*</)?.[1];
  const date = html.match(/id="kijyunYmd">\s*(20\d{2})年(\d{1,2})月(\d{1,2})日\s*</);
  if (!price || !date) return null;
  const parsedPrice = Number(price.replace(/,/g, ""));
  if (!Number.isFinite(parsedPrice)) return null;
  return {
    price: parsedPrice,
    asOfDate: `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`,
  };
}

function parseSbiOkasanFundPage(html) {
  const date = html.match(/基準日：\s*(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  const price = html.match(/基準価額（円）<\/th>[\s\S]*?<td>\s*<span[^>]*>\s*([0-9,]+)\s*<\/span>/)?.[1];
  if (!price || !date) return null;
  const parsedPrice = Number(price.replace(/,/g, ""));
  if (!Number.isFinite(parsedPrice)) return null;
  return {
    price: parsedPrice,
    asOfDate: `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`,
  };
}

async function fetchFundPrice(code) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `https://site0.sbisec.co.jp/marble/fund/history/standardprice.do?fund_sec_code=${encodeURIComponent(code)}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FinancePriceCache/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
      },
    );
    if (!response.ok) return null;
    return parseHistory(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOfficialFundPrice(code) {
  const source = OFFICIAL_FUND_PAGES[code];
  if (!source) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FinancePriceCache/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;
    const quote = source.parser(await response.text());
    return quote ? { ...quote, source: source.source } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const updatedAt = new Date().toISOString();
const funds = {};
let fetchedCount = 0;

for (const code of uniqueCodes(targets.funds)) {
  const officialQuote = await fetchOfficialFundPrice(code);
  const quote = officialQuote || await fetchFundPrice(code);
  const existing = existingCache.funds?.[code];
  if (!quote) {
    funds[code] = existing ?? { updatedAt, error: "not-found" };
    console.warn(`${code}: 基準価額を取得できませんでした。`);
    continue;
  }

  fetchedCount += 1;
  const source = officialQuote?.source ?? "sbi-public-history";
  if (existing?.asOfDate && existing.asOfDate > quote.asOfDate) {
    funds[code] = existing;
    console.warn(`${code}: 取得値 ${quote.asOfDate} は保存済み ${existing.asOfDate} より古いため保持します。`);
    continue;
  }

  const unchanged = existing?.price === quote.price
    && existing?.asOfDate === quote.asOfDate
    && existing?.source === source;
  funds[code] = unchanged
    ? existing
    : { ...quote, updatedAt, source };
  console.log(`${code}: ${quote.asOfDate} ${quote.price}円`);
}

if (fetchedCount === 0) {
  throw new Error("すべての投資信託で基準価額を取得できませんでした。");
}

const history = structuredClone(existingCache.history ?? {});
for (const [code, quote] of Object.entries(existingCache.funds ?? {})) {
  if (!quote?.asOfDate || !Number.isFinite(quote.price)) continue;
  const month = quote.asOfDate.slice(0, 7);
  history[code] ??= {};
  const saved = history[code][month];
  if (!saved || saved.asOfDate <= quote.asOfDate) history[code][month] = quote;
}
for (const [code, quote] of Object.entries(funds)) {
  if (!quote?.asOfDate || !Number.isFinite(quote.price)) continue;
  const month = quote.asOfDate.slice(0, 7);
  history[code] ??= {};
  const saved = history[code][month];
  if (!saved || saved.asOfDate <= quote.asOfDate) history[code][month] = quote;
}

if (
  JSON.stringify(existingCache.funds ?? {}) === JSON.stringify(funds)
  && JSON.stringify(existingCache.history ?? {}) === JSON.stringify(history)
) {
  console.log("新しい基準価額はありません。キャッシュは変更しません。");
} else {
  await writeFile(
    cachePath,
    `${JSON.stringify({ updatedAt, funds, history }, null, 2)}\n`,
  );
  console.log(`Updated ${Object.keys(funds).length} fund price entries at ${updatedAt}`);
}
