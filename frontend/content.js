const SCANNER_CONFIG = {
  KEYWORDS: [
    "shirt", "shirts", "t-shirt", "tshirts", "tee", "polo", "blouse", "top", "tops",
    "crop", "crop-top", "hoodie", "sweater", "sweatshirt", "cardigan", "tank", "camisole",
    "blazer", "waistcoat", "vest", "jersey", "tunic", "jeans", "pants", "trousers",
    "trouser", "shorts", "skirt", "skirts", "leggings", "legging", "joggers", "jogger",
    "cargo", "cargos", "chinos", "dress", "dresses", "gown", "gowns", "jumpsuit",
    "romper", "maxi", "midi", "mini", "jacket", "jackets", "coat", "coats", "parka",
    "trench", "windbreaker", "shoe", "shoes", "sneaker", "sneakers", "boot", "boots",
    "heel", "heels", "loafer", "loafers", "slipper", "slippers", "sandal", "sandals",
    "flat", "flats", "wedge", "wedges", "croc", "crocs", "bag", "bags", "handbag",
    "backpack", "purse", "ankara", "kaftan", "agbada", "dashiki", "bubu", "asoebi",
    "senator", "denim", "lace", "silk", "cotton", "linen", "velvet", "chiffon"
  ],
  MIN_SIZE: 150,
  EXCLUDE_PATTERNS: ["logo", "icon", "sprite", "avatar", "favicon", "badge", "placeholder", "spinner"],
  RESCAN_DEBOUNCE_MS: 300
};

function getBestImageUrl(img) {
  // currentSrc is the browser's own resolved pick from srcset - trust it first
  if (img.currentSrc) return img.currentSrc;

  if (img.srcset) {
    const candidates = img.srcset
      .split(",")
      .map((entry) => {
        const parts = entry.trim().split(/\s+/);
        const width = parts[1] ? parseInt(parts[1], 10) : 0;
        return { url: parts[0], width: Number.isNaN(width) ? 0 : width };
      })
      .filter((c) => c.url);
    candidates.sort((a, b) => b.width - a.width);
    if (candidates[0]) return candidates[0].url;
  }

  return img.dataset.src || img.src;
}

/**
 * Downscales a data URL to a small JPEG thumbnail (a few KB) for the sole
 * purpose of persisting a "before" reference in chrome.storage.local. We
 * deliberately do NOT persist the full-resolution upload - that would blow
 * the storage quota within a handful of tasks. This is only ever used to
 * restore the before/after slider and thumb-row after resuming a task from
 * the floating tray, never sent anywhere or used for the actual try-on.
 */
function makeThumbnail(dataUrl, maxDim = 200, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        resolve(null); // fine to skip - resume just falls back to no slider
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

const MOTION_LOADING_PHRASES = [
  "Connecting to virtual changing room...",
  "Animating your try-on...",
  "Rendering motion frames...",
  "Stitching final clip..."
];

const LOADING_PHRASES = [
  "Connecting to virtual changing room...",
  "Analyzing outfit style & silhouette...",
  "Mapping body contours and pose...",
  "Draping fabric and aligning seams...",
  "Adjusting lighting, folds & shadows...",
  "Polishing final photorealistic look..."
];

// --- Size profile ------------------------------------------------------
// A one-time, locally-stored profile (never sent to the backend) used to
// show a rough size hint. This is a simple heuristic, not a real fit
// engine - it exists to reduce guesswork, not replace a size chart.

const SIZE_PROFILE_KEY = "tf_profile";

async function getSizeProfile() {
  const res = await chrome.storage.local.get([SIZE_PROFILE_KEY]);
  return res[SIZE_PROFILE_KEY] || null;
}

async function saveSizeProfile(profile) {
  await chrome.storage.local.set({ [SIZE_PROFILE_KEY]: profile });
}

function cmToFtIn(cm) {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

function kgToLb(kg) {
  return Math.round(kg * 2.20462);
}

/**
 * Very rough height/weight -> letter size estimate, used only when the
 * person hasn't told us their usual size directly. This is a generic
 * heuristic (not brand- or category-specific) and is always labeled as
 * an estimate in the UI - it's meant to beat pure guesswork, not replace
 * an actual size chart.
 */
function estimateSizeFromMeasurements(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);

  if (bmi < 18.5) return "XS";
  if (bmi < 21) return "S";
  if (bmi < 24) return "M";
  if (bmi < 27) return "L";
  if (bmi < 30) return "XL";
  return "XXL";
}

function describeSizeProfile(profile) {
  if (!profile) return null;
  const parts = [];
  if (profile.heightCm) parts.push(cmToFtIn(profile.heightCm));
  if (profile.weightKg) parts.push(`${kgToLb(profile.weightKg)}lb`);
  if (profile.usualSize) parts.push(`Usually ${profile.usualSize}`);
  return parts.length ? parts.join(" \u00b7 ") : null;
}

function computeSizeSuggestion(profile) {
  if (!profile) return null;
  if (profile.usualSize) return { label: `Your usual size: ${profile.usualSize}`, isEstimate: false };
  const estimate = estimateSizeFromMeasurements(profile.heightCm, profile.weightKg);
  return estimate ? { label: `Estimated size: ${estimate} (based on height/weight)`, isEstimate: true } : null;
}

// --- Layer 1: JSON-LD structured data ------------------------------------
// Most modern storefronts (Shopify, WooCommerce, custom platforms alike)
// embed a Product schema in a <script type="application/ld+json"> tag for
// SEO. It's the cleanest source we have when it's present, so it's tried
// first, ahead of any DOM scraping.

function getProductJsonLd() {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (e) {
        continue; // malformed JSON-LD on the page - skip it, don't fail the whole lookup
      }
      const items = Array.isArray(data) ? data : (Array.isArray(data["@graph"]) ? data["@graph"] : [data]);
      const product = items.find(
        (item) => item && (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product")))
      );
      if (product) return product;
    }
  } catch (e) {
    // ignore - fall through to the next layer
  }
  return null;
}

/**
 * Pulls an ordered-ish list of size labels straight out of JSON-LD, when
 * the schema happens to include them - either as a `size` field on each
 * offer (common for size/color variant listings), or via schema.org's
 * generic `additionalProperty` convention.
 */
function extractSizeLabelsFromJsonLd(product) {
  if (!product) return null;
  const labels = [];
  const seen = new Set();
  const add = (val) => {
    const label = String(val).trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  };

  const offers = Array.isArray(product.offers) ? product.offers : product.offers ? [product.offers] : [];
  for (const offer of offers) {
    if (offer && offer.size) add(offer.size);
  }

  const props = Array.isArray(product.additionalProperty) ? product.additionalProperty : [];
  for (const prop of props) {
    if (prop && /size/i.test(prop.name || "") && prop.value) {
      String(prop.value)
        .split(/[,/]/)
        .forEach((v) => v.trim() && add(v));
    }
  }

  return labels.length ? labels : null;
}

// --- Layer 2: size selectors & pills on the page --------------------------
// Very common pattern regardless of platform: a <select> or a row of
// buttons/radios labeled "Size". These are structured (unlike a paragraph
// of spec text), so - unlike loose description text - they're safe to
// treat as an ordered list of this site's real size labels.

function findSizeOptionElements() {
  try {
    const selects = Array.from(document.querySelectorAll("select"));
    for (const sel of selects) {
      if (isTryFitOwnElement(sel)) continue;
      const hint = `${sel.getAttribute("aria-label") || ""} ${sel.name || ""} ${sel.id || ""} ${sel.closest("label")?.textContent || ""}`.toLowerCase();
      if (!hint.includes("size")) continue;
      const opts = Array.from(sel.options)
        .map((o) => o.textContent.trim())
        .filter((t) => t && !/select|choose/i.test(t));
      if (opts.length > 1) return opts;
    }

    const containers = Array.from(document.querySelectorAll('[class*="size" i], [id*="size" i], [data-testid*="size" i]'));
    for (const container of containers) {
      if (isTryFitOwnElement(container)) continue;
      const buttons = Array.from(container.querySelectorAll('button, [role="radio"], input[type="radio"] + label'));
      const opts = buttons.map((b) => b.textContent.trim()).filter((t) => t && t.length <= 6);
      if (opts.length >= 2) return opts;
    }
  } catch (e) {
    // ignore - fall through to the table layer
  }
  return null;
}

// --- Layer 3: size chart <table> (existing) --------------------------------
// Without real body measurements, we can't compute precise fit math - what
// we CAN do honestly is find this specific site's size chart and translate
// a generic size (XS-XXL) into whatever label/number that site uses for it.
// Size labels aren't standardized across brands, so this still adds real
// value even as a rough, position-based match rather than a measurement one.

const SIZE_CHART_KEYWORDS = ["size", "bust", "waist", "hip", "chest", "inseam", "shoulder"];
const GENERIC_SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

function findSizeChartTable() {
  try {
    const tables = Array.from(document.querySelectorAll("table"));
    let best = null;
    let bestScore = 0;

    for (const table of tables) {
      if (isTryFitOwnElement(table)) continue;
      const text = table.textContent.toLowerCase();
      if (!text.includes("size")) continue; // must at least mention "size" to be a candidate
      const score = SIZE_CHART_KEYWORDS.reduce((acc, kw) => acc + (text.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = table;
      }
    }

    // Require at least 2 keyword hits (e.g. "size" + "waist") to cut down
    // on matching an unrelated table that just happens to mention "size".
    return bestScore >= 2 ? best : null;
  } catch (e) {
    return null;
  }
}

function parseSizeChartLabels(table) {
  try {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return null;

    const headerCells = Array.from(rows[0].querySelectorAll("th, td")).map((c) =>
      c.textContent.trim().toLowerCase()
    );
    let sizeColIndex = headerCells.findIndex((h) => h === "size" || h.includes("size"));
    if (sizeColIndex === -1) sizeColIndex = 0; // fallback: assume the size label is the first column

    const labels = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll("td, th")).map((c) => c.textContent.trim());
      const label = cells[sizeColIndex];
      if (label) labels.push(label);
    }
    return labels.length ? labels : null;
  } catch (e) {
    return null;
  }
}

/**
 * Maps a generic XS-XXL size onto this site's own ordered list of size
 * labels by relative position, not by measurement. E.g. if the site only
 * lists 4 sizes, "L" (position 3 of 6) lands proportionally at position 2
 * of 4. This is a rough translation, not a fit calculation.
 */
function mapGenericSizeToChartLabel(genericSize, chartLabels) {
  const idx = GENERIC_SIZE_ORDER.indexOf(genericSize);
  if (idx === -1 || !chartLabels || !chartLabels.length) return null;
  const proportion = idx / (GENERIC_SIZE_ORDER.length - 1);
  const targetIndex = Math.round(proportion * (chartLabels.length - 1));
  return chartLabels[targetIndex];
}

/**
 * Finds this site's own label for a generic size, trying the cleanest
 * data source first and falling back as needed:
 *   1. JSON-LD product schema (structured, most reliable when present)
 *   2. Size <select>/pills on the page (structured, very common pattern)
 *   3. A scraped size-chart <table> (existing fallback, position-based)
 */
// --- Fit flag: "may run small / large" (hedged estimate) ------------------
// This is deliberately NOT a real fit calculation - we don't collect body
// girth measurements (chest/waist), only height, weight, and usual size.
// What it DOES do: when a site's size chart has real cm/in numbers, compare
// the number for your matched size against a rough, generic reference range
// for that letter size across brands in general. If the site's number falls
// outside where that size "usually" sits, flag it - otherwise call it true
// to size. Always shown as an estimate; never claimed as a guarantee.

const GENERIC_CHEST_RANGE_CM = {
  XS: [76, 84],
  S: [84, 90],
  M: [90, 97],
  L: [97, 105],
  XL: [105, 114],
  XXL: [114, 124]
};

const MEASUREMENT_COLUMN_KEYWORDS = ["chest", "bust", "waist"];

/**
 * Extracts a {label, measurementCm} row per size from a size-chart table,
 * using whichever of chest/bust/waist has its own column. Converts inches
 * to cm when the header indicates an inch chart. Returns null if the table
 * has no numeric measurement column at all (label-only charts are common
 * and still useful for parseSizeChartLabels(), just not for this flag).
 */
function parseSizeChartMeasurements(table) {
  try {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return null;

    const headerCells = Array.from(rows[0].querySelectorAll("th, td")).map((c) => c.textContent.trim().toLowerCase());
    const sizeColIndex = (() => {
      const idx = headerCells.findIndex((h) => h === "size" || h.includes("size"));
      return idx === -1 ? 0 : idx;
    })();

    let measureColIndex = -1;
    for (const kw of MEASUREMENT_COLUMN_KEYWORDS) {
      const idx = headerCells.findIndex((h) => h.includes(kw));
      if (idx !== -1) {
        measureColIndex = idx;
        break;
      }
    }
    if (measureColIndex === -1) return null;

    const headerText = headerCells.join(" ");
    const isInches = /\bin\b|inch/.test(headerText) && !/\bcm\b/.test(headerText);

    const results = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll("td, th")).map((c) => c.textContent.trim());
      const label = cells[sizeColIndex];
      const rawMeasure = cells[measureColIndex];
      if (!label || !rawMeasure) continue;
      const num = parseFloat(rawMeasure.replace(/[^\d.]/g, ""));
      if (!isFinite(num)) continue;
      results.push({ label, measurementCm: isInches ? num * 2.54 : num });
    }
    return results.length ? results : null;
  } catch (e) {
    return null;
  }
}

function pickByProportionalIndex(genericSize, list) {
  const idx = GENERIC_SIZE_ORDER.indexOf(genericSize);
  if (idx === -1 || !list || !list.length) return null;
  const proportion = idx / (GENERIC_SIZE_ORDER.length - 1);
  const targetIndex = Math.round(proportion * (list.length - 1));
  return list[targetIndex];
}

function computeFitFlag(genericSize, measurementCm) {
  const range = GENERIC_CHEST_RANGE_CM[genericSize];
  if (!range || measurementCm == null) return null;
  const [min, max] = range;
  if (measurementCm < min) return { flag: "small", label: "May run small \u2014 estimate" };
  if (measurementCm > max) return { flag: "large", label: "May run large \u2014 estimate" };
  return { flag: "true", label: "Estimated true to size" };
}

function findSiteSizeMatch(genericSize) {
  if (!genericSize) return null;

  const jsonLdLabels = extractSizeLabelsFromJsonLd(getProductJsonLd());
  if (jsonLdLabels) {
    const match = mapGenericSizeToChartLabel(genericSize, jsonLdLabels);
    if (match) {
      console.log("[TryFit size match] layer: JSON-LD", { labels: jsonLdLabels, match });
      return { label: match, fitFlag: null }; // JSON-LD gives us labels only, no measurements to compare
    }
  }

  const optionLabels = findSizeOptionElements();
  if (optionLabels) {
    const match = mapGenericSizeToChartLabel(genericSize, optionLabels);
    if (match) {
      console.log("[TryFit size match] layer: selector/pill", { labels: optionLabels, match });
      return { label: match, fitFlag: null }; // selectors/pills give labels only, same reason
    }
  }

  const table = findSizeChartTable();
  if (table) {
    const tableLabels = parseSizeChartLabels(table);
    const match = mapGenericSizeToChartLabel(genericSize, tableLabels);
    if (match) {
      const measurements = parseSizeChartMeasurements(table);
      const row = measurements ? pickByProportionalIndex(genericSize, measurements) : null;
      const fitFlag = row ? computeFitFlag(genericSize, row.measurementCm) : null;
      console.log("[TryFit size match] layer: table", { labels: tableLabels, match, fitFlag });
      return { label: match, fitFlag };
    }
  }

  console.log("[TryFit size match] layer: none - no match found on this page");
  return null;
}

// --- Product price & page URL capture -----------------------------------
// Best-effort, page-agnostic price scraping. There's no universal markup
// for "the price" across stores, so this tries the most reliable signals
// first (structured data) and falls back to loose text scanning near the
// clicked product image. Always labeled/used as a hint, never assumed exact.

const CURRENCY_REGEX = /(\$|₦|£|€|¥|USD|NGN|GBP|EUR)\s?([0-9]{1,3}(?:[,.][0-9]{3})*(?:\.[0-9]{1,2})?)/i;

function parsePriceText(text) {
  if (!text) return null;
  const match = String(text).match(CURRENCY_REGEX);
  if (!match) return null;
  return {
    raw: match[0].trim(),
    price: match[2].replace(/,/g, ""),
    currency: match[1]
  };
}

/**
 * Looks for a price near the clicked product image, preferring structured
 * data (schema.org / OpenGraph) since it's the most reliable, then falling
 * back to any nearby element whose class/id mentions "price", then finally
 * a loose page-wide scan as a last resort.
 */
function findProductPrice(nearEl) {
  const metaSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    '[itemprop="price"]'
  ];
  for (const sel of metaSelectors) {
    const node = document.querySelector(sel);
    if (!node) continue;
    const raw = node.getAttribute("content") || node.textContent;
    const parsed = parsePriceText(raw);
    if (parsed) return parsed;
  }

  let node = nearEl;
  let depth = 0;
  while (node && depth < 6) {
    const priceEl = node.querySelector
      ? node.querySelector('[class*="price" i], [id*="price" i], [data-price]')
      : null;
    if (priceEl && !isTryFitOwnElement(priceEl)) {
      const parsed = parsePriceText(priceEl.textContent);
      if (parsed) return parsed;
    }
    node = node.parentElement;
    depth++;
  }

  return parsePriceText(document.body.innerText);
}

function getProductPageUrl() {
  const canonical = document.querySelector('link[rel="canonical"]');
  return (canonical && canonical.href) || window.location.href;
}

// --- Guard against scraping our own injected UI ---------------------------
// The overlay, floating tray, and floating button are all appended into the
// SAME page DOM we're scraping for size/price info. Without this check,
// unscoped queries like document.querySelectorAll("select") can match our
// own "usual size" dropdown or price badge instead of the store's.
// Escapes text pulled from the AI size advisor (or anything else untrusted)
// before it's inserted via innerHTML. The advisor's response is built from
// scraped page content fed to an LLM, so a page could in principle attempt
// a prompt injection aimed at getting HTML back - this ensures that even if
// it did, it renders as inert text rather than executing.
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isTryFitOwnElement(el) {
  return !!(el && el.closest && el.closest(".tf-overlay, .tf-floating-widget, .tf-tray"));
}

class TryFitAPI {
  static async startTryOnMotion({ taskId }) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "startTryOnMotion", payload: { taskId } },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response && response.error) reject(new Error(response.error));
          else resolve(response ? response.data : null);
        }
      );
    });
  }



  static async startTryOn({ userImgDataUrl, productRefUrl, garmentCategory = "full_body", changeShoes = true, productUrl = null, priceInfo = null }) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "startTryOn",
          payload: { userImgDataUrl, productRefUrl, garmentCategory, changeShoes, productUrl, priceInfo }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response ? response.data : null);
          }
        }
      );
    });
  }






  static listenTaskStatus(taskId, taskType, { onProgress, onComplete, onError }, meta = {}) {
    chrome.runtime.sendMessage({ action: "listenTaskStatus", taskId, task_type: taskType, meta });

    const messageListener = (msg) => {
      if (msg.taskId !== taskId) return;
      if (msg.type === "progress") onProgress(msg.status);
      else if (msg.type === "complete") { onComplete(msg.data); cleanup(); }
      else if (msg.type === "error") { onError(msg.error); cleanup(); }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    const cleanup = () => chrome.runtime.onMessage.removeListener(messageListener);

    return {
      close: () => {
        chrome.runtime.sendMessage({ action: "cancelProgress_websocket", taskId });
        cleanup();
      }
    };
  }
}

const UI = {
  createButton(img) {
    if (img.dataset.tfInjected) return;
    img.dataset.tfInjected = "true";

    const btn = document.createElement("button");
    btn.className = "tf-inject-btn";
    btn.innerHTML = `<span>Try On</span>`;

    const parent = img.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const priceInfo = findProductPrice(img.closest("article, section, li, [class*='product' i]") || img.parentElement);
      const productUrl = getProductPageUrl();
      this.openPopup(getBestImageUrl(img), null, { productUrl, priceInfo });
    };

    parent?.appendChild(btn);
  },

  openPopup(productSrc, resumeTask = null, pageInfo = {}) {
    let activePoll = null;
    let userImgDataUrl = null;
    let userThumbUrl = null;
    let staticTaskId = null;
    let latestResultUrl = null;
    let loadingInterval = null;
    const displaySrc = (resumeTask && resumeTask.productSrc) || productSrc;
    // Where the item can be bought and what it costs - captured from the
    // host page when "Try On" was clicked, or restored from a saved task
    // when reopening from the floating tray. Always optional - the try-on
    // flow works fine without either.
    let productUrl = (resumeTask && resumeTask.productUrl) || pageInfo.productUrl || null;
    let priceInfo = (resumeTask && resumeTask.priceInfo) || pageInfo.priceInfo || null;

    const overlay = document.createElement("div");
    overlay.className = "tf-overlay";
    //const switchScreen

    overlay.innerHTML = `
      <div class="tf-app">
        <button class="tf-close-modal" id="tf-closeBtn" title="Close">&times;</button>
        <header class="tf-topbar">
          <div class="tf-brand"><span class="tf-brand-word">Tryfit</span></div>
          <div class="tf-status">
            <span class="tf-status-dot tf-online" id="tf-statusDot"></span>
            <span class="tf-status-text" id="tf-statusText">Ready</span>
          </div>
        </header>

        <main class="tf-stage" id="tf-stage">
          <section class="tf-screen tf-active" id="tf-screen-hub">
            <h1 class="tf-screen-title">Try hub</h1>
            <div class="tf-upload-row">
              <div class="tf-photo-card tf-has-image">
                <img src="${displaySrc}" class="tf-filled" alt="Product" />
                <div class="tf-photo-card-inner"><span>Product img</span></div>
              </div>
              <button class="tf-photo-card" id="tf-userCard" type="button">
                <div class="tf-photo-card-inner" id="tf-userPreview">
                  <svg viewBox="0 0 24 24" class="tf-upload-icon"><path d="M12 4v12M6 10l6-6 6 6M5 20h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span>Your photo</span>
                </div>
              </button>
            </div>
            <input type="file" id="tf-fileInput" accept="image/*" hidden>

            <button class="tf-size-chip" id="tf-sizeChip" type="button">
              <span id="tf-sizeChipText">Add your size</span>
              <span class="tf-size-chip-edit">&rsaquo;</span>
            </button>

            <button class="tf-btn-tryon" id="tf-tryonBtn" type="button" disabled>Try on</button>
            <p class="tf-size-suggestion" id="tf-sizeSuggestion" style="display:none;"></p>

            <button class="tf-btn-advisor" id="tf-sizeAdvisorBtn" type="button" style="display:none">
              Size Advicer <span aria-hidden="true">\u{1F916}</span>
            </button>
            <p class="tf-advisor-result" id="tf-advisorResult" style="display:none;"></p>

            <p class="tf-hint" id="tf-hintText">Add your photo to continue.</p>
          </section>

          <section class="tf-screen" id="tf-screen-size">
            <h1 class="tf-screen-title">Your size</h1>
            <div class="tf-size-form">
              <div class="tf-size-form-row">
                <label for="tf-heightInput">Height (cm)</label>
                <input type="number" id="tf-heightInput" placeholder="e.g. 168" min="100" max="230">
              </div>
              <div class="tf-size-form-row">
                <label for="tf-weightInput">Weight (kg)</label>
                <input type="number" id="tf-weightInput" placeholder="e.g. 63" min="30" max="200">
              </div>
              <div class="tf-size-form-row">
                <label for="tf-usualSizeInput">Usual size</label>
                <select id="tf-usualSizeInput">
                  <option value="">Not sure</option>
                  <option value="XS">XS</option>
                  <option value="S">S</option>
                  <option value="M">M</option>
                  <option value="L">L</option>
                  <option value="XL">XL</option>
                  <option value="XXL">XXL</option>
                </select>
              </div>
            </div>
            <p class="tf-hint">Stays on your device - used only to suggest a size.</p>
            <div class="tf-size-form-actions">
              <button type="button" id="tf-sizeSaveBtn" class="tf-btn-tryon">Save</button>
              <button type="button" id="tf-sizeCancelBtn" class="tf-text-btn">Back</button>
            </div>
          </section>

          <section class="tf-screen" id="tf-screen-changing">
            <h1 class="tf-screen-title">Changing room</h1>
            <div class="tf-loading-card">
              <div class="tf-loading-frame"></div>
              <div class="tf-spinner" aria-hidden="true">
                <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="none" stroke-width="2.5"/></svg>
              </div>
              <p class="tf-loading-label" id="tf-loadingLabel">Connecting to virtual changing room...</p>
            </div>
            <button class="tf-text-btn" id="tf-cancelBtn" type="button">Cancel</button>
          </section>

          <section class="tf-screen" id="tf-screen-result">
            <h1 class="tf-screen-title">Result of tryon</h1>
            <div class="tf-reveal" id="tf-reveal">
              <img class="tf-reveal-img tf-reveal-after" id="tf-afterImg" alt="Result">
              <div class="tf-reveal-before-wrap" id="tf-revealBeforeWrap">
                <img class="tf-reveal-img tf-reveal-before" id="tf-beforeImg" alt="User photo">
              </div>
              <div class="tf-reveal-handle" id="tf-revealHandle">
                <svg viewBox="0 0 24 24"><path d="M8 6 3 12l5 6M16 6l5 6-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>

            <div class="tf-thumb-row">
              <div class="tf-thumb-chip">
                <img id="tf-userThumb" alt="User img">
                <span>User img</span>
              </div>
              <div class="tf-thumb-chip">
                <img id="tf-productThumb" src="${displaySrc}" alt="Product img">
                <span>Product img</span>
              </div>
            </div>

            <div class="tf-shop-row" id="tf-shopRow" style="display:none;">
              <span class="tf-price-badge" id="tf-priceBadge"></span>
              <a class="tf-buy-link" id="tf-buyLink" href="#" target="_blank" rel="noopener noreferrer">
                View product &amp; checkout
                <svg viewBox="0 0 24 24" width="13" height="13"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </a>
            </div>

            <p class="tf-error-msg" id="tf-resultErrorMsg" style="color: #ef4444; font-size: 13px; margin: 8px 0; display: none;"></p>

            <div class="tf-result-actions">
              <a class="tf-icon-btn" id="tf-downloadBtn" href="#" download="tryfit-look.png" title="Download result">
                <svg viewBox="0 0 24 24"><path d="M12 3v13M6 11l6 6 6-6M5 21h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </a>
              <button class="tf-btn-motion" id="tf-motionBtn" type="button">
                <svg viewBox="0 0 24 24" class="tf-motion-icon"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
                <span>Try on in motion</span>
              </button>
              <button class="tf-text-btn" id="tf-newTryonBtn" type="button">Try another</button>
            </div>
            <div class="tf-motion-wrap" id="tf-motionWrap" hidden>
              <video class="tf-motion-video" id="tf-motionVideo" playsinline loop controls></video>
            </div>
          </section>
        </main>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector("#tf-closeBtn");
    const userCard = overlay.querySelector("#tf-userCard");
    const userPreview = overlay.querySelector("#tf-userPreview");
    const fileInput = overlay.querySelector("#tf-fileInput");
    const tryonBtn = overlay.querySelector("#tf-tryonBtn");
    const hintText = overlay.querySelector("#tf-hintText");
    const cancelBtn = overlay.querySelector("#tf-cancelBtn");
    const loadingLabel = overlay.querySelector("#tf-loadingLabel");
    const newTryonBtn = overlay.querySelector("#tf-newTryonBtn");
    const resultErrorMsg = overlay.querySelector("#tf-resultErrorMsg");
    const shopRow = overlay.querySelector("#tf-shopRow");
    const priceBadge = overlay.querySelector("#tf-priceBadge");
    const buyLink = overlay.querySelector("#tf-buyLink");


    const switchScreen = (targetScreen) => {
      [screenHub, screenSize, screenChanging, screenResult].forEach(s => s.classList.remove("tf-active"));
      targetScreen.classList.add("tf-active");
    };
    const updateShopRow = () => {
      if (!shopRow) return;
      if (!productUrl && !(priceInfo && priceInfo.raw)) {
        shopRow.style.display = "none";
        return;
      }
      if (productUrl) buyLink.href = productUrl;
      if (priceInfo && priceInfo.raw) {
        priceBadge.textContent = priceInfo.raw;
        priceBadge.style.display = "";
      } else {
        priceBadge.style.display = "none";
      }
      shopRow.style.display = "flex";
    };

    const sizeChip = overlay.querySelector("#tf-sizeChip");
    const sizeChipText = overlay.querySelector("#tf-sizeChipText");
    const heightInput = overlay.querySelector("#tf-heightInput");
    const weightInput = overlay.querySelector("#tf-weightInput");
    const usualSizeInput = overlay.querySelector("#tf-usualSizeInput");
    const sizeSaveBtn = overlay.querySelector("#tf-sizeSaveBtn");
    const sizeCancelBtn = overlay.querySelector("#tf-sizeCancelBtn");
    const sizeSuggestion = overlay.querySelector("#tf-sizeSuggestion");
    const sizeAdvisorBtn = overlay.querySelector("#tf-sizeAdvisorBtn");
    const advisorResult = overlay.querySelector("#tf-advisorResult");

    const refreshSizeUI = (profile) => {
      const description = describeSizeProfile(profile);
      sizeChipText.textContent = description || "Add your size";

      const suggestion = computeSizeSuggestion(profile);
      if (!suggestion) {
        sizeSuggestion.style.display = "none";
        return;
      }

      const genericSize = profile.usualSize || estimateSizeFromMeasurements(profile.heightCm, profile.weightKg);
      const siteMatch = findSiteSizeMatch(genericSize);

      const parts = [suggestion.label];
      if (siteMatch) {
        parts.push(`<span class="tf-size-chart-match">This site's size chart: ${siteMatch.label}</span>`);
        if (siteMatch.fitFlag) {
          parts.push(`<span class="tf-fit-flag tf-fit-flag-${siteMatch.fitFlag.flag}">${siteMatch.fitFlag.label}</span>`);
        }
      }
      sizeSuggestion.innerHTML = parts.join("<br>");
      sizeSuggestion.style.display = "block";
    };

    (async () => {
      const profile = await getSizeProfile();
      refreshSizeUI(profile);
      if (profile) {
        if (profile.heightCm) heightInput.value = profile.heightCm;
        if (profile.weightKg) weightInput.value = profile.weightKg;
        if (profile.usualSize) usualSizeInput.value = profile.usualSize;
      }
    })();

    // Navigation to/from the size screen is wired below, once switchScreen
    // and screenSize exist - both are defined further down in this same
    // closure, but that's fine since these handlers only ever run later,
    // in response to an actual click, by which point everything below has
    // already been initialized.
    sizeChip.onclick = () => {
      switchScreen(screenSize);
    };

    sizeCancelBtn.onclick = () => {
      switchScreen(screenHub);
    };

    sizeSaveBtn.onclick = async () => {
      const profile = {
        heightCm: heightInput.value ? Number(heightInput.value) : null,
        weightKg: weightInput.value ? Number(weightInput.value) : null,
        usualSize: usualSizeInput.value || null
      };
      await saveSizeProfile(profile);
      refreshSizeUI(profile);
      switchScreen(screenHub);
    };

    /**
     * "Size Advicer" - for sites that don't expose a structured size chart
     * at all (very common on local marketplaces), this hands the product
     * URL and the shopper's saved profile to the backend, which fetches
     * the page server-side (sidesteps the CORS issues a client-side fetch
     * would hit) and asks an LLM for a plain-language size call. It's a
     * best-effort estimate, always labeled as one - never a guarantee.
     */
    sizeAdvisorBtn.onclick = async () => {
      const profile = await getSizeProfile();
      if (!profile || (!profile.heightCm && !profile.weightKg && !profile.usualSize)) {
        advisorResult.innerHTML = `<span class="tf-advisor-unknown">Add your size first so the advisor has something to go on.</span>`;
        advisorResult.style.display = "block";
        switchScreen(screenSize);
        return;
      }

      sizeAdvisorBtn.disabled = true;
      const originalLabel = sizeAdvisorBtn.innerHTML;
      sizeAdvisorBtn.innerHTML = "Thinking\u2026";
      advisorResult.style.display = "none";

      // Best-effort local hint sent alongside the URL, in case the backend's
      // own fetch of the page gets blocked or the page is JS-rendered and
      // empty when fetched server-side without a browser.
      const localHint = [
        document.title,
        ...(findSizeOptionElements() || []),
        findSizeChartTable() ? findSizeChartTable().textContent.slice(0, 1500) : ""
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 2000);

      chrome.runtime.sendMessage(
        {
          action: "getSizeAdvice",
          payload: {
            product_url: productUrl || getProductPageUrl(),
            profile: {
              height_cm: profile.heightCm,
              weight_kg: profile.weightKg,
              usual_size: profile.usualSize
            },
            page_context: localHint
          }
        },
        (response) => {
          sizeAdvisorBtn.disabled = false;
          sizeAdvisorBtn.innerHTML = originalLabel;

          if (chrome.runtime.lastError || response?.error) {
            advisorResult.innerHTML = `<span class="tf-advisor-unknown">Couldn't reach the size advisor right now. Try again in a moment.</span>`;
            advisorResult.style.display = "block";
            return;
          }

          const data = response.data || {};
          const verdictClass =
            data.verdict === "should_fit" ? "tf-advisor-good" :
            data.verdict === "not_recommended" ? "tf-advisor-bad" :
            data.verdict === "may_not_fit" ? "tf-advisor-warn" :
            "tf-advisor-unknown";

          const sizeLine = data.recommended_size
            ? `<strong>Suggested: ${escapeHtml(data.recommended_size)}</strong>${data.confidence ? ` (${escapeHtml(data.confidence)} confidence)` : ""}`
            : "";
          const noteLine = data.note ? `<span class="tf-advisor-note">${escapeHtml(data.note)}</span>` : "";

          advisorResult.innerHTML = `<span class="${verdictClass}">${[sizeLine, noteLine].filter(Boolean).join("<br>")}</span>`;
          advisorResult.style.display = "block";
        }
      );
    };

    const screenHub = overlay.querySelector("#tf-screen-hub");
    const screenSize = overlay.querySelector("#tf-screen-size");
    const screenChanging = overlay.querySelector("#tf-screen-changing");
    const screenResult = overlay.querySelector("#tf-screen-result");

    const reveal = overlay.querySelector("#tf-reveal");
    const revealHandle = overlay.querySelector("#tf-revealHandle");
    const revealBeforeWrap = overlay.querySelector("#tf-revealBeforeWrap");
    const beforeImg = overlay.querySelector("#tf-beforeImg");
    const afterImg = overlay.querySelector("#tf-afterImg");
    const userThumb = overlay.querySelector("#tf-userThumb");
    const downloadBtn = overlay.querySelector("#tf-downloadBtn");
    const motionBtn = overlay.querySelector("#tf-motionBtn");
    const motionWrap = overlay.querySelector("#tf-motionWrap");
    const motionVideo = overlay.querySelector("#tf-motionVideo");

    const showErrorOnResult = (msg) => {
      if (resultErrorMsg) {
        resultErrorMsg.textContent = msg;
        resultErrorMsg.style.display = "block";
      }
    };

    const clearErrorOnResult = () => {
      if (resultErrorMsg) {
        resultErrorMsg.textContent = "";
        resultErrorMsg.style.display = "none";
      }
    };

    motionBtn.onclick = async () => {
      clearErrorOnResult();
      if (!staticTaskId) {
        showErrorOnResult("Missing static task ID. Please try another image.");
        return;
      }

      switchScreen(screenChanging);
      loadingLabel.textContent = MOTION_LOADING_PHRASES[0];
      let idx = 0;
      if (loadingInterval) clearInterval(loadingInterval);
      loadingInterval = setInterval(() => {
        idx = (idx + 1) % MOTION_LOADING_PHRASES.length;
        loadingLabel.textContent = MOTION_LOADING_PHRASES[idx];
      }, 2500);

      try {
        const response = await TryFitAPI.startTryOnMotion({ taskId: staticTaskId });
        const task_type = "video";
        if (response && response.task_id) {
          activePoll = TryFitAPI.listenTaskStatus(response.task_id,task_type,{
            onProgress: (statusText) => {
              if (statusText) loadingLabel.textContent = statusText;
            },
            onComplete: (data) => {
              stopLoadingAnimation();
              renderMotionResult(data.video_url || data.result_url || data.url);
              chrome.runtime.sendMessage({ action: "markTaskSeen", taskId: response.task_id });
            },
            onError: (err) => {
              stopLoadingAnimation();
              switchScreen(screenResult);
              showErrorOnResult(err || "Motion generation failed.");
            }
          }, { productSrc, userThumbUrl });
        } else {
          stopLoadingAnimation();
          switchScreen(screenResult);
          showErrorOnResult("Failed to start motion try-on.");
        }
      } catch (err) {
        stopLoadingAnimation();
        switchScreen(screenResult);
        showErrorOnResult(err.message || "Failed to start motion try-on.");
      }
    };

    const renderMotionResult = (videoUrl) => {
      motionVideo.src = videoUrl;
      motionWrap.hidden = false;
      reveal.style.display = "none";
      motionBtn.disabled = true;
      motionBtn.querySelector("span").textContent = "Motion ready";
      switchScreen(screenResult);
      motionVideo.play().catch(() => { });
    };

    

    const destroy = () => {
      // Closing the popup (X button, clicking outside) used to call
      // activePoll.close(), which told the background page to tear down
      // the WebSocket entirely - so the task kept running server-side but
      // the extension lost all track of it. Now it just hides the UI; the
      // task keeps being tracked in the background and the floating tray
      // picks it back up.
      if (loadingInterval) clearInterval(loadingInterval);
      overlay.remove();
    };

    closeBtn.onclick = destroy;
    overlay.onclick = (e) => { if (e.target === overlay) destroy(); };

    userCard.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        userImgDataUrl = ev.target.result;
        userPreview.querySelectorAll("img.tf-filled").forEach(n => n.remove());

        const img = document.createElement("img");
        img.className = "tf-filled";
        img.src = userImgDataUrl;
        img.alt = "User photo";
        userPreview.prepend(img);

        const span = userPreview.querySelector("span");
        if (span) span.textContent = "Your photo";
        userCard.classList.add("tf-has-image");

        tryonBtn.disabled = false;
        hintText.textContent = "Ready — tap Try on to process.";
      };
      reader.readAsDataURL(file);
    };

    const startLoadingAnimation = () => {
      let idx = 0;
      loadingLabel.textContent = LOADING_PHRASES[0];
      if (loadingInterval) clearInterval(loadingInterval);
      loadingInterval = setInterval(() => {
        idx = (idx + 1) % LOADING_PHRASES.length;
        loadingLabel.textContent = LOADING_PHRASES[idx];
      }, 2500);
    };

    const stopLoadingAnimation = () => {
      if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
      }
    };

    tryonBtn.onclick = async () => {
      if (!userImgDataUrl) return;

      switchScreen(screenChanging);
      startLoadingAnimation();

      try {
        const response = await TryFitAPI.startTryOn({
          userImgDataUrl,
          productRefUrl: productSrc,
          garmentCategory: "full_body",
          changeShoes: true,
          productUrl,
          priceInfo
        });

        if (response && response.task_id) {
          staticTaskId = response.task_id;
          const task_type = "image";
          userThumbUrl = await makeThumbnail(userImgDataUrl);
          activePoll = TryFitAPI.listenTaskStatus(response.task_id, task_type, {
            onProgress: (statusText) => {
              if (statusText) loadingLabel.textContent = statusText;
            },
            onComplete: (data) => {
              stopLoadingAnimation();
              console.log("renderResult",data)
              renderResult(data.image_url || data.result_url || data.url);
              chrome.runtime.sendMessage({ action: "markTaskSeen", taskId: response.task_id });
            },
            onError: (err) => {
              stopLoadingAnimation();
              switchScreen(screenHub);
              showErrorOnResult(err || "Motion generation failed.");
            }
          }, { productSrc, userThumbUrl, productUrl, priceInfo });
        } else {
          stopLoadingAnimation();
          switchScreen(screenHub);
          showErrorOnResult("Failed to start motion try-on.");
        }
      } catch (err) {
        stopLoadingAnimation();
        switchScreen(screenHub);
        showErrorOnResult(err.message || "Failed to start motion try-on.");
      }
    };
   

cancelBtn.onclick = () => {
  if (activePoll) activePoll.close();
  stopLoadingAnimation();
  switchScreen(screenHub);
};

newTryonBtn.onclick = () => {
  clearErrorOnResult();
  switchScreen(screenHub);
};

const updateRevealWidth = () => {
  if (!reveal || !beforeImg) return;
  beforeImg.style.width = reveal.clientWidth + "px";
};

const setReveal = (pct) => {
  updateRevealWidth();
  const clamped = Math.min(96, Math.max(4, pct));
  revealBeforeWrap.style.width = clamped + "%";
  revealHandle.style.left = clamped + "%";
};

const renderResult = async (resultUrl) => {
  beforeImg.src = userImgDataUrl;
  afterImg.src = resultUrl;
  userThumb.src = userImgDataUrl;

  // A resumed task (opened from the floating tray) may have hidden the
  // before/after slider since we don't persist the original user photo -
  // reset that here so a fresh, normal try-on always shows it properly.
  revealBeforeWrap.style.display = "";
  revealHandle.style.display = "";

  motionWrap.hidden = true;
  reveal.style.display = "";
  motionBtn.disabled = false;
  motionBtn.querySelector("span").textContent = "Try on in motion";
  motionVideo.pause();
  motionVideo.src = "";

  try {
    const response = await fetch(resultUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    downloadBtn.href = blobUrl;
    downloadBtn.download = "Tryfit-asset-" + new Date().toISOString().slice(0, 10) + ".png";
  } catch (error) {
    downloadBtn.href = resultUrl;
    downloadBtn.target = "_blank";
  }

  updateShopRow();
  switchScreen(screenResult);
  setTimeout(() => setReveal(50), 50);
};

let dragging = false;
const pointerToPct = (clientX) => {
  const rect = reveal.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * 100;
};

revealHandle.addEventListener("pointerdown", (e) => {
  dragging = true;
  revealHandle.setPointerCapture(e.pointerId);
});

revealHandle.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  setReveal(pointerToPct(e.clientX));
});

["pointerup", "pointercancel"].forEach(evt => {
  revealHandle.addEventListener(evt, () => { dragging = false; });
});

window.addEventListener("resize", updateRevealWidth);

    // --- Resume support (opened from the floating tray) --------------------
    if (resumeTask) {
      chrome.runtime.sendMessage({ action: "markTaskSeen", taskId: resumeTask.taskId });
      if (resumeTask.taskType === "image") staticTaskId = resumeTask.taskId;
      // Restore the saved thumbnail as "the user photo" for this session's
      // closure - renderResult() then naturally repopulates the before/after
      // slider and the "User img" thumb chip exactly as it would for a live run.
      if (resumeTask.userThumbUrl) userImgDataUrl = resumeTask.userThumbUrl;

      if (resumeTask.status === "processing") {
        switchScreen(screenChanging);
        startLoadingAnimation();
        loadingLabel.textContent = resumeTask.statusText || "Reconnecting...";
        activePoll = TryFitAPI.listenTaskStatus(resumeTask.taskId, resumeTask.taskType, {
          onProgress: (statusText) => {
            if (statusText) loadingLabel.textContent = statusText;
          },
          onComplete: (data) => {
            stopLoadingAnimation();
            if (resumeTask.taskType === "video") renderMotionResult(data.video_url || data.result_url || data.url);
            else renderResult(data.image_url || data.result_url || data.url);
            chrome.runtime.sendMessage({ action: "markTaskSeen", taskId: resumeTask.taskId });
          },
          onError: (err) => {
            stopLoadingAnimation();
            switchScreen(screenResult);
            showErrorOnResult(err || "This task failed.");
          }
        }, { productSrc: displaySrc, userThumbUrl: resumeTask.userThumbUrl, productUrl, priceInfo });
      } else if (resumeTask.status === "success" && resumeTask.resultUrl) {
        if (resumeTask.taskType === "video") {
          renderMotionResult(resumeTask.resultUrl);
        } else if (userImgDataUrl) {
          // We have a saved thumbnail - reuse the normal render path so the
          // slider and thumb row behave exactly like a fresh result.
          renderResult(resumeTask.resultUrl);
        } else {
          // No thumbnail was ever saved for this task (e.g. it predates this
          // feature, or generating it failed) - fall back to a plain view.
          afterImg.src = resumeTask.resultUrl;
          userThumb.src = "";
          revealBeforeWrap.style.display = "none";
          revealHandle.style.display = "none";
          motionWrap.hidden = true;
          motionBtn.disabled = false;
          motionBtn.querySelector("span").textContent = "Try on in motion";
          downloadBtn.href = resumeTask.resultUrl;
          downloadBtn.target = "_blank";
          updateShopRow();
          switchScreen(screenResult);
        }
      } else if (resumeTask.status === "error") {
        switchScreen(screenResult);
        showErrorOnResult(resumeTask.error || "This task failed.");
      } else if (resumeTask.status === "cancelled") {
        switchScreen(screenHub);
        hintText.textContent = "This try-on was cancelled - add your photo to start a new one.";
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Floating tray - a small always-present button showing running/completed
// tasks, backed entirely by chrome.storage.local (via background.js), so it
// reflects real task state regardless of whether the popup that started a
// given task is still open.
// ---------------------------------------------------------------------------

const WIDGET_POSITION_KEY = "tf_widget_position";
const WIDGET_CORNERS = {
  "bottom-right": { bottom: "24px", right: "24px", top: "auto", left: "auto" },
  "bottom-left": { bottom: "24px", left: "24px", top: "auto", right: "auto" },
  "top-right": { top: "24px", right: "24px", bottom: "auto", left: "auto" },
  "top-left": { top: "24px", left: "24px", bottom: "auto", right: "auto" }
};

const FloatingWidget = {
  btn: null,
  badge: null,
  tray: null,
  trayOpen: false,
  corner: "bottom-right",

  async init() {
    if (this.btn) return;

    const stored = await chrome.storage.local.get([WIDGET_POSITION_KEY]);
    this.corner = stored[WIDGET_POSITION_KEY] || "bottom-right";

    this.btn = document.createElement("div");
    this.btn.className = "tf-floating-widget";
    this.btn.title = "Tryfit tasks - drag to move";
    this.btn.innerHTML = `
      <span class="tf-float-spinner" style="display:none;"></span>
      <span class="tf-float-icon">👗</span>
      <span class="tf-float-label">Try-ons</span>
      <span class="tf-float-badge" style="display:none;"></span>
    `;
    this.spinner = this.btn.querySelector(".tf-float-spinner");
    this.badge = this.btn.querySelector(".tf-float-badge");
    this.applyCorner();
    document.body.appendChild(this.btn);
    this.setupDrag();

    this.tray = document.createElement("div");
    this.tray.className = "tf-tray";
    this.tray.style.display = "none";
    document.body.appendChild(this.tray);

    document.addEventListener("click", (e) => {
      if (this.trayOpen && !this.tray.contains(e.target) && !this.btn.contains(e.target)) {
        this.closeTray();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.tf_tasks) this.refresh();
    });

    this.refresh();
  },

  applyCorner() {
    const pos = WIDGET_CORNERS[this.corner] || WIDGET_CORNERS["bottom-right"];
    Object.assign(this.btn.style, {
      position: "fixed",
      top: pos.top,
      right: pos.right,
      bottom: pos.bottom,
      left: pos.left
    });
    // The tray anchors near whichever corner the button currently sits in.
    if (this.tray) {
      const nearTop = this.corner.startsWith("top");
      const nearLeft = this.corner.endsWith("left");
      Object.assign(this.tray.style, {
        position: "fixed",
        top: nearTop ? "84px" : "auto",
        bottom: nearTop ? "auto" : "84px",
        left: nearLeft ? "24px" : "auto",
        right: nearLeft ? "auto" : "24px"
      });
    }
  },

  setupDrag() {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;

    this.btn.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      this.btn.setPointerCapture(e.pointerId);
    });

    this.btn.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      // Small threshold so a plain click doesn't register as a drag.
      if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) {
        moved = true;
        this.btn.classList.add("tf-dragging");
      }
    });

    this.btn.addEventListener("pointerup", async (e) => {
      dragging = false;
      this.btn.classList.remove("tf-dragging");

      if (!moved) {
        // A genuine click (no meaningful drag) - open/close the tray.
        this.toggleTray();
        return;
      }

      // Snap to whichever corner of the viewport the pointer ended up nearest.
      const nearTop = e.clientY < window.innerHeight / 2;
      const nearLeft = e.clientX < window.innerWidth / 2;
      this.corner = `${nearTop ? "top" : "bottom"}-${nearLeft ? "left" : "right"}`;
      this.applyCorner();
      await chrome.storage.local.set({ [WIDGET_POSITION_KEY]: this.corner });
    });
  },

  toggleTray() {
    this.trayOpen ? this.closeTray() : this.openTray();
  },

  openTray() {
    this.trayOpen = true;
    this.applyCorner();
    this.tray.style.display = "flex";
    this.refresh();
  },

  closeTray() {
    this.trayOpen = false;
    this.tray.style.display = "none";
  },

  async refresh() {
    const { tasks } = await chrome.runtime.sendMessage({ action: "getAllTasks" });
    const list = Object.values(tasks || {}).sort((a, b) => b.updatedAt - a.updatedAt);

    const processingCount = list.filter((t) => t.status === "processing").length;
    const unseenDoneCount = list.filter((t) => (t.status === "success" || t.status === "error") && !t.seen).length;

    this.spinner.style.display = processingCount > 0 ? "inline-block" : "none";

    if (unseenDoneCount > 0) {
      this.badge.textContent = unseenDoneCount > 9 ? "9+" : String(unseenDoneCount);
      this.badge.style.display = "flex";
    } else {
      this.badge.style.display = "none";
    }

    if (this.trayOpen) this.renderTray(list);
  },

  statusLabel(task) {
    if (task.status === "processing") return task.statusText || "Processing...";
    if (task.status === "success") return "Done - tap to view";
    if (task.status === "error") return "Failed - tap for details";
    if (task.status === "cancelled") return "Cancelled";
    return task.status || "";
  },

  renderTray(list) {
    if (list.length === 0) {
      this.tray.innerHTML = `<div class="tf-tray-empty">No try-ons yet - hover a product and hit "Try On" to start one.</div>`;
      return;
    }

    this.tray.innerHTML = `
      <div class="tf-tray-header">Your try-ons</div>
      <div class="tf-tray-list">
        ${list
          .map(
            (t) => `
          <div class="tf-tray-item tf-tray-status-${t.status}" data-task-id="${t.taskId}">
            <div class="tf-tray-thumb">
              ${
                t.resultUrl || t.userThumbUrl || t.productSrc
                  ? `<img src="${t.resultUrl || t.userThumbUrl || t.productSrc}" alt="" />`
                  : `<div class="tf-tray-thumb-placeholder"></div>`
              }
              ${t.status === "processing" ? `<span class="tf-tray-spinner"></span>` : ""}
            </div>
            <div class="tf-tray-info">
              <div class="tf-tray-status-text">${this.statusLabel(t)}</div>
            </div>
            ${
              t.status !== "processing"
                ? `<button class="tf-tray-dismiss" data-dismiss-id="${t.taskId}" title="Remove">&times;</button>`
                : ""
            }
          </div>
        `
          )
          .join("")}
      </div>
    `;

    this.tray.querySelectorAll(".tf-tray-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.closest(".tf-tray-dismiss")) return;
        const task = list.find((t) => t.taskId === item.dataset.taskId);
        if (task) this.openTaskResult(task);
      });
    });

    this.tray.querySelectorAll(".tf-tray-dismiss").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ action: "dismissTask", taskId: btn.dataset.dismissId });
        this.refresh();
      });
    });
  },

  openTaskResult(task) {
    this.closeTray();
    UI.openPopup(task.productSrc || task.resultUrl, task);
  }
};

const Scanner = {
  isCandidateImage(img) {

    const url = getBestImageUrl(img);
    if (!url) return false;

    const urlLower = url.toLowerCase();
    if (SCANNER_CONFIG.EXCLUDE_PATTERNS.some((p) => urlLower.includes(p))) return false;

    const altLower = (img.alt || "").toLowerCase();
    const titleLower = (img.title || "").toLowerCase();
    const ariaLower = (img.getAttribute("aria-label") || "").toLowerCase();
    const textMatch = SCANNER_CONFIG.KEYWORDS.some(
      (kw) => urlLower.includes(kw) || altLower.includes(kw) || titleLower.includes(kw) || ariaLower.includes(kw)
    );
    if (!textMatch) return false;

    // Prefer real (natural) dimensions once loaded over CSS-rendered box size
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width && height && (width < SCANNER_CONFIG.MIN_SIZE || height < SCANNER_CONFIG.MIN_SIZE)) return false;

    if (img.offsetParent === null && getComputedStyle(img).position !== "fixed") return false;

    return true;
  },

  tryTag(img) {
    if (img.dataset.tfInjected) return;

    // Lazy-loaded images often report width/naturalWidth as 0 until they finish
    // loading - recheck once the load actually happens instead of giving up.
    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener("load", () => this.tryTag(img), { once: true });
      return;
    }

    if (this.isCandidateImage(img)) UI.createButton(img);
  },

  scan() {
    document.querySelectorAll("img").forEach((img) => this.tryTag(img));
  },

  initObserver() {
    this.scan();

    let debounceTimer = null;
    const scheduleRescan = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.scan(), SCANNER_CONFIG.RESCAN_DEBOUNCE_MS);
    };

    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some(
        (m) =>
          m.addedNodes.length > 0 ||
          (m.type === "attributes" && (m.attributeName === "src" || m.attributeName === "srcset"))
      );
      if (relevant) scheduleRescan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"]
    });
  }
};

// Lets the toolbar popup (which has no direct DOM access to the page the
// user is shopping on) ask the content script for a best-effort price and
// canonical product URL. Used by popup.js's own try-on flow.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageProductInfo") {
    const priceInfo = findProductPrice(document.body);
    const productUrl = getProductPageUrl();
    sendResponse({ productUrl, priceInfo });
    return true;
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    Scanner.initObserver();
    FloatingWidget.init();
  });
} else {
  Scanner.initObserver();
  FloatingWidget.init();
}