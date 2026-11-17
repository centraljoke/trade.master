/* =========================================
   TRADEMASTER - DERIV OAUTH
   Authorization Code + PKCE
========================================= */

(() => {
  "use strict";

  const DERIV_CLIENT_ID = "34Yzl3yaJW52nOGNZIHpT";
  const DERIV_REDIRECT_URI =
    "https://hest-six.vercel.app/deriv-callback";

  const DERIV_AUTH_URL = "https://auth.deriv.com/oauth2/auth";

  const connectButton = document.getElementById("connectDerivBtn");
  const statusElement = document.getElementById("derivStatus");
  const messageElement = document.getElementById("derivMessage");

  function showStatus(status, message) {
    if (statusElement) statusElement.textContent = status;
    if (messageElement) messageElement.textContent = message;
  }

  // Display the result returned by the secure callback page.
  const pageParams = new URLSearchParams(window.location.search);

  if (pageParams.get("deriv_connected") === "1") {
    showStatus(
      "Authorization successful",
      "Deriv authorization was completed and the backend confirmed the connection."
    );

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );
  } else {
    showStatus(
      "Not connected",
      "Select Connect Deriv to securely authorize your account."
    );
  }

  function randomString(length = 64) {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);

    return Array.from(randomValues)
      .map(value => characters[value % characters.length])
      .join("");
  }

  function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";

    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  async function createCodeChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", encoded);

    return base64UrlEncode(digest);
  }

  async function connectDeriv() {
    try {
      if (!window.crypto || !crypto.subtle) {
        throw new Error("Please open TradeMaster using a secure HTTPS connection.");
      }

      connectButton.disabled = true;
      connectButton.textContent = "Connecting...";

      showStatus(
        "Preparing connection",
        "Preparing secure Deriv authorization..."
      );

      const verifier = randomString(64);
      const challenge = await createCodeChallenge(verifier);
      const state = randomString(48);

      sessionStorage.setItem("tm_deriv_code_verifier", verifier);
      sessionStorage.setItem("tm_deriv_oauth_state", state);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: DERIV_CLIENT_ID,
        redirect_uri: DERIV_REDIRECT_URI,
        scope: "trade",
        state: state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

      window.location.assign(
        `${DERIV_AUTH_URL}?${params.toString()}`
      );

    } catch (error) {
      console.error("Deriv authorization error:", error);

      showStatus(
        "Not connected",
        error.message || "Could not start Deriv authorization."
      );

      connectButton.disabled = false;
      connectButton.textContent = "Connect Deriv";
    }
  }

  if (connectButton) {
    connectButton.addEventListener("click", connectDeriv);
  }

})();
    
