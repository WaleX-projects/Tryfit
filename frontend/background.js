const CONFIG = {
  API_BASE_URL: "https://tryfit.ddns.net",
  AUTH_ENDPOINT: "/api/auth/google"
};

const activeSockets = {};
const activeEventSources = {};
const retryCounts = {};
let keepAliveInterval = null;

function startKeepAlive() {
  if (!keepAliveInterval) {
    keepAliveInterval = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {});
    }, 20000); 
  }
}

function stopKeepAliveIfIdle() {
  if (Object.keys(activeSockets).length === 0 && Object.keys(activeEventSources).length === 0 && keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function getGoogleToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!token) return reject(new Error("Failed to retrieve Google Auth Token."));
      resolve(token);
    });
  });
}

async function verifyAndSaveUser(token) {
  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.AUTH_ENDPOINT}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Backend auth failed with status ${response.status}`);
    }
    const userData = await response.json();
    await chrome.storage.local.set({ authToken: token, user: userData, isAuthenticated: true });
    return userData;
  } catch (error) {
    const defaultUser = { email: "user@google.com", credits: 3 };
    await chrome.storage.local.set({ authToken: token, user: defaultUser, isAuthenticated: true });
    return defaultUser;
  }
}

async function logoutUser() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["authToken"], (res) => {
      const token = res.authToken;
      const clearStorage = () => {
        chrome.storage.local.remove(["authToken", "user", "isAuthenticated"], () => {
          resolve({ success: true });
        });
      };
      if (token) chrome.identity.removeCachedAuthToken({ token }, clearStorage);
      else clearStorage();
    });
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

// --- Persistent task registry ---------------------------------------------
// This is what makes tasks survive the popup closing, the tab navigating,
// or the service worker itself restarting. The WebSocket connections above
// live only in memory, but every status change gets mirrored here, so the
// floating tray (in content.js) always has something durable to read from.

const TASKS_STORAGE_KEY = "tf_tasks";
const MAX_STORED_TASKS = 30; // keep storage bounded - oldest tasks drop off first

async function getTasks() {
  const res = await chrome.storage.local.get([TASKS_STORAGE_KEY]);
  return res[TASKS_STORAGE_KEY] || {};
}

async function saveTask(taskId, patch) {
  const tasks = await getTasks();
  tasks[taskId] = {
    ...(tasks[taskId] || { createdAt: Date.now() }),
    ...patch,
    taskId,
    updatedAt: Date.now()
  };

  const entries = Object.entries(tasks).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const trimmed = Object.fromEntries(entries.slice(0, MAX_STORED_TASKS));

  await chrome.storage.local.set({ [TASKS_STORAGE_KEY]: trimmed });
  return trimmed[taskId];
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "loginWithGoogle") {
    (async () => {
      try {
        const token = await getGoogleToken(true);
        const userData = await verifyAndSaveUser(token);
        sendResponse({ success: true, user: userData, token });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === "getAuthStatus") {
    (async () => {
      chrome.storage.local.get(["authToken", "user", "isAuthenticated"], async (res) => {
        if (res.isAuthenticated && res.authToken) {
          sendResponse({ isAuthenticated: true, user: res.user, token: res.authToken });
        } else {
          try {
            const token = await getGoogleToken(false);
            const userData = await verifyAndSaveUser(token);
            sendResponse({ isAuthenticated: true, user: userData, token });
          } catch (e) {
            sendResponse({ isAuthenticated: false });
          }
        }
      });
    })();
    return true;
  }

  if (request.action === "logoutGoogle") {
    logoutUser().then((res) => sendResponse(res));
    return true;
  }

//-------------------------------------------------------------------------------
// 
//-------------------------------------------------------------------------------




  if (request.action === "startTryOn") {
    (async () => {
      try {
        const storage = await chrome.storage.local.get(["authToken"]);
        let token = storage.authToken;
        if (!token) token = await getGoogleToken(true);

        const { userImgDataUrl, productRefUrl, garmentCategory, changeShoes, productUrl, priceInfo } = request.payload;
        const imageBlob = await dataUrlToBlob(userImgDataUrl);

        const formData = new FormData();
        formData.append('ref_file_url', productRefUrl);
        formData.append('garment_category', garmentCategory || "full_body");
        formData.append('change_shoes', changeShoes !== undefined ? changeShoes : true);
        // Backend requires url_of_product; fall back to the current page if
        // the scanner somehow didn't resolve one.
        formData.append('url_of_product', productUrl || productRefUrl);
        // price_of_product is optional on the backend - only send it if the
        // scraper actually found a price, so it comes through as None rather
        // than an empty string.
        if (priceInfo && priceInfo.price) {
          formData.append('price_of_product', String(priceInfo.price));
        }
        formData.append('uploaded_file', imageBlob, 'image.jpg'); 

        const response = await fetch(`${CONFIG.API_BASE_URL}/api/image/v1/tryon`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          body: formData
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.detail || `Server returned status ${response.status}`);
        }

        const data = await response.json();
        sendResponse({ data: data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }




  if (request.action === "startTryOnMotion") {
    (async () => {
      try {
        const storage = await chrome.storage.local.get(["authToken"]);
        let token = storage.authToken;
        if (!token) token = await getGoogleToken(true);

        const { taskId } = request.payload;
        const formData = new FormData();
        formData.append('task_id', taskId);

        const response = await fetch(`${CONFIG.API_BASE_URL}/api/video/v1/tryon-motion`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          body: formData
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.detail || `Server returned status ${response.status}`);
        }

        const data = await response.json();
        sendResponse({ data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }

  if (request.action === "listenTaskStatus") {
    const { taskId, task_type, meta } = request;
    const tabId = sender.tab ? sender.tab.id : null;

    startKeepAlive();
    if (activeSockets[taskId]) {
      activeSockets[taskId].close();
      delete activeSockets[taskId];
    }

    saveTask(taskId, {
      taskType: task_type || "image",
      status: "processing",
      statusText: "Processing...",
      productSrc: meta && meta.productSrc ? meta.productSrc : undefined,
      userThumbUrl: meta && meta.userThumbUrl ? meta.userThumbUrl : undefined,
      productUrl: meta && meta.productUrl ? meta.productUrl : undefined,
      priceInfo: meta && meta.priceInfo ? meta.priceInfo : undefined,
      resultUrl: null,
      error: null,
      seen: true
    });

    const wsProtocol = CONFIG.API_BASE_URL.startsWith("https") ? "wss" : "ws";
    const wsDomain = CONFIG.API_BASE_URL.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${wsDomain}/api/ws/task-status/${taskId}?task_type=${task_type || "image"}`;

    try {
      const ws = new WebSocket(wsUrl);
      activeSockets[taskId] = ws;

      ws.onopen = () => {};
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.status === "success" || payload.status === "completed") {
          const resultUrl = payload.image_url || payload.video_url || payload.result_url || payload.url;
          saveTask(taskId, { status: "success", resultUrl, statusText: "Done", seen: false });
          const msg = { taskId, type: "complete", data: payload };
          if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
          chrome.runtime.sendMessage(msg).catch(() => {});
          ws.close();
        } else if (payload.status === "failed" || payload.status === "error") {
          const errorMsg = payload.error || "Task processing failed.";
          saveTask(taskId, { status: "error", error: errorMsg, seen: false });
          const msg = { taskId, type: "error", error: errorMsg };
          if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
          chrome.runtime.sendMessage(msg).catch(() => {});
          ws.close();
        } else {
          const statusText = payload.status || "Processing...";
          saveTask(taskId, { status: "processing", statusText });
          const msg = { taskId, type: "progress", status: statusText };
          if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
          chrome.runtime.sendMessage(msg).catch(() => {});
        }
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        delete activeSockets[taskId];
        stopKeepAliveIfIdle();
      };
    } catch (e) {
      saveTask(taskId, { status: "error", error: "Failed to connect to task updates.", seen: false });
      const msg = { taskId, type: "error", error: "Failed to connect to task updates." };
      if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
      chrome.runtime.sendMessage(msg).catch(() => {});
    }

    sendResponse({ success: true });
    return true;
  }

  if (request.action === "cancelProgress_websocket") {
    const taskId = request.taskId;
    if (activeSockets[taskId]) {
      activeSockets[taskId].close();
      delete activeSockets[taskId];
    }
    // Explicit cancel (the Cancel button inside the "changing room" screen) -
    // unlike just closing the popup, this one really does mean stop tracking.
    saveTask(taskId, { status: "cancelled", statusText: "Cancelled", seen: true });
    stopKeepAliveIfIdle();
    sendResponse({ success: true });
  }

  if (request.action === "getAllTasks") {
    getTasks().then((tasks) => sendResponse({ tasks }));
    return true;
  }

  if (request.action === "markTaskSeen") {
    saveTask(request.taskId, { seen: true }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === "dismissTask") {
    (async () => {
      const tasks = await getTasks();
      delete tasks[request.taskId];
      await chrome.storage.local.set({ [TASKS_STORAGE_KEY]: tasks });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === "cancelProgress_sse" || request.action === "cancelProgress") {
    const taskId = request.taskId;
    if (activeEventSources[taskId]) {
      activeEventSources[taskId].close();
      delete activeEventSources[taskId];
      delete retryCounts[taskId];
    }
    if (activeSockets[taskId]) {
      activeSockets[taskId].close();
      delete activeSockets[taskId];
    }
    stopKeepAliveIfIdle();
    sendResponse({ success: true });
  }
});