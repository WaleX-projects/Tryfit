/**
 * TryFit Modernized Content Script
 * Integrated with provided UI Design Tokens & Modal Flow
 */

const CONFIG = {
  KEYWORDS: [
    // Tops
    "shirt","shirts","t-shirt","tshirts","tee","polo","blouse","top","tops",
    "crop","crop-top","hoodie","sweater","sweatshirt","cardigan","tank","camisole",
    "blazer","waistcoat","vest","jersey","tunic",

    // Bottoms
    "jeans","pants","trousers","trouser","shorts","skirt","skirts",
    "leggings","legging","joggers","jogger","cargo","cargos","chinos",

    // Dresses
    "dress","dresses","gown","gowns","jumpsuit","romper","maxi","midi","mini",

    // Outerwear
    "jacket","jackets","coat","coats","parka","trench","windbreaker",

    // Shoes
    "shoe","shoes","sneaker","sneakers","boot","boots","heel","heels",
    "loafer","loafers","slipper","slippers","sandal","sandals","flat","flats",
    "wedge","wedges","croc","crocs",

    // Bags
    "bag","bags","handbag","backpack","purse",

    // Nigerian
    "ankara","kaftan","agbada","dashiki","bubu","asoebi","senator",

    // Materials
    "denim","lace","silk","cotton","linen","velvet","chiffon",

    // Brands
    "nike","adidas","zara","h&m","shein","gucci","balenciaga","lv","louis vuitton"
  ],
  MIN_SIZE: 150
};

const LOADING_PHRASES = [
  "Connecting to virtual changing room...",
  "Analyzing outfit style & silhouette...",
  "Mapping body contours and pose...",
  "Draping fabric and aligning seams...",
  "Adjusting lighting, folds & shadows...",
  "Polishing final photorealistic look..."
];

class TryFitAPI {
  /**
   * Dispatches startTryOn payload to background service worker.
   */
  static async startTryOn({ userImgDataUrl, productRefUrl, garmentCategory = "full_body", changeShoes = true }) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "startTryOn",
          payload: { userImgDataUrl, productRefUrl, garmentCategory, changeShoes }
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

  /**
   * Subscribes to real-time Server-Sent Events progress updates via background script.
   */
  static subscribeToProgress(taskId, { onProgress, onComplete, onError }) {
    chrome.runtime.sendMessage({ action: "subscribeToProgress", taskId: taskId });

    const messageListener = (msg) => {
      if (msg.taskId !== taskId) return;

      if (msg.type === "progress") {
        onProgress(msg.status);
      } else if (msg.type === "complete") {
        onComplete(msg.data);
        cleanup();
      } else if (msg.type === "error") {
        onError(msg.error);
        cleanup();
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };

    return {
      close: () => {
        chrome.runtime.sendMessage({ action: "cancelProgress", taskId: taskId });
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
      this.openPopup(img.src);
    };

    parent?.appendChild(btn);
  },

  openPopup(productSrc) {
    let activeEvtSource = null;
    let userImgDataUrl = null;
    let latestResultUrl = null;
    let loadingInterval = null;

    // 1. Create Overlay Container
    const overlay = document.createElement("div");
    overlay.className = "tf-overlay";

    // 2. Inject Modal HTML Structure
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
          <!-- SCREEN 1 — Try Hub -->
          <section class="tf-screen tf-active" id="tf-screen-hub">
            <h1 class="tf-screen-title">Try hub</h1>
            <div class="tf-upload-row">
              <div class="tf-photo-card tf-has-image">
                <img src="${productSrc}" class="tf-filled" alt="Product" />
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
            <button class="tf-btn-tryon" id="tf-tryonBtn" type="button" disabled>Try on</button>
            <p class="tf-hint" id="tf-hintText">Add your photo to continue.</p>
          </section>

          <!-- SCREEN 2 — Changing Room -->
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

          <!-- SCREEN 3 — Result of Try-On -->
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
                <img id="tf-productThumb" src="${productSrc}" alt="Product img">
                <span>Product img</span>
              </div>
            </div>

            <div class="tf-result-actions">
              <a class="tf-icon-btn" id="tf-downloadBtn" href="#" download="tryfit-look.png" title="Download result">
                <svg viewBox="0 0 24 24"><path d="M12 3v13M6 11l6 6 6-6M5 21h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </a>
              <button class="tf-text-btn" id="tf-newTryonBtn" type="button">Try another</button>
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

    const screenHub = overlay.querySelector("#tf-screen-hub");
    const screenChanging = overlay.querySelector("#tf-screen-changing");
    const screenResult = overlay.querySelector("#tf-screen-result");

    const reveal = overlay.querySelector("#tf-reveal");
    const revealHandle = overlay.querySelector("#tf-revealHandle");
    const revealBeforeWrap = overlay.querySelector("#tf-revealBeforeWrap");
    const beforeImg = overlay.querySelector("#tf-beforeImg");
    const afterImg = overlay.querySelector("#tf-afterImg");
    const userThumb = overlay.querySelector("#tf-userThumb");
    const downloadBtn = overlay.querySelector("#tf-downloadBtn");

    const switchScreen = (targetScreen) => {
      [screenHub, screenChanging, screenResult].forEach(s => s.classList.remove("tf-active"));
      targetScreen.classList.add("tf-active");
    };

    const destroy = () => {
      if (activeEvtSource) activeEvtSource.close();
      if (loadingInterval) clearInterval(loadingInterval);
      overlay.remove();
    };

    closeBtn.onclick = destroy;
    overlay.onclick = (e) => {
      if (e.target === overlay) destroy();
    };

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
          changeShoes: true
        });

        if (response && response.task_id) {
          activeEvtSource = TryFitAPI.subscribeToProgress(response.task_id, {
            onProgress: (statusText) => {
              if (statusText) loadingLabel.textContent = statusText;
            },
            onComplete: (data) => {
              stopLoadingAnimation();
              latestResultUrl = data.result_url || productSrc;
              renderResult(latestResultUrl);
            },
            onError: (err) => {
              stopLoadingAnimation();
              alert(err || "Generation failed. Please try again.");
              switchScreen(screenHub);
            }
          });
        } else if (response && response.result_url) {
          stopLoadingAnimation();
          renderResult(response.result_url);
        } else {
          // Fallback simulation
          setTimeout(() => {
            stopLoadingAnimation();
            renderResult(productSrc);
          }, 3000);
        }
      } catch (err) {
        stopLoadingAnimation();
        alert(err.message || "Failed to start try-on job.");
        switchScreen(screenHub);
      }
    };

    cancelBtn.onclick = () => {
      if (activeEvtSource) activeEvtSource.close();
      stopLoadingAnimation();
      switchScreen(screenHub);
    };

    newTryonBtn.onclick = () => switchScreen(screenHub);

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

    const renderResult = (resultUrl) => {
      beforeImg.src = userImgDataUrl;
      afterImg.src = resultUrl;
      userThumb.src = userImgDataUrl;
      downloadBtn.href = resultUrl;

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
  }
};

const Scanner = {
  isCandidateImage(img) {
    if (!img || !img.src) return false;
    if (img.width < CONFIG.MIN_SIZE || img.height < CONFIG.MIN_SIZE) return false;

    const srcLower = img.src.toLowerCase();
    const altLower = (img.alt || "").toLowerCase();
    const titleLower = (img.title || "").toLowerCase();
    const classLower = (img.className || "").toLowerCase();

    return CONFIG.KEYWORDS.some(kw =>
      srcLower.includes(kw) ||
      altLower.includes(kw) ||
      titleLower.includes(kw) ||
      classLower.includes(kw)
    );
  },

  scan() {
    const images = document.querySelectorAll("img");
    images.forEach(img => {
      if (this.isCandidateImage(img)) {
        UI.createButton(img);
      }
    });
  },

  initObserver() {
    this.scan();

    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) this.scan();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Scanner.initObserver());
} else {
  Scanner.initObserver();
}