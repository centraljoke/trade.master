/* =====================================================
   TRADE MASTER — SECURE REAL DERIV SESSION
   Uses the deployed deriv-real-trade-session function.
   Does NOT place trades.
===================================================== */

let derivRealSocket = null;
let derivRealConnecting = false;
let derivRealConnected = false;
let derivRealReconnectAttempts = 0;
let derivRealReconnectTimer = null;

const MAX_REAL_RECONNECT_ATTEMPTS = 5;

function setRealTradingStatus(status, message) {
  const statusElement = $("derivStatus");
  const messageElement = $("derivMessage");

  if (statusElement) {
    statusElement.textContent = status;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }
}

function lockRealTradeButtons() {
  const even = $("evenBtn");
  const odd = $("oddBtn");

  if (even) {
    even.disabled = true;
    even.innerHTML =
      'Even <small>Trading not enabled yet</small>';
  }

  if (odd) {
    odd.disabled = true;
    odd.innerHTML =
      'Odd <small>Trading not enabled yet</small>';
  }
}

function updateRealBalanceFromSocket(message) {
  const balanceData = message?.balance;

  if (!balanceData) return;

  const amount = Number(balanceData.balance);

  if (!Number.isFinite(amount)) return;

  const currency = balanceData.currency || "USD";

  const display =
    currency + " " +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  if ($("balanceValue")) {
    $("balanceValue").textContent = display;
  }

  if ($("profileBalance")) {
    $("profileBalance").value = display;
  }
}

async function connectDerivRealSession() {
  if (derivRealConnecting || derivRealConnected) {
    return;
  }

  if (!supabaseClient || !currentSession) {
    setRealTradingStatus(
      "Not connected",
      "Log in to Trade Master before connecting your Deriv account."
    );
    return;
  }

  derivRealConnecting = true;

  lockRealTradeButtons();

  setRealTradingStatus(
    "Connecting...",
    "Requesting a secure REAL Deriv trading session."
  );

  try {
    const { data, error } =
      await supabaseClient.functions.invoke(
        "deriv-real-trade-session",
        {
          body: {}
        }
      );

    if (error) {
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(
        data?.error || "The REAL trading session could not be created."
      );
    }

    if (data.account_type !== "real") {
      throw new Error(
        "Security check failed: this is not a REAL account."
      );
    }

    const websocketUrl = data.websocket_url;

    if (
      typeof websocketUrl !== "string" ||
      !websocketUrl.startsWith(
        "wss://api.derivws.com/trading/v1/options/ws/real?otp="
      )
    ) {
      throw new Error(
        "The server did not return a valid REAL trading connection."
      );
    }

    setRealTradingStatus(
      "Connecting to REAL account...",
      "Secure authorization received. Opening the account connection."
    );

    // The URL contains a one-time OTP.
    // Never print or display this URL.
    derivRealSocket = new WebSocket(websocketUrl);

    derivRealSocket.onopen = () => {
      derivRealConnected = true;
      derivRealConnecting = false;
      derivRealReconnectAttempts = 0;

      setRealTradingStatus(
        "REAL account connected",
        "Authenticated Deriv REAL session is active. Trading is still disabled."
      );

      // Subscribe to the actual account balance.
      derivRealSocket.send(JSON.stringify({
        balance: 1,
        subscribe: 1,
        req_id: 71001
      }));

      toast("Secure REAL Deriv session connected.");
    };

    derivRealSocket.onmessage = (event) => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error("Invalid REAL account response.");
        return;
      }

      if (message.error) {
        console.error(
          "REAL Deriv account error:",
          message.error.message || "Unknown error"
        );

        setRealTradingStatus(
          "REAL account error",
          message.error.message ||
            "Deriv returned an account error."
        );

        return;
      }

      if (message.msg_type === "balance" || message.balance) {
        updateRealBalanceFromSocket(message);
      }
    };

    derivRealSocket.onerror = () => {
      setRealTradingStatus(
        "Connection error",
        "The secure REAL Deriv connection encountered an error."
      );
    };

    derivRealSocket.onclose = () => {
      derivRealConnected = false;
      derivRealConnecting = false;
      derivRealSocket = null;

      lockRealTradeButtons();

      setRealTradingStatus(
        "REAL session disconnected",
        "The secure session closed. A fresh authorization will be requested if reconnection is attempted."
      );

      if (
        currentSession &&
        derivRealReconnectAttempts < MAX_REAL_RECONNECT_ATTEMPTS
      ) {
        derivRealReconnectAttempts++;

        clearTimeout(derivRealReconnectTimer);

        derivRealReconnectTimer = setTimeout(() => {
          connectDerivRealSession();
        }, 5000);
      }
    };

  } catch (error) {
    derivRealConnecting = false;
    derivRealConnected = false;

    console.error(
      "REAL Deriv session error:",
      error?.message || error
    );

    lockRealTradeButtons();

    setRealTradingStatus(
      "REAL session unavailable",
      error?.message ||
        "Could not connect. Check that your Deriv account is authorized."
    );

    toast("REAL Deriv connection failed.");
  }
}

// Keep the existing balance loader and all its functionality.
// Start the secure session after it finishes.
const originalTradeMasterBalanceLoader = loadDerivAccounts;

loadDerivAccounts = async function () {
  await originalTradeMasterBalanceLoader();

  await connectDerivRealSession();
};

// Always keep real-money orders disabled during this stage.
lockRealTradeButtons();

// Expose a safe manual reconnect function for later use.
window.TradeMasterReconnectRealSession = function () {
  derivRealReconnectAttempts = 0;
  clearTimeout(derivRealReconnectTimer);

  if (derivRealSocket) {
    derivRealSocket.close();
    derivRealSocket = null;
  }

  derivRealConnected = false;
  derivRealConnecting = false;

  connectDerivRealSession();
};
