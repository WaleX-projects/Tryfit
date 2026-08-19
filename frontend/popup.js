(() => {
  "use strict";

  // Base backend API endpoint URL
  const API_ROOT = "https://tryfit.ddns.net";

  // Reactive application state object
  const state = {
    productSrc: null,
    userSrc: null,
    isAuthenticated: false,
    user: null,
    token: null,
    credits: 3,
    history: [], // Stores past try-on results fetched from API
    taskId: null, // Currently running task, so Cancel can actually tell background.js to stop it
    productUrl: null, // Canonical URL of the shopping-page item being tried on
    priceInfo: null, // { raw, price, currency } scraped from that page, or null
  };

  // DOM elements map for quick access
  const els = {
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    banner: document.getElementById("banner"),

    // User profile bar
    userBar: document.getElementById("userBar"),
    userEmail: document.getElementById("userEmail"),
    logoutBtn: document.getElementById("logoutBtn"),

    // Auth & Splash
    googleAuthBtn: document.getElementById("googleAuthBtn"),

    // Credits & Payment
    creditsBtn: document.getElementById("creditsBtn"),
    creditsCount: document.getElementById("creditsCount"),
    closePaymentBtn: document.getElementById("closePaymentBtn"),
    payFlutterwaveBtn: document.getElementById("payFlutterwaveBtn"),
    payStarterBtn: document.getElementById("payStarterBtn"),

    // Gallery elements
    openGalleryBtn: document.getElementById("openGalleryBtn"),
    closeGalleryBtn: document.getElementById("closeGalleryBtn"),
    galleryGrid: document.getElementById("galleryGrid"),
    galleryEmpty: document.getElementById("galleryEmpty"),

    fileInput: document.getElementById("fileInput"),
    productCard: document.getElementById("productCard"),
    userCard: document.getElementById("userCard"),
    productPreview: document.getElementById("productPreview"),
    userPreview: document.getElementById("userPreview"),

    tryonBtn: document.getElementById("tryonBtn"),
    hintText: document.getElementById("hintText"),

    cancelBtn: document.getElementById("cancelBtn"),
    loadingLabel: document.getElementById("loadingLabel"),

    reveal: document.getElementById("reveal"),
    revealHandle: document.getElementById("revealHandle"),
    revealBeforeWrap: document.getElementById("revealBeforeWrap"),
    beforeImg: document.getElementById("beforeImg"),
    afterImg: document.getElementById("afterImg"),
    userThumb: document.getElementById("userThumb"),
    productThumb: document.getElementById("productThumb"),
    downloadBtn: document.getElementById("downloadBtn"),
    newTryonBtn: document.getElementById("newTryonBtn"),

    shopRow: document.getElementById("shopRow"),
    priceBadge: document.getElementById("priceBadge"),
    buyLink: document.getElementById("buyLink"),

    toast: document.getElementById("toast"),
  };

  let pendingTarget = null; // Target image slot: "product" | "user"
  let processingTimers = [];

  /**
   * Toggles screen visibility based on dataset screen name.
   * @param {string} name - Name of screen to display (e.g., 'splash', 'hub', 'result')
   */
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => {
      s.classList.toggle("active", s.dataset.screen === name);
    });
  }

  let toastTimer = null;
  /**
   * Displays a temporary notification banner at bottom of popup.
   * @param {string} msg - Message to show in toast.
   */
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 2200);
  }

  /**
   * Pings backend service root to determine connectivity.
   */
  async function checkStatus() {
    try {
      await fetch(API_ROOT + "/", { method: "GET" });
      setOnline();
    } catch (e) {
      setOffline();
    }
  }

  function setOnline() {
    if (!els.statusDot || !els.statusText || !els.banner) return;
    els.statusDot.className = "status-dot online";
    els.statusText.textContent = "Connected";
    els.banner.classList.remove("visible");
  }

  function setOffline() {
    if (!els.statusDot || !els.statusText || !els.banner) return;
    els.statusDot.className = "status-dot offline";
    els.statusText.textContent = "Offline";
    els.banner.textContent = "Service temporarily offline — you can still preview the flow.";
    els.banner.classList.add("visible");
  }

  /**
   * Verifies existing authentication state upon opening popup.
   */
  function initAuth() {
    chrome.runtime.sendMessage({ action: "getAuthStatus" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to query auth status:", chrome.runtime.lastError);
        return;
      }

      if (response && response.isAuthenticated) {
        state.isAuthenticated = true;
        state.user = response.user || { email: "Signed in" };
        state.token = response.token || null;
        if (response.user && response.user.credits !== undefined) {
          state.credits = response.user.credits;
        }
        updateUserUI();
        updateCreditsDisplay();
        fetchUserGallery();
        showScreen("hub");
      } else {
        state.isAuthenticated = false;
        showScreen("splash");
      }
    });
  }

  // Handle Google OAuth login button click
  if (els.googleAuthBtn) {
    els.googleAuthBtn.addEventListener("click", () => {
      els.googleAuthBtn.disabled = true;
      els.googleAuthBtn.style.opacity = "0.7";
      toast("Signing in with Google...");

      chrome.runtime.sendMessage({ action: "loginWithGoogle" }, (response) => {
        els.googleAuthBtn.disabled = false;
        els.googleAuthBtn.style.opacity = "1";

        if (chrome.runtime.lastError) {
          console.error("Auth runtime error:", chrome.runtime.lastError);
          toast("Sign-in error. Please try again.");
          return;
        }

        if (response && response.success) {
          state.isAuthenticated = true;
          state.user = response.user;
          state.token = response.token || null;
          if (response.user && response.user.credits !== undefined) {
            state.credits = response.user.credits;
          }
          updateUserUI();
          updateCreditsDisplay();
          fetchUserGallery();
          toast("Signed in successfully!");
          showScreen("hub");
        } else {
          toast(response?.error || "Google sign-in failed.");
        }
      });
    });
  }

  // Handle Logout action
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "logoutGoogle" }, () => {
        state.isAuthenticated = false;
        state.user = null;
        state.token = null;
        state.history = [];
        toast("Signed out");
        if (els.userBar) els.userBar.style.display = "none";
        showScreen("splash");
      });
    });
  }

  /**
   * Updates user email / account information header bar.
   */
  function updateUserUI() {
    if (els.userBar && state.user) {
      els.userBar.style.display = "flex";
      els.userEmail.textContent = state.user.email || state.user.name || "Google User";
    }
  }

  if (els.openGalleryBtn) {
    els.openGalleryBtn.addEventListener("click", () => {
      fetchUserGallery();
      showScreen("gallery");
    });
  }

  if (els.closeGalleryBtn) {
    els.closeGalleryBtn.addEventListener("click", () => {
      showScreen("hub");
    });
  }

  /**
   * Fetches the user's try-on gallery history from the FastAPI backend endpoint.
   */

  function loadingState(){

    

  }
  async function fetchUserGallery() {
    if (!state.token) return;
    try {
      const response = await fetch(`${API_ROOT}/api/v1/gallery?limit=50`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${state.token}`,
          "Content-Type": "application/json"
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.items)) {
          state.history = data.items;
          renderGallery();
        }
      }
    } catch (err) {
      console.error("Failed to fetch user gallery:", err);
    }
  }

  /**
   * Renders past try-on results gallery with interactive backend actions (Favorite / Delete).
   */
  function renderGallery() {
    if (!els.galleryGrid || !els.galleryEmpty) return;
    els.galleryGrid.innerHTML = "";

    if (!state.history || state.history.length === 0) {
      els.galleryEmpty.style.display = "block";
      return;
    }
    els.galleryEmpty.style.display = "none";

    state.history.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "gallery-item";
      
      const imgUrl = item.result_url || item.resultSrc || item.ref_file_url || item.productSrc;
      const title = item.title || `Look #${state.history.length - index}`;
      const isFav = item.is_favorite ? "★" : "☆";

      card.innerHTML = `
        <img src="${imgUrl}" alt="${title}">
        <div class="gallery-item-overlay">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60%;">${title}</span>
          <div style="display:flex; gap:6px;">
            <button class="fav-btn" data-taskid="${item.task_id}" style="background:none; border:none; color:#FFD700; cursor:pointer; font-size:14px;">${isFav}</button>
            <button class="del-btn" data-taskid="${item.task_id}" style="background:none; border:none; color:#ff4d4d; cursor:pointer; font-size:13px;">✕</button>
          </div>
        </div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".fav-btn") || e.target.closest(".del-btn")) return;
        state.userSrc = item.src_file_url || item.userSrc;
        state.productSrc = item.ref_file_url || item.productSrc;
        state.productUrl = item.url_of_product || item.productUrl || null;
        state.priceInfo = item.price_of_product ? { raw: String(item.price_of_product), price: item.price_of_product } : null;
        renderResult(imgUrl);
        showScreen("result");
      });

      const favBtn = card.querySelector(".fav-btn");
      if (favBtn) {
        favBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleFavoriteItem(item.task_id);
        });
      }

      const delBtn = card.querySelector(".del-btn");
      if (delBtn) {
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteGalleryItem(item.task_id);
        });
      }

      els.galleryGrid.appendChild(card);
    });
  }

  /**
   * Toggles item favorite status on the backend API.
   */
  async function toggleFavoriteItem(taskId) {
    if (!taskId || !state.token) return;
    try {
      const res = await fetch(`${API_ROOT}/api/v1/gallery/${taskId}/favorite`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${state.token}` }
      });
      if (res.ok) {
        toast("Updated favorite status");
        fetchUserGallery();
      }
    } catch (e) {
      toast("Failed to update favorite");
    }
  }

  /**
   * Deletes gallery item on the backend API.
   */
  async function deleteGalleryItem(taskId) {
    if (!taskId || !state.token) return;
    try {
      const res = await fetch(`${API_ROOT}/api/v1/gallery/${taskId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${state.token}` }
      });
      if (res.ok) {
        toast("Deleted from gallery");
        fetchUserGallery();
      }
    } catch (e) {
      toast("Failed to delete item");
    }
  }

  if (els.creditsBtn) {
    els.creditsBtn.addEventListener("click", () => {
      showScreen("payment");
    });
  }

  if (els.closePaymentBtn) {
    els.closePaymentBtn.addEventListener("click", () => {
      showScreen("hub");
    });
  }

  if (els.payFlutterwaveBtn) {
    els.payFlutterwaveBtn.addEventListener("click", () => {
      simulatePaymentSuccess(20, "Stylist Pack (20 credits added)");
    });
  }

  if (els.payStarterBtn) {
    els.payStarterBtn.addEventListener("click", () => {
      simulatePaymentSuccess(5, "Starter Pack (5 credits added)");
    });
  }

  function simulatePaymentSuccess(amountToAdd, successMessage) {
    toast("Opening secure checkout...");
    setTimeout(() => {
      state.credits += amountToAdd;
      updateCreditsDisplay();
      toast(successMessage);
      showScreen("hub");
    }, 1200);
  }

  function updateCreditsDisplay() {
    if (!els.creditsCount || !els.tryonBtn) return;
    els.creditsCount.textContent = `${state.credits} Credit${state.credits === 1 ? "" : "s"}`;
    els.tryonBtn.textContent = state.credits > 0 ? "Try on (-1 credit)" : "Get Credits to Try On";
  }

  if (els.productCard) {
    els.productCard.addEventListener("click", () => {
      pendingTarget = "product";
      if (els.fileInput) els.fileInput.click();
    });
  }

  if (els.userCard) {
    els.userCard.addEventListener("click", () => {
      pendingTarget = "user";
      if (els.fileInput) els.fileInput.click();
    });
  }

  if (els.fileInput) {
    els.fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target.result;
        if (pendingTarget === "product") {
          state.productSrc = src;
          fillCard(els.productCard, els.productPreview, src, "Product img");
        } else if (pendingTarget === "user") {
          state.userSrc = src;
          fillCard(els.userCard, els.userPreview, src, "User img");
        }
        updateActionState();
      };
      reader.readAsDataURL(file);
      els.fileInput.value = "";
    });
  }

  function fillCard(card, previewEl, src, label) {
    if (!card || !previewEl) return;
    previewEl.querySelectorAll("img.filled").forEach((n) => n.remove());
    const img = document.createElement("img");
    img.className = "filled";
    img.src = src;
    previewEl.prepend(img);
    const labelSpan = previewEl.querySelector("span");
    if (labelSpan) labelSpan.textContent = label;
    card.classList.add("has-image");
  }

  function updateActionState() {
    if (!els.tryonBtn || !els.hintText) return;
    const ready = state.productSrc && state.userSrc;
    if (state.credits <= 0) {
      els.tryonBtn.disabled = false;
      els.tryonBtn.textContent = "Get Credits to Try On";
      els.hintText.textContent = "You are out of credits. Tap above to top up.";
    } else {
      els.tryonBtn.disabled = !ready;
      els.tryonBtn.textContent = "Try on (-1 credit)";
      els.hintText.textContent = ready
        ? "Ready — tap Try on to see the result."
        : "Add a product photo and your photo to continue.";
    }
  }

  if (els.tryonBtn) {
    els.tryonBtn.addEventListener("click", () => {
      if (state.credits <= 0) {
        showScreen("payment");
        return;
      }
      startTryOn();
    });
  }

  if (els.cancelBtn) els.cancelBtn.addEventListener("click", cancelTryOn);
  if (els.newTryonBtn) els.newTryonBtn.addEventListener("click", resetToHub);

  /**
   * Asks the content script running on the active tab for a best-effort
   * product price and canonical URL. The popup has no DOM access of its
   * own, so this is the only way it can know what page the user is
   * shopping on. Fails soft - a missing/blocked content script just means
   * no price/checkout link on the result screen, not a broken try-on.
   */
  function getActiveTabProductInfo() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) return resolve({ productUrl: null, priceInfo: null });
        chrome.tabs.sendMessage(tab.id, { action: "getPageProductInfo" }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve({ productUrl: tab.url || null, priceInfo: null });
          } else {
            resolve(response);
          }
        });
      });
    });
  }

  /**
   * Initiates virtual try-on API flow with background service worker.
   */
  async function startTryOn() {
    state.credits -= 1;
    updateCreditsDisplay();

    showScreen("changing");
    if (els.loadingLabel) els.loadingLabel.textContent = "Connecting to fitting room\u2026";

    const pageInfo = await getActiveTabProductInfo();
    state.productUrl = pageInfo.productUrl || null;
    state.priceInfo = pageInfo.priceInfo || null;

    chrome.runtime.sendMessage(
      {
        action: "startTryOn",
        payload: {
          userImgDataUrl: state.userSrc,
          productRefUrl: state.productSrc,
          garmentCategory: "full_body",
          changeShoes: true,
          productUrl: state.productUrl,
          priceInfo: state.priceInfo,
        },
      },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          toast(response?.error || "Request failed");
          showScreen("hub");
          return;
        }

        const taskData = response.data;
        if (taskData && taskData.task_id) {
          state.taskId = taskData.task_id;
          subscribeProgress(taskData.task_id);
        } else if (taskData && (taskData.result_url || taskData.image_url || taskData.url)) {
          handleSuccess(taskData.result_url || taskData.image_url || taskData.url);
        } else {
          // Fallback simulation if testing locally
          mockTryOnAPI(state.userSrc, state.productSrc).then(handleSuccess);
        }
      }
    );
  }

  /**
   * Subscribes to task status updates via the background service worker's
   * WebSocket connection (background.js's "listenTaskStatus" handler).
   * @param {string} taskId - Unique task ID returned from API
   */
  function subscribeProgress(taskId) {
    chrome.runtime.sendMessage({
      action: "listenTaskStatus",
      taskId,
      task_type: "image",
      meta: { productUrl: state.productUrl, priceInfo: state.priceInfo },
    });

    const messageListener = (msg) => {
      if (msg.taskId !== taskId) return;

      if (msg.type === "progress") {
        if (els.loadingLabel) els.loadingLabel.textContent = msg.status || "Processing...";
      } else if (msg.type === "complete") {
        chrome.runtime.onMessage.removeListener(messageListener);
        const data = msg.data || {};
        handleSuccess(data.image_url || data.result_url || data.url);
      } else if (msg.type === "error") {
        chrome.runtime.onMessage.removeListener(messageListener);
        toast(msg.error || "Generation failed.");
        showScreen("hub");
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
  }

  function handleSuccess(resultSrc) {
    state.taskId = null;
    // Refresh user's gallery collection from API backend
    fetchUserGallery();

    renderResult(resultSrc);
    showScreen("result");
  }

  function cancelTryOn() {
    clearProcessingTimers();
    if (state.taskId) {
      chrome.runtime.sendMessage({ action: "cancelProgress_websocket", taskId: state.taskId });
      state.taskId = null;
    }
    showScreen("hub");
  }

  function resetToHub() {
    showScreen("hub");
  }

  function clearProcessingTimers() {
    processingTimers.forEach((t) => clearTimeout(t));
    processingTimers = [];
  }

  function mockTryOnAPI(userSrc, productSrc) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(productSrc);
      }, 2000);
    });
  }

  /**
   * Populates comparison view slider elements with original and result images.
   * @param {string} resultSrc - Final generated image URL or data URI
   */
  function renderResult(resultSrc) {
    if (els.beforeImg) els.beforeImg.src = state.userSrc;
    if (els.afterImg) els.afterImg.src = resultSrc;
    if (els.userThumb) els.userThumb.src = state.userSrc;
    if (els.productThumb) els.productThumb.src = state.productSrc;
    if (els.downloadBtn) els.downloadBtn.href = resultSrc;

    updateShopRow();

    // Ensure the before image width matches full container size so object-fit: contain doesn't distort
    updateRevealWidth();
    setReveal(50);
  }

  /**
   * Shows a price badge and "View product & checkout" link on the result
   * screen when we know where the tried-on item came from. Hidden entirely
   * if neither a price nor a product URL was found for this try-on.
   */
  function updateShopRow() {
    if (!els.shopRow) return;
    const hasPrice = state.priceInfo && state.priceInfo.raw;
    const hasUrl = !!state.productUrl;

    if (!hasPrice && !hasUrl) {
      els.shopRow.style.display = "none";
      return;
    }

    if (hasUrl && els.buyLink) els.buyLink.href = state.productUrl;
    if (els.priceBadge) {
      if (hasPrice) {
        els.priceBadge.textContent = state.priceInfo.raw;
        els.priceBadge.style.display = "";
      } else {
        els.priceBadge.style.display = "none";
      }
    }
    els.shopRow.style.display = "flex";
  }

  function updateRevealWidth() {
    if (!els.reveal || !els.beforeImg) return;
    const containerWidth = els.reveal.clientWidth;
    els.beforeImg.style.width = containerWidth + "px";
  }

  window.addEventListener("resize", updateRevealWidth);

  function setReveal(pct) {
    if (!els.revealBeforeWrap || !els.revealHandle) return;
    updateRevealWidth();
    const clamped = Math.min(96, Math.max(4, pct));
    els.revealBeforeWrap.style.width = clamped + "%";
    els.revealHandle.style.left = clamped + "%";
  }

  let dragging = false;
  function pointerToPct(clientX) {
    if (!els.reveal) return 50;
    const rect = els.reveal.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  if (els.revealHandle) {
    els.revealHandle.addEventListener("pointerdown", (e) => {
      dragging = true;
      els.revealHandle.setPointerCapture(e.pointerId);
    });
    els.revealHandle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      setReveal(pointerToPct(e.clientX));
    });
    ["pointerup", "pointercancel"].forEach((ev) =>
      els.revealHandle.addEventListener(ev, () => (dragging = false))
    );
  }

  // Initialize application on load
  checkStatus();
  initAuth();
  updateCreditsDisplay();
  updateActionState();
})();