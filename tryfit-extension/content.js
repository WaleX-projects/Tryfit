/**
 * TryFit Modernized Content Script
 * Optimized for performance and UI/UX fidelity 
 */

const CONFIG = {
  KEYWORDS: ["shirt", "dress", "top", "jeans", "pants", "shoe", "sneaker", "bag", "jacket", "hoodie", "t-shirt"],
  MIN_SIZE: 150,
  API_DELAY: 2000, // Simulated delay
};

// --- Backend Service Mock ---
class TryFitAPI {
  static async processTryOn(productUrl, userBase64) {
    try {
      // Convert the Product URL to Base64 so the backend can read it easily
      const response = await fetch('http://127.0.0.1:8000/api/try-on', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product_image: productUrl, // Sending URL or Base64
          user_image: userBase64
        })
      });

      if (!response.ok) throw new Error('Network response was not ok');
      
      const data = await response.json();
      return { success: true, resultImg: data.result_image, message: data.message };
      
    } catch (error) {
      console.error("Backend Error:", error);
      throw error;
    }
  }
}
// Utility to convert image URL to Base64
async function getBase64FromUrl(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_BASE64", url: url }, (response) => {
      if (chrome.runtime.lastError || response.error) {
        reject(chrome.runtime.lastError || response.error);
      } else {
        resolve(response.base64);
      }
    });
  });
}

// --- UI Components ---
const UI = {
  createButton(img) {
    const btn = document.createElement("button");
    btn.className = "tf-inject-btn";
    btn.innerHTML = `<span>Try On</span>`;
    
    // Ensure parent is positioned for absolute child
    const parent = img.parentElement;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openPopup(img.src);
    };

    parent.appendChild(btn);
    img.dataset.tfInjected = "true";
  },
  

  openPopup(productSrc) {
    const overlay = document.createElement("div");
    overlay.className = "tf-overlay";
    
    overlay.innerHTML = `
      <div class="tf-popup">
        <button class="tf-close">&times;</button>
        <header class="tf-header">
          <h2>Virtual Try-On</h2>
          <p>Powered by TryFit AI</p>
        </header>
        
        <div class="tf-stage">
          <div class="tf-preview-box">
            <img src="${productSrc}" id="tf-product-img" />
            <label>Product</label>
          </div>
          <div class="tf-preview-box" id="tf-user-dropzone">
            <input type="file" id="tf-file-input" accept="image/*" hidden />
            <div id="tf-user-display" class="tf-empty-display">
              <span class="tf-icon">+</span>
              <p>Upload Photo</p>
            </div>
            <label>You</label>
          </div>
        </div>

        <div id="tf-result-area" class="tf-result-hidden">
           <div class="tf-shimmer">Generating your fit...</div>
        </div>

        <button id="tf-action-btn" class="tf-main-btn" disabled>Generate Try-On</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // Setup Logic
    const closeBtn = overlay.querySelector(".tf-close");
    const fileInput = overlay.querySelector("#tf-file-input");
    const dropzone = overlay.querySelector("#tf-user-dropzone");
    const actionBtn = overlay.querySelector("#tf-action-btn");
    const userDisplay = overlay.querySelector("#tf-user-display");
    
    let userBase64 = null;

    closeBtn.onclick = () => overlay.remove();
    dropzone.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          userBase64 = event.target.result;
          userDisplay.innerHTML = `<img src="${userBase64}" class="tf-uploaded-img" />`;
          userDisplay.classList.remove('tf-empty-display');
          actionBtn.disabled = false;
        };
        reader.readAsDataURL(file);
      }
    };

    actionBtn.onclick = async () => {
      const resultArea = overlay.querySelector("#tf-result-area");
      actionBtn.disabled = true;
      actionBtn.innerText = "Processing...";
      resultArea.className = "tf-result-visible";
      console.log("Starting Try-On process...",productSrc);
      const productBase64 = await getBase64FromUrl(productSrc);
      console.log("Starting Try-On process...",productBase64);
      try {
        const data = await TryFitAPI.processTryOn(productBase64, userBase64);
        actionBtn.innerText = data.message;
        actionBtn.style.color = "#4CAF50";
        resultArea.innerHTML = `
          <div class="tf-final-container">
            <h3>Your Result</h3>
            <img src="${data.resultImg}" />
            <a class="tf-download-btn" href="${data.resultImg}" download>Download Look</a>
          </div>
        `;
      } catch (err) {
        resultArea.innerText = "Error: Backend unavailable.";
      }
    };
  }
};

// --- Detection Engine ---
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      if (img.dataset.tfInjected) return;

      const meta = (img.alt + img.ariaLabel + (img.closest('a')?.innerText || "")).toLowerCase();
      const isFashion = CONFIG.KEYWORDS.some(k => meta.includes(k));

      if (isFashion && img.width > CONFIG.MIN_SIZE) {
        UI.createButton(img);
      }
    }
  });
}, { threshold: 0.1 });

// Start observing
document.querySelectorAll("img").forEach(img => observer.observe(img));