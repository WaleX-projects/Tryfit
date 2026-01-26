// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_BASE64") {
    fetch(request.url)
      .then(response => response.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ base64: reader.result });
        reader.readAsDataURL(blob);
      })
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keeps the message channel open for async response
  }
});