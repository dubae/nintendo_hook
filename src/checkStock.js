export const STATUS = Object.freeze({
  IN_STOCK: "in_stock",
  OUT_OF_STOCK: "out_of_stock",
  UNKNOWN: "unknown"
});

const DEFAULT_SOLD_OUT_HINTS = [
  "품절",
  "일시품절",
  "재고 없음",
  "재고없음",
  "현재 구매할 수 없습니다",
  "sold out",
  "out of stock",
  "unavailable"
];

const DEFAULT_IN_STOCK_HINTS = [
  "장바구니에 추가",
  "장바구니 담기",
  "구매하기",
  "바로 구매",
  "add to cart",
  "in stock"
];

export async function checkStock(config) {
  const fetchedAt = new Date().toISOString();
  const response = await fetchHtml(config.productUrl, config);
  const analysis = analyzeStockHtml(response.html, config);

  return {
    ...analysis,
    checkedAt: fetchedAt,
    httpStatus: response.status,
    url: response.url
  };
}

export async function fetchHtml(url, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "user-agent": config.userAgent
      }
    });

    const html = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${url}`);
    }

    return {
      html,
      status: response.status,
      url: response.url
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function analyzeStockHtml(html, config = {}) {
  const magentoProduct = extractMagentoProduct(html);
  if (magentoProduct) {
    const status = statusFromMagentoProduct(magentoProduct);
    if (status !== STATUS.UNKNOWN) {
      return {
        status,
        source: "magento-product-json",
        productName: magentoProduct.name || "",
        price: getMagentoPrice(magentoProduct),
        evidence: describeMagentoEvidence(magentoProduct)
      };
    }
  }

  return statusFromPageText(html, config);
}

export function extractMagentoProduct(html) {
  const scripts = extractMagentoInitScripts(html);

  for (const scriptBody of scripts) {
    const parsed = safeJsonParse(scriptBody);
    if (!parsed) {
      continue;
    }

    const provider = findObjectByKey(parsed, "Magento_Catalog/js/product/view/provider");
    const items = provider?.data?.items;
    if (items && typeof items === "object") {
      return Object.values(items).find((item) => item && typeof item === "object") || null;
    }
  }

  return null;
}

function statusFromMagentoProduct(product) {
  const primarySignals = [
    ["is_available", product.is_available],
    ["is_salable", product.is_salable]
  ];
  const secondarySignals = [
    ["is_in_stock", product.is_in_stock],
    ["in_stock", product.in_stock],
    ["stock_status", product.stock_status],
    ["availability", product.availability]
  ];
  const primaryValues = primarySignals
    .map(([, value]) => parseStockBoolean(value))
    .filter((value) => value !== undefined);

  if (primaryValues.includes(true)) {
    return STATUS.IN_STOCK;
  }

  if (primaryValues.length > 0 && primaryValues.every((value) => value === false)) {
    return STATUS.OUT_OF_STOCK;
  }

  for (const [, value] of secondarySignals) {
    const parsed = parseStockBoolean(value);
    if (parsed === true) {
      return STATUS.IN_STOCK;
    }
    if (parsed === false) {
      return STATUS.OUT_OF_STOCK;
    }
  }

  return STATUS.UNKNOWN;
}

function statusFromPageText(html, config) {
  const decodedText = stripTags(decodeHtmlEntities(html)).toLowerCase();
  const soldOutHints = [...DEFAULT_SOLD_OUT_HINTS, ...(config.soldOutHints || [])].map((hint) =>
    hint.toLowerCase()
  );
  const inStockHints = [...DEFAULT_IN_STOCK_HINTS, ...(config.inStockHints || [])].map((hint) =>
    hint.toLowerCase()
  );

  const hasUnavailableClass = /\bclass=["'][^"']*\bstock\b[^"']*\bunavailable\b/i.test(html);
  const hasAvailableClass = /\bclass=["'][^"']*\bstock\b[^"']*\bavailable\b/i.test(html);
  const soldOutHint = soldOutHints.find((hint) => decodedText.includes(hint));
  const inStockHint = inStockHints.find((hint) => decodedText.includes(hint));

  if (hasUnavailableClass || soldOutHint) {
    return {
      status: STATUS.OUT_OF_STOCK,
      source: "page-text",
      productName: "",
      price: "",
      evidence: hasUnavailableClass ? "stock unavailable class found" : `text hint found: ${soldOutHint}`
    };
  }

  if (hasAvailableClass || inStockHint) {
    return {
      status: STATUS.IN_STOCK,
      source: "page-text",
      productName: "",
      price: "",
      evidence: hasAvailableClass ? "stock available class found" : `text hint found: ${inStockHint}`
    };
  }

  return {
    status: STATUS.UNKNOWN,
    source: "page-text",
    productName: "",
    price: "",
    evidence: "no reliable stock marker found"
  };
}

function extractMagentoInitScripts(html) {
  const scripts = [];
  const scriptRegex =
    /<script\b[^>]*type=["']text\/x-magento-init["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[1].trim());
  }

  return scripts;
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function findObjectByKey(value, targetKey) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(value, targetKey)) {
    return value[targetKey];
  }

  for (const child of Object.values(value)) {
    const found = findObjectByKey(child, targetKey);
    if (found) {
      return found;
    }
  }

  return null;
}

function parseStockBoolean(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value > 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "available", "in_stock", "instock", "salable"].includes(normalized)) {
    return true;
  }
  if (
    normalized === "" ||
    ["0", "false", "no", "n", "unavailable", "out_of_stock", "outofstock", "sold_out"].includes(
      normalized
    )
  ) {
    return false;
  }

  return undefined;
}

function describeMagentoEvidence(product) {
  const bits = [];
  for (const key of ["is_available", "is_salable", "is_in_stock", "in_stock", "stock_status"]) {
    if (Object.prototype.hasOwnProperty.call(product, key)) {
      bits.push(`${key}=${JSON.stringify(product[key])}`);
    }
  }

  return bits.join(", ") || "Magento product stock fields found";
}

function getMagentoPrice(product) {
  const amount =
    product?.price_info?.final_price ??
    product?.price_info?.minimal_price ??
    product?.price_info?.regular_price;

  if (typeof amount === "number" && Number.isFinite(amount)) {
    return `KRW ${amount.toLocaleString("ko-KR")}`;
  }

  return "";
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function stripTags(input) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}
