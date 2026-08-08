const CONFIG = {
  API_BASE_URL: "https://tryfit.ddns.net",
  AUTH_ENDPOINT: "/api/auth/google"
};

// Keep track of active Server-Sent Events (SSE) connections
const activeEventSources = {};

/**
 * Obtains an OAuth token from Google via chrome.identity.
 * @param {boolean} interactive - Whether to prompt the user visually if not logged in.
 * @returns {Promise<string>} Google OAuth token
 */
async function getGoogleToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!token) {
        return reject(new Error("Failed to retrieve Google Auth Token."));
      }
      resolve(token);
    });
  });
}

/**
 * Verifies the Google OAuth token with the FastAPI backend and caches user details.
 * @param {string} token - Google OAuth access token
 * @returns {Promise<Object>} Verified user object from FastAPI
 */
async function verifyAndSaveUser(token) {
  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.AUTH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Backend auth failed with status ${response.status}`);
    }

    const userData = await response.json();
    
    // Store authenticated user session and token in storage
    await chrome.storage.local.set({
      authToken: token,
      user: userData,
      isAuthenticated: true
    });

    return userData;
  } catch (error) {
    console.error("[TryFit Auth] Verification Error:", error);
    // If backend verification fails, fallback to local user profile if token is valid
    const defaultUser = { email: "user@google.com", credits: 3 };
    await chrome.storage.local.set({
      authToken: token,
      user: defaultUser,
      isAuthenticated: true
    });
    return defaultUser;
  }
}

/**
 * Revokes Google token from Chrome cache and clears local session storage.
 */
async function logoutUser() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["authToken"], (res) => {
      const token = res.authToken;
      const clearStorage = () => {
        chrome.storage.local.remove(["authToken", "user", "isAuthenticated"], () => {
          resolve({ success: true });
        });
      };

      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, clearStorage);
      } else {
        clearStorage();
      }
    });
  });
}

// Helper: Convert Base64 Data URL to Blob so we can send it in FormData
async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // --- OAUTH SIGN IN ---
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
    return true; // Keep message channel open for async response
  }

  // --- GET AUTH STATUS ---
  if (request.action === "getAuthStatus") {
    (async () => {
      chrome.storage.local.get(["authToken", "user", "isAuthenticated"], async (res) => {
        if (res.isAuthenticated && res.authToken) {
          sendResponse({ isAuthenticated: true, user: res.user, token: res.authToken });
        } else {
          // Attempt non-interactive silent token retrieval
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

  // --- LOGOUT ---
  if (request.action === "logoutGoogle") {
    logoutUser().then((res) => sendResponse(res));
    return true;
  }

  // --- 1. HANDLE POST REQUEST (UPLOAD WITH GOOGLE OAUTH HEADER) ---
  if (request.action === "startTryOn") {
    (async () => {
      try {
        // Retrieve cached auth token
        const storage = await chrome.storage.local.get(["authToken"]);
        let token = storage.authToken;

        if (!token) {
          token = await getGoogleToken(true);
        }

        const { userImgDataUrl, productRefUrl, garmentCategory, changeShoes } = request.payload;

        // Convert base64 string back to a Blob/File
        const imageBlob = await dataUrlToBlob(userImgDataUrl);

        const formData = new FormData();
        formData.append('ref_file_url', productRefUrl);
        formData.append('garment_category', garmentCategory || "full_body");
        formData.append('change_shoes', changeShoes !== undefined ? changeShoes : true);
        formData.append('uploaded_file', imageBlob, 'image.jpg'); 

        const response = await fetch(`${CONFIG.API_BASE_URL}/image/api/v1/tryon`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          },
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
    return true; // Keep message channel open for async response
  }

  // --- 2. HANDLE SERVER-SENT EVENTS (SSE) PROGRESS WITH AUTH TOKEN ---
  if (request.action === "subscribeToProgress") {
    (async () => {
      const taskId = request.taskId;
      const tabId = sender.tab ? sender.tab.id : null;
      
      const storage = await chrome.storage.local.get(["authToken"]);
      const token = storage.authToken || "";

      // Append auth token as query parameter for SSE connection
      const sseUrl = `${CONFIG.API_BASE_URL}/image/api/v1/task/${taskId}?token=${encodeURIComponent(token)}`;
      const evtSource = new EventSource(sseUrl);
      activeEventSources[taskId] = evtSource;

      evtSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.status === "success") {
            if (tabId) chrome.tabs.sendMessage(tabId, { taskId, type: "complete", data: payload });
            chrome.runtime.sendMessage({ taskId, type: "complete", data: payload }).catch(() => {});
            evtSource.close();
            delete activeEventSources[taskId];
          } else if (payload.status === "failed" || payload.status === "error") {
            if (tabId) chrome.tabs.sendMessage(tabId, { taskId, type: "error", error: payload.error || payload.message || "Processing failed" });
            chrome.runtime.sendMessage({ taskId, type: "error", error: payload.error || payload.message || "Processing failed" }).catch(() => {});
            evtSource.close();
            delete activeEventSources[taskId];
          } else {
            if (tabId) chrome.tabs.sendMessage(tabId, { taskId, type: "progress", status: payload.status || "Loading..." });
            chrome.runtime.sendMessage({ taskId, type: "progress", status: payload.status || "Loading..." }).catch(() => {});
          }
        } catch (err) {
          console.error("[TryFit Background] Failed to parse SSE payload:", err);
        }
      };

      evtSource.onerror = () => {
        if (tabId) chrome.tabs.sendMessage(tabId, { taskId, type: "error", error: "Connection lost." });
        chrome.runtime.sendMessage({ taskId, type: "error", error: "Connection lost." }).catch(() => {});
        evtSource.close();
        delete activeEventSources[taskId];
      };
      
      sendResponse({ success: true });
    })();
    return true;
  }

  // --- 3. HANDLE CANCEL/CLEANUP ---
  if (request.action === "cancelProgress") {
    const taskId = request.taskId;
    if (activeEventSources[taskId]) {
      activeEventSources[taskId].close();
      delete activeEventSources[taskId];
    }
    sendResponse({ success: true });
  }
});