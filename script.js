/* =====================================================
   TRADE MASTER
   SUPABASE + MPESA + DERIV + LIVE MARKET
   DEMO WALLET + DEMO TRADING — UPDATED
===================================================== */

// ==========================================
// SUPABASE CONFIGURATION
// ==========================================

const SUPABASE_URL =
  "https://ftiavwxnxokmcdkazufw.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_scG4LSH-fj0B9-WPCMgpGg_90uxk-MA";

const $ = (id) => document.getElementById(id);

const money = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

let supabaseClient = null;
let isSignup = false;
let currentSession = null;
let currentProfile = {};
let chart = null;
let usdKesRate = 130.03;

// ==========================================
// DERIV MARKET CONFIGURATION
// ==========================================

const DERIV_MARKET_SYMBOL = "1HZ10V";
const DERIV_MARKET_NAME = "Volatility 10 (1s) Index";

const DERIV_PUBLIC_WS =
  "wss://api.derivws.com/trading/v1/options/ws/public";

let marketSocket = null;
let marketReconnectTimer = null;
let marketReconnectDelay = 3000;
let marketConnected = false;
let marketPrices = [];
let marketTimes = [];
let marketRawPrices = [];
let marketLastPrice = null;

// ==========================================
// DEMO ACCOUNT VARIABLES
// ==========================================

let tradeMasterAccountMode = "REAL";
let demoWalletBalance = 10000;
let demoTradeBusy = false;
let demoTradePending = false;

// ==========================================
// CONNECT SUPABASE
// ==========================================

if (
  window.supabase &&
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_ANON_KEY.includes("YOUR_")
) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
}

// ==========================================
// NOTIFICATION
// ==========================================

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.remove("show");
  }, 3200);
}

// ==========================================
// AUTH MESSAGE
// ==========================================

function authMessage(message, isError = true) {
  const el = $("authMessage");
  if (!el) return;

  el.textContent = message;
  el.style.color = isError ? "#ff747e" : "#42d4b7";
}

// ==========================================
// SHOW PAGES
// ==========================================

function showAuth() {
  if ($("app")) $("app").hidden = true;
  if ($("authPage")) $("authPage").hidden = false;

  window.scrollTo(0, 0);
}

function showApp() {
  if ($("authPage")) $("authPage").hidden = true;
  if ($("app")) $("app").hidden = false;

  window.scrollTo(0, 0);
}

// ==========================================
// SIGNUP / LOGIN SWITCH
// ==========================================

function setSignupMode() {
  isSignup = !isSignup;

  ["nameField", "phoneField", "ageField"].forEach(id => {
    if ($(id)) $(id).hidden = !isSignup;
  });

  $("authTitle").textContent = isSignup
    ? "Create your account"
    : "Welcome Back";

  $("authSubtitle").textContent = isSignup
    ? "Register for your Trade Master account"
    : "Sign in to your Trade Master account";

  $("authSubmit").textContent = isSignup
    ? "Create Account"
    : "Login";

  $("switchText").textContent = isSignup
    ? "Already have an account?"
    : "Don't have an account?";

  $("switchAuth").textContent = isSignup
    ? "Login"
    : "Sign Up";

  $("authPassword").autocomplete = isSignup
    ? "new-password"
    : "current-password";

  authMessage("");
}

if ($("switchAuth")) {
  $("switchAuth").addEventListener("click", setSignupMode);
}

// ==========================================
// AUTHENTICATION
// ==========================================

if ($("authForm")) {
  $("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!supabaseClient) {
      return authMessage(
        "Supabase connection is unavailable. Check your configuration."
      );
    }

    const email = $("authEmail").value.trim().toLowerCase();
    const password = $("authPassword").value;

    try {
      $("authSubmit").disabled = true;
      $("authSubmit").textContent = "Please wait...";

      if (isSignup) {
        const age = Number($("authAge").value);

        if (
          !$("fullName").value.trim() ||
          !$("authPhone").value.trim() ||
          !age ||
          age < 18 ||
          age > 100
        ) {
          throw new Error(
            "Enter your name, phone number and a valid age (18+)."
          );
        }

        const { data, error } =
          await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: $("fullName").value.trim(),
                phone: $("authPhone").value.trim(),
                age
              }
            }
          });

        if (error) throw error;

        if (!data.session) {
          authMessage(
            "Account created. Check your email to confirm, then log in.",
            false
          );
          return;
        }

        currentSession = data.session;

      } else {
        const { data, error } =
          await supabaseClient.auth.signInWithPassword({
            email,
            password
          });

        if (error) throw error;

        currentSession = data.session;
      }

      await loadProfile();
      enterDashboard();

    } catch (error) {
      console.error("Authentication error:", error);
      authMessage(error.message || "Unable to authenticate.");

    } finally {
      $("authSubmit").disabled = false;

      $("authSubmit").textContent = isSignup
        ? "Create Account"
        : "Login";
    }
  });
}

// ==========================================
// LOAD USER PROFILE
// ==========================================

async function loadProfile() {
  const {
    data: { user },
    error
  } = await supabaseClient.auth.getUser();

  if (error) throw error;

  if (!user) {
    throw new Error("User account could not be loaded.");
  }

  const meta = user.user_metadata || {};

  currentProfile = {
    id: user.id,
    email: user.email,
    name: meta.full_name || user.email,
    phone: meta.phone || "",
    age: meta.age || ""
  };
}

// ==========================================
// OPEN DASHBOARD
// ==========================================

function enterDashboard() {
  showApp();

  if ($("profileName")) {
    $("profileName").value = currentProfile.name || "";
  }

  if ($("profileEmail")) {
    $("profileEmail").value = currentProfile.email || "";
  }

  if ($("profilePhone")) {
    $("profilePhone").value = currentProfile.phone || "";
  }

  if ($("profileAge")) {
    $("profileAge").value = currentProfile.age || "";
  }

  if ($("profileBalance")) {
    $("profileBalance").value = "Loading REAL balance...";
  }

  if ($("balanceValue")) {
    $("balanceValue").textContent = "Loading REAL balance...";
  }

  renderChart();
  renderDigits();

  loadExchangeRate();
  loadDerivAccounts();
  connectDerivMarket();

  initializeTradeMasterDemo();
}

// ==========================================
// LOAD REAL DERIV ACCOUNT BALANCE
// ==========================================

async function loadDerivAccounts() {
  if (!supabaseClient || !currentSession) return;

  // Do not overwrite the Demo account display.
  if (tradeMasterAccountMode !== "REAL") return;

  const balanceElement = $("balanceValue");
  const profileBalanceElement = $("profileBalance");

  if (balanceElement) {
    balanceElement.textContent = "Loading REAL balance...";
  }

  if (profileBalanceElement) {
    profileBalanceElement.value = "Loading REAL balance...";
  }

  try {
    const { data, error } =
      await supabaseClient.functions.invoke(
        "deriv-account-balance",
        { body: {} }
      );

    if (error) throw error;

    if (!data || !data.success) {
      throw new Error(
        data?.error || "Could not retrieve Deriv accounts."
      );
    }

    const response = data.accounts;
    let accounts = [];

    if (Array.isArray(response)) {
      accounts = response;
    } else if (Array.isArray(response?.data)) {
      accounts = response.data;
    } else if (Array.isArray(response?.data?.accounts)) {
      accounts = response.data.accounts;
    } else if (Array.isArray(response?.accounts)) {
      accounts = response.accounts;
    }

    const realAccounts = accounts.filter(account => {
      const type = String(
        account.account_type || account.type || ""
      ).toLowerCase();

      return (
        type === "real" ||
        type.includes("real_money") ||
        account.is_virtual === false
      );
    });

    if (realAccounts.length === 0) {
      throw new Error("No REAL Deriv account was found.");
    }

    const accountLines = realAccounts.map(account => {
      const amount = Number(account.balance);
      const currency = account.currency || "USD";

      if (!Number.isFinite(amount)) {
        throw new Error(
          "Deriv returned an invalid REAL account balance."
        );
      }

      return (
        `${currency} ` +
        amount.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      );
    });

    const display = accountLines.join(" | ");

    // Check again in case the user switched accounts
    // while the network request was running.
    if (tradeMasterAccountMode === "REAL") {
      if (balanceElement) {
        balanceElement.textContent = display;
      }
    }

    if (profileBalanceElement) {
      profileBalanceElement.value = display;
    }

    console.log(
      "REAL Deriv accounts loaded:",
      realAccounts.length
    );

  } catch (error) {
    console.error("Deriv balance error:", error);

    if (tradeMasterAccountMode === "REAL" && balanceElement) {
      balanceElement.textContent = "REAL balance unavailable";
    }

    if (profileBalanceElement) {
      profileBalanceElement.value = "Unavailable";
    }
  }
}

// ==========================================
// DERIV LIVE MARKET CONNECTION
// ==========================================

function connectDerivMarket() {
  if (
    marketSocket &&
    (
      marketSocket.readyState === WebSocket.OPEN ||
      marketSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  clearTimeout(marketReconnectTimer);

  setMarketStatus("Connecting to live market...");

  try {
    marketSocket = new WebSocket(DERIV_PUBLIC_WS);

    marketSocket.onopen = () => {
      marketConnected = true;
      marketReconnectDelay = 3000;

      setMarketStatus("Live market connected");

      marketSocket.send(JSON.stringify({
        ticks_history: DERIV_MARKET_SYMBOL,
        count: 70,
        end: "latest",
        style: "ticks",
        req_id: 1
      }));
    };

    marketSocket.onmessage = (event) => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error("Invalid market response:", error);
        return;
      }

      if (message.error) {
        console.error("Deriv market error:", message.error);

        setMarketStatus(
          message.error.message || "Market feed error"
        );

        return;
      }

      if (message.history) {
        const prices = message.history.prices || [];
        const times = message.history.times || [];

        marketRawPrices = prices.map(String);

        marketPrices = prices
          .map(Number)
          .filter(Number.isFinite);

        marketTimes = times.map(Number);

        updateLiveChart();
        updateDigitStrip();
        updateDemoMarketDisplay();

        if (
          marketSocket &&
          marketSocket.readyState === WebSocket.OPEN
        ) {
          marketSocket.send(JSON.stringify({
            ticks: DERIV_MARKET_SYMBOL,
            subscribe: 1,
            req_id: 2
          }));
        }

        setMarketStatus("Live market running");

        return;
      }

      if (message.tick) {
        const price = Number(message.tick.quote);
        const epoch = Number(message.tick.epoch);

        if (!Number.isFinite(price)) return;

        marketLastPrice = price;

        marketPrices.push(price);
        marketRawPrices.push(String(message.tick.quote));

        marketTimes.push(
          Number.isFinite(epoch)
            ? epoch
            : Math.floor(Date.now() / 1000)
        );

        if (marketPrices.length > 70) {
          marketPrices.shift();
          marketTimes.shift();
        }

        if (marketRawPrices.length > 70) {
          marketRawPrices.shift();
        }

        updateLiveChart();
        updateDigitStrip();
        updateDemoMarketDisplay();

        setMarketStatus("Live market running");
      }
    };

    marketSocket.onerror = (error) => {
      console.error("Deriv market WebSocket error:", error);
      setMarketStatus("Market connection error");
    };

    marketSocket.onclose = () => {
      marketConnected = false;

      setMarketStatus(
        "Market disconnected. Reconnecting..."
      );

      scheduleMarketReconnect();
    };

  } catch (error) {
    console.error("Market connection failed:", error);

    setMarketStatus("Unable to connect to market");

    scheduleMarketReconnect();
  }
}

// ==========================================
// MARKET RECONNECTION
// ==========================================

function scheduleMarketReconnect() {
  clearTimeout(marketReconnectTimer);

  marketReconnectTimer = setTimeout(() => {
    connectDerivMarket();
  }, marketReconnectDelay);

  marketReconnectDelay = Math.min(
    marketReconnectDelay * 2,
    30000
  );
}

// ==========================================
// MARKET STATUS DISPLAY
// ==========================================

function setMarketStatus(status) {
  const statusElement = $("marketStatus");

  if (statusElement) {
    statusElement.textContent = status;
  }
}

// ==========================================
// UPDATE LIVE CHART
// ==========================================

function updateLiveChart() {
  if (!marketPrices.length) return;

  const latestPrice =
    marketPrices[marketPrices.length - 1];

  if (chart) {
    chart.data.labels = marketPrices.map(
      (_, index) => index
    );

    chart.data.datasets[0].data = [...marketPrices];

    chart.update("none");
  }

  const priceElement = $("marketPrice");

  if (priceElement) {
    priceElement.textContent = latestPrice.toFixed(2);
  }

  if (marketPrices.length > 1) {
    const previousPrice =
      marketPrices[marketPrices.length - 2];

    const changeElement = $("marketChange");

    if (changeElement) {
      const change = latestPrice - previousPrice;

      changeElement.textContent =
        (change >= 0 ? "+" : "") + change.toFixed(2);

      changeElement.classList.toggle(
        "negative",
        change < 0
      );
    }
  }

  marketLastPrice = latestPrice;
  updateDigitStrip();
}

// ==========================================
// LIVE DIGIT STRIP
// ==========================================

function getLastDigit(price) {
  const digits = String(price).replace(/\D/g, "");

  return digits.length
    ? Number(digits[digits.length - 1])
    : null;
}

function renderDigits() {
  updateDigitStrip();
}

function updateDigitStrip() {
  const strip = $("digitStrip");

  if (!strip) return;

  const counts = Array(10).fill(0);

  const recentPrices = marketRawPrices.slice(-70);

  recentPrices.forEach(price => {
    const digit = getLastDigit(price);

    if (digit !== null) {
      counts[digit]++;
    }
  });

  const latestPrice =
    marketRawPrices[marketRawPrices.length - 1];

  const latestDigit =
    latestPrice !== undefined
      ? getLastDigit(latestPrice)
      : null;

  strip.innerHTML = counts.map((count, digit) => `
    <div class="digit ${digit === latestDigit ? "hot" : ""}">
      ${digit}
      <small>${count}</small>
    </div>
  `).join("");
}

// ==========================================
// STOP MARKET CONNECTION
// ==========================================

function stopDerivMarket() {
  clearTimeout(marketReconnectTimer);

  if (marketSocket) {
    marketSocket.onclose = null;
    marketSocket.close();
    marketSocket = null;
  }

  marketConnected = false;
}

// ==========================================
// LOGOUT
// ==========================================

async function signOut() {
  stopDerivMarket();

  if (supabaseClient) {
    const { error } =
      await supabaseClient.auth.signOut();

    if (error) {
      toast("Unable to log out. Please try again.");
      return;
    }
  }

  currentSession = null;
  currentProfile = {};

  showAuth();
  closeModals();
}

if ($("logoutBtn")) {
  $("logoutBtn").addEventListener("click", signOut);
}

if ($("profileLogoutBtn")) {
  $("profileLogoutBtn").addEventListener("click", signOut);
}

// ==========================================
// MODAL NAVIGATION
// ==========================================

function openDeposit() {
  if (!$("depositModal")) return;

  $("depositModal").hidden = false;

  updateDepositEstimate();

  setTimeout(() => {
    if ($("depositAmount")) $("depositAmount").focus();
  }, 30);
}

function closeModals() {
  if ($("depositModal")) $("depositModal").hidden = true;
  if ($("accountModal")) $("accountModal").hidden = true;
}

document.querySelectorAll("[data-open-deposit]")
  .forEach(btn => {
    btn.addEventListener("click", event => {
      event.preventDefault();
      openDeposit();
    });
  });

document.querySelectorAll("[data-close-modal]")
  .forEach(btn => {
    btn.addEventListener("click", closeModals);
  });

document.querySelectorAll("[data-close-account]")
  .forEach(btn => {
    btn.addEventListener("click", closeModals);
  });

if ($("depositModal")) {
  $("depositModal").addEventListener("click", event => {
    if (event.target === $("depositModal")) {
      closeModals();
    }
  });
}

if ($("accountModal")) {
  $("accountModal").addEventListener("click", event => {
    if (event.target === $("accountModal")) {
      closeModals();
    }
  });
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModals();
});

// ==========================================
// OTHER ACCOUNT PANELS
// ==========================================

function openAccountPanel(name) {
  const names = {
    withdraw: "Withdraw Funds",
    history: "Payment History",
    chat: "Trade Master AI Support",
    profile: "My Profile"
  };

  [
    "withdraw",
    "history",
    "chat",
    "profile"
  ].forEach(key => {
    const panel = $(key + "Panel");
    if (panel) panel.hidden = key !== name;
  });

  if ($("accountModalTitle")) {
    $("accountModalTitle").textContent =
      names[name] || "Account";
  }

  if ($("accountModalSubtitle")) {
    $("accountModalSubtitle").textContent =
      name === "profile"
        ? (currentProfile.email || "Your account")
        : "Trade Master";
  }

  if ($("accountModal")) {
    $("accountModal").hidden = false;
  }
}

document.querySelectorAll("[data-open-panel]")
  .forEach(btn => {
    btn.addEventListener("click", event => {
      event.preventDefault();
      openAccountPanel(btn.dataset.openPanel);
    });
  });

// ==========================================
// USD TO KES CONVERSION
// ==========================================

function updateDepositEstimate() {
  if (!$("depositAmount")) return;

  const amount = Math.max(
    0,
    Number($("depositAmount").value) || 0
  );

  const kes = amount * usdKesRate;

  if ($("depositFx")) {
    $("depositFx").textContent =
      "≈ KES " + kes.toLocaleString("en-KE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
  }

  if ($("depositBtn")) {
    $("depositBtn").textContent =
      "Deposit " + money(amount);
  }
}

if ($("depositAmount")) {
  $("depositAmount").addEventListener(
    "input",
    updateDepositEstimate
  );
}

// ==========================================
// PRESET AMOUNTS
// ==========================================

document.querySelectorAll("[data-amount]")
  .forEach(btn => {
    btn.addEventListener("click", () => {
      $("depositAmount").value = btn.dataset.amount;

      document.querySelectorAll("[data-amount]")
        .forEach(b => {
          b.classList.toggle("active", b === btn);
        });

      updateDepositEstimate();
    });
  });

// ==========================================
// FETCH CURRENT REFERENCE RATE
// ==========================================

async function loadExchangeRate() {
  try {
    const response = await fetch(
      "https://open.er-api.com/v6/latest/USD",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Rate unavailable");
    }

    const data = await response.json();

    if (data.rates && Number(data.rates.KES) > 0) {
      usdKesRate = Number(data.rates.KES);
    }

  } catch (error) {
    console.log("Using fallback USD/KES estimate.");
  }

  updateDepositEstimate();
}

// ==========================================
// MPESA DEPOSIT
// ==========================================

function normalizeKenyanPhone(raw) {
  let phone = String(raw || "")
    .replace(/[\s+()-]/g, "");

  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  }

  if (
    phone.startsWith("7") ||
    phone.startsWith("1")
  ) {
    phone = "254" + phone;
  }

  return /^254[17]\d{8}$/.test(phone)
    ? phone
    : null;
}

// ==========================================
// READ ACTUAL EDGE FUNCTION ERROR
// ==========================================

async function getDepositErrorMessage(error) {
  let message =
    error?.message ||
    "Unable to start the M-Pesa request.";

  console.error("M-Pesa function error:", error);

  if (error?.context) {
    try {
      let response = error.context;

      if (typeof response.clone === "function") {
        response = response.clone();
      }

      if (typeof response.json === "function") {
        const details = await response.json();

        if (
          Array.isArray(details.missing) &&
          details.missing.length > 0
        ) {
          return (
            "Missing configuration: " +
            details.missing.join(", ")
          );
        }

        if (details.error) return details.error;
        if (details.message) return details.message;

      } else if (typeof response === "string") {
        return response;
      }

    } catch (readError) {
      console.error(
        "Could not read Edge Function response:",
        readError
      );
    }
  }

  return message;
}

// ==========================================
// REQUEST MPESA PAYMENT
// ==========================================

if ($("depositBtn")) {
  $("depositBtn").addEventListener("click", async () => {
    const amountUsd = Number($("depositAmount").value);

    const phone = normalizeKenyanPhone(
      $("mpesaPhone").value
    );

    if (!Number.isFinite(amountUsd) || amountUsd < 1) {
      $("depositMsg").textContent =
        "Enter a valid deposit amount of at least $1.";
      return;
    }

    if (!phone) {
      $("depositMsg").textContent =
        "Enter a valid Kenyan M-Pesa number, for example 254712345678.";
      return;
    }

    if (!supabaseClient || !currentSession) {
      $("depositMsg").textContent =
        "Please log in before requesting a deposit.";
      return;
    }

    const amountKes = Math.round(amountUsd * usdKesRate);

    try {
      $("depositBtn").disabled = true;
      $("depositBtn").textContent = "Requesting M-Pesa...";

      const { data, error } =
        await supabaseClient.functions.invoke(
          "mpesa-stk-push",
          {
            body: {
              phone,
              amount: amountKes,
              amount_usd: amountUsd,
              currency: "KES"
            }
          }
        );

      if (error) {
        const actualMessage =
          await getDepositErrorMessage(error);

        throw new Error(actualMessage);
      }

      if (!data) {
        throw new Error(
          "The payment function returned an empty response."
        );
      }

      if (data.error) {
        throw new Error(data.error);
      }

      $("depositMsg").textContent =
        data.message ||
        "M-Pesa request submitted. Check your phone and approve only if the amount and business details are correct.";

      toast("M-Pesa request sent. Await payment confirmation.");

    } catch (error) {
      console.error("Deposit request failed:", error);

      $("depositMsg").textContent =
        error.message ||
        "Unable to start the M-Pesa request.";

      toast(error.message || "M-Pesa request failed.");

    } finally {
      $("depositBtn").disabled = false;
      updateDepositEstimate();
    }
  });
}

// ==========================================
// MARKET CHART
// ==========================================

function renderChart() {
  const canvas = $("marketChart");

  if (!canvas || !window.Chart) {
    console.error("Chart.js or market canvas is missing.");
    return;
  }

  if (chart) chart.destroy();

  chart = new Chart(canvas, {
    type: "line",

    data: {
      labels: [],

      datasets: [{
        label: DERIV_MARKET_NAME,
        data: [],
        borderColor: "#00c49a",
        backgroundColor: "rgba(0,196,154,.08)",
        borderWidth: 1.8,
        pointRadius: 0,
        tension: 0.15,
        fill: true
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,

      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },

      scales: {
        x: {
          display: false,
          grid: { display: false }
        },

        y: {
          position: "right",
          ticks: {
            color: "#8b98ac",
            maxTicksLimit: 6,
            font: { size: 9 }
          },
          grid: {
            color: "rgba(100,120,150,.10)"
          }
        }
      }
    }
  });

  if ($("marketPrice")) {
    $("marketPrice").textContent = "Connecting...";
  }
}

// ==========================================
// CLOCK
// ==========================================

function updateClock() {
  if ($("clock")) {
    $("clock").textContent =
      new Date().toLocaleTimeString();
  }
}

setInterval(updateClock, 1000);
updateClock();

// ==========================================
// STAKE AND PAYOUT
// ==========================================

function updatePayout() {
  if (!$("stake")) return;

  const stake = Math.max(
    0,
    Number($("stake").value) || 0
  );

  const payout = money(stake * 1.9522);

  if ($("evenPayout")) {
    $("evenPayout").textContent = payout;
  }

  if ($("oddPayout")) {
    $("oddPayout").textContent = payout;
  }
}

if ($("stake")) {
  $("stake").addEventListener("input", updatePayout);
}

if ($("minusStake")) {
  $("minusStake").addEventListener("click", () => {
    $("stake").value = Math.max(
      0.35,
      (Number($("stake").value) || 1) - 0.1
    ).toFixed(2);

    updatePayout();
  });
}

if ($("plusStake")) {
  $("plusStake").addEventListener("click", () => {
    $("stake").value = (
      (Number($("stake").value) || 1) + 0.1
    ).toFixed(2);

    updatePayout();
  });
}

// ==========================================
// TRADE MODE AND STAKE MODE
// ==========================================

["tradeMode", "stakeMode"].forEach(id => {
  const container = $(id);
  if (!container) return;

  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach(b => {
        b.classList.remove("chosen");
      });

      btn.classList.add("chosen");
    });
  });
});

// ==========================================
// OPEN / CLOSED / TRANSACTIONS
// ==========================================

document.querySelectorAll(".tabs .tab")
  .forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs .tab")
        .forEach(b => b.classList.remove("selected"));

      btn.classList.add("selected");

      const states = {
        open: [
          "No open positions",
          "Your active trades will appear here"
        ],
        closed: [
          "No closed positions",
          "Your completed trades will appear here"
        ],
        transactions: [
          "No transactions yet",
          "Your account activity will appear here"
        ]
      };

      const [title, sub] =
        states[btn.dataset.tab] || states.open;

      if ($("positionsState")) {
        $("positionsState").innerHTML = `
          <div class="target">◎</div>
          <strong>${title}</strong>
          <span>${sub}</span>
        `;
      }
    });
  });

// ==========================================
// THEME
// ==========================================

if ($("themeBtn")) {
  $("themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("light");
  });
}

// ==========================================
// AI SCANNER
// ==========================================

if ($("scannerBtn")) {
  $("scannerBtn").addEventListener("click", () => {
    toast(
      "Scanner is in preview mode until its analysis engine is connected."
    );
  });
}

// ==========================================
// TRADE MASTER AI SUPPORT
// ==========================================

function addChatMessage(text, who) {
  const box = $("aiMessages");
  if (!box) return;

  const div = document.createElement("div");

  div.className =
    "ai-message " +
    (who === "user" ? "user-message" : "bot-message");

  const strong = document.createElement("strong");

  strong.textContent =
    who === "user" ? "You" : "TM AI";

  const p = document.createElement("p");
  p.textContent = text;

  div.append(strong, p);
  box.append(div);

  box.scrollTop = box.scrollHeight;
}

function answerQuestion(q) {
  const s = q.toLowerCase();

  if (s.includes("even") || s.includes("odd")) {
    return "Even/Odd contracts predict whether the last digit of a market tick is even or odd. Demo trades on Trade Master are simulated and do not represent official Deriv contracts.";
  }

  if (s.includes("volatil")) {
    return "Volatility describes how much and how quickly prices move. Higher volatility can mean larger, faster price changes and higher risk.";
  }

  if (s.includes("risk")) {
    return "Use only money you can afford to lose, set limits before trading, avoid chasing losses and understand the contract before placing an order.";
  }

  if (s.includes("scanner")) {
    return "The scanner area is currently a preview. It needs a verified analysis engine before it can analyse live prices.";
  }

  return "I can help with platform guidance, Even/Odd basics, volatility and risk-management education. This assistant is not connected to a live AI service.";
}

// ==========================================
// QUICK QUESTIONS
// ==========================================

document.querySelectorAll("[data-ai-question]")
  .forEach(btn => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.aiQuestion;

      addChatMessage(q, "user");
      addChatMessage(answerQuestion(q), "bot");
    });
  });

// ==========================================
// CHAT FORM
// ==========================================

if ($("aiChatForm")) {
  $("aiChatForm").addEventListener("submit", event => {
    event.preventDefault();

    const q = $("aiInput").value.trim();
    if (!q) return;

    addChatMessage(q, "user");
    addChatMessage(answerQuestion(q), "bot");

    $("aiInput").value = "";
  });
}

// ==========================================
// CLEAR CHAT
// ==========================================

if ($("clearAIChat")) {
  $("clearAIChat").addEventListener("click", () => {
    $("aiMessages").innerHTML = "";

    addChatMessage(
      "Hello! Welcome to Trade Master. How can I help you today?",
      "bot"
    );
  });
}

// ==========================================
// PROFILE EDITING
// ==========================================

function setProfileEditing(enabled) {
  ["profileName", "profilePhone", "profileAge"]
    .forEach(id => {
      if ($(id)) $(id).readOnly = !enabled;
    });

  if ($("editProfileBtn")) $("editProfileBtn").hidden = enabled;
  if ($("saveProfileBtn")) $("saveProfileBtn").hidden = !enabled;
  if ($("cancelProfileBtn")) $("cancelProfileBtn").hidden = !enabled;
}

if ($("editProfileBtn")) {
  $("editProfileBtn").addEventListener("click", () => {
    setProfileEditing(true);

    $("profileMessage").textContent =
      "Edit your name, phone number or age, then save.";
  });
}

if ($("cancelProfileBtn")) {
  $("cancelProfileBtn").addEventListener("click", () => {
    $("profileName").value = currentProfile.name || "";
    $("profilePhone").value = currentProfile.phone || "";
    $("profileAge").value = currentProfile.age || "";

    setProfileEditing(false);

    $("profileMessage").textContent = "Changes cancelled.";
  });
}

if ($("saveProfileBtn")) {
  $("saveProfileBtn").addEventListener("click", async () => {
    if (!supabaseClient) return;

    const name = $("profileName").value.trim();
    const phone = $("profilePhone").value.trim();
    const age = Number($("profileAge").value);

    if (!name || !phone || !age || age < 18 || age > 100) {
      $("profileMessage").textContent =
        "Enter a valid name, phone number and age (18+).";
      return;
    }

    try {
      $("saveProfileBtn").disabled = true;

      const { error } =
        await supabaseClient.auth.updateUser({
          data: {
            full_name: name,
            phone,
            age
          }
        });

      if (error) throw error;

      currentProfile.name = name;
      currentProfile.phone = phone;
      currentProfile.age = age;

      $("profileMessage").textContent =
        "Profile updated successfully.";

      setProfileEditing(false);
      toast("Profile updated.");

    } catch (error) {
      console.error("Profile update error:", error);

      $("profileMessage").textContent =
        error.message || "Unable to update profile.";

    } finally {
      $("saveProfileBtn").disabled = false;
    }
  });
}

// =====================================================
// DEMO ACCOUNT STYLES
// =====================================================

function addDemoStyles() {
  if ($("demoTradingStyles")) return;

  const style = document.createElement("style");
  style.id = "demoTradingStyles";

  style.textContent = `
    .tm-account-switch {
      display:flex;
      align-items:center;
      gap:6px;
      padding:7px;
      background:#172333;
      border:1px solid #34465c;
      border-radius:12px;
      margin:8px 0;
    }

    .tm-account-switch button {
      border:0;
      border-radius:8px;
      padding:9px 14px;
      color:#aab7c8;
      background:transparent;
      font-weight:800;
      cursor:pointer;
    }

    .tm-account-switch button.active {
      background:#087f68;
      color:white;
    }

    .tm-demo-panel {
      margin:12px 0;
      padding:14px;
      border:1px solid #30435a;
      border-radius:14px;
      background:#142131;
      color:#f1f5f9;
    }

    .tm-demo-panel h3 {
      margin:0 0 8px;
      font-size:15px;
      color:#f1f5f9;
    }

    .tm-demo-balance {
      font-size:24px;
      font-weight:900;
      margin:8px 0;
      color:#42d4b7;
    }

    .tm-demo-market {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      padding:10px;
      margin-top:12px;
      background:#0b1626;
      border:1px solid #30435a;
      border-radius:10px;
    }

    .tm-demo-market-price {
      font-size:17px;
      font-weight:900;
      color:#f1f5f9;
    }

    .tm-demo-market-digit {
      width:36px;
      height:36px;
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:50%;
      background:#087f68;
      color:white;
      font-size:18px;
      font-weight:900;
    }

    .tm-demo-actions {
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:10px;
      margin-top:12px;
    }

    .tm-demo-actions button {
      min-height:48px;
      border:0;
      border-radius:10px;
      font-weight:900;
      cursor:pointer;
      color:white;
    }

    .tm-demo-even {
      background:#087f68;
    }

    .tm-demo-odd {
      background:#2765bb;
    }

    .tm-demo-actions button:disabled {
      opacity:.5;
      cursor:not-allowed;
    }

    .tm-demo-result {
      margin-top:12px;
      padding:12px;
      border-radius:10px;
      display:none;
      font-weight:900;
    }

    .tm-demo-result.win {
      display:block;
      color:#42e6a4;
      background:rgba(0,200,130,.12);
      border:1px solid rgba(0,220,150,.35);
      box-shadow:0 0 18px rgba(0,220,150,.25);
      animation:tmWinGlow 1.4s ease-in-out infinite alternate;
    }

    .tm-demo-result.loss {
      display:block;
      color:#ff6675;
      background:rgba(255,60,80,.12);
      border:1px solid rgba(255,60,80,.35);
      box-shadow:0 0 18px rgba(255,60,80,.22);
      animation:tmLossGlow 1.4s ease-in-out infinite alternate;
    }

    .tm-demo-result.pending {
      display:block;
      color:#f3c969;
      background:rgba(243,201,105,.10);
      border:1px solid rgba(243,201,105,.25);
    }

    @keyframes tmWinGlow {
      from { box-shadow:0 0 5px rgba(0,220,150,.12); }
      to { box-shadow:0 0 20px rgba(0,220,150,.4); }
    }

    @keyframes tmLossGlow {
      from { box-shadow:0 0 5px rgba(255,60,80,.12); }
      to { box-shadow:0 0 20px rgba(255,60,80,.4); }
    }

    .tm-demo-history {
      margin-top:14px;
      font-size:12px;
    }

    .tm-demo-history-row {
      display:flex;
      justify-content:space-between;
      gap:8px;
      padding:10px 0;
      border-bottom:1px solid #30435a;
    }

    .tm-demo-history-row .won {
      color:#42e6a4;
      font-weight:900;
    }

    .tm-demo-history-row .lost {
      color:#ff6675;
      font-weight:900;
    }

    .tm-demo-history-row .open {
      color:#f3c969;
      font-weight:900;
    }

    .tm-demo-hidden {
      display:none!important;
    }

    @media(max-width:600px) {
      .tm-demo-panel {
        width:100%;
        padding:12px;
      }

      .tm-demo-balance {
        font-size:22px;
      }
    }
  `;

  document.head.appendChild(style);
}

// =====================================================
// CREATE DEMO ACCOUNT INTERFACE
// =====================================================

function createDemoInterface() {
  if ($("tmAccountSwitch")) return;

  addDemoStyles();

  const topActions = document.querySelector(".top-actions");

  const switcher = document.createElement("div");
  switcher.id = "tmAccountSwitch";
  switcher.className = "tm-account-switch";

  switcher.innerHTML = `
    <button type="button" id="tmRealMode" class="active">
      R Real
    </button>

    <button type="button" id="tmDemoMode">
      D Demo
    </button>
  `;

  if (topActions) {
    topActions.prepend(switcher);
  } else if ($("app")) {
    $("app").prepend(switcher);
  }

  const panel = document.createElement("section");
  panel.id = "tmDemoPanel";
  panel.className = "tm-demo-panel tm-demo-hidden";

  panel.innerHTML = `
    <h3>Demo Trading Account</h3>

    <div class="tm-demo-balance" id="tmDemoBalance">
      $10,000.00
    </div>

    <small>Virtual funds · Simulated trading</small>

    <div class="tm-demo-market">
      <div>
        <small>Live market price</small>
        <div class="tm-demo-market-price" id="tmDemoMarketPrice">
          Waiting for market...
        </div>
      </div>

      <div>
        <small>Last digit</small>
        <div class="tm-demo-market-digit" id="tmDemoMarketDigit">
          -
        </div>
      </div>
    </div>

    <div class="tm-demo-actions">
      <button type="button"
        class="tm-demo-even"
        id="tmDemoEven">
        EVEN
      </button>

      <button type="button"
        class="tm-demo-odd"
        id="tmDemoOdd">
        ODD
      </button>
    </div>

    <div id="tmDemoResult" class="tm-demo-result"></div>

    <div class="tm-demo-history">
      <strong>Demo Trade History</strong>
      <div id="tmDemoHistory">
        Loading history...
      </div>
    </div>
  `;

  const workspace = document.querySelector(".workspace");

  if (workspace) {
    workspace.prepend(panel);
  } else if ($("app")) {
    $("app").appendChild(panel);
  }

  $("tmRealMode").addEventListener("click", () => {
    switchTradeMasterAccount("REAL");
  });

  $("tmDemoMode").addEventListener("click", () => {
    switchTradeMasterAccount("DEMO");
  });

  $("tmDemoEven").addEventListener("click", () => {
    placeTradeMasterDemoTrade("EVEN");
  });

  $("tmDemoOdd").addEventListener("click", () => {
    placeTradeMasterDemoTrade("ODD");
  });

  updateDemoMarketDisplay();
}

// =====================================================
// DISPLAY LIVE MARKET IN DEMO PANEL
// =====================================================

function updateDemoMarketDisplay() {
  const priceElement = $("tmDemoMarketPrice");
  const digitElement = $("tmDemoMarketDigit");

  if (!priceElement || !digitElement) return;

  if (!marketRawPrices.length) {
    priceElement.textContent = "Waiting for market...";
    digitElement.textContent = "-";
    return;
  }

  const latestRaw =
    marketRawPrices[marketRawPrices.length - 1];

  const latestDigit = getLastDigit(latestRaw);

  priceElement.textContent = String(latestRaw);

  digitElement.textContent =
    latestDigit === null ? "-" : String(latestDigit);
}

// =====================================================
// SWITCH REAL / DEMO
// =====================================================

async function switchTradeMasterAccount(mode) {
  if (mode !== "REAL" && mode !== "DEMO") return;

  tradeMasterAccountMode = mode;

  $("tmRealMode").classList.toggle(
    "active",
    mode === "REAL"
  );

  $("tmDemoMode").classList.toggle(
    "active",
    mode === "DEMO"
  );

  $("tmDemoPanel").classList.toggle(
    "tm-demo-hidden",
    mode !== "DEMO"
  );

  const balanceElement = $("balanceValue");

  if (mode === "DEMO") {
    if (balanceElement) {
      balanceElement.textContent = "DEMO ACCOUNT";
    }

    await loadTradeMasterDemoWallet();
    await loadTradeMasterDemoHistory();

  } else {
    loadDerivAccounts();
  }
}

// =====================================================
// LOAD DEMO WALLET FROM SUPABASE
// =====================================================

async function loadTradeMasterDemoWallet() {
  if (!supabaseClient || !currentSession) return;

  const { data, error } = await supabaseClient
    .from("demo_wallets")
    .select("balance,currency")
    .eq("user_id", currentSession.user.id)
    .maybeSingle();

  if (error) {
    console.error("Demo wallet error:", error);
    toast("Unable to load Demo wallet.");
    return;
  }

  if (!data) {
    toast("Demo wallet not found. Please contact support.");
    return;
  }

  demoWalletBalance = Number(data.balance);

  if ($("tmDemoBalance")) {
    $("tmDemoBalance").textContent =
      money(demoWalletBalance);
  }
}

// =====================================================
// CHECK FOR UNSETTLED DEMO TRADES
// =====================================================

async function hasOpenDemoTrade() {
  if (!supabaseClient || !currentSession) return false;

  const { data, error } = await supabaseClient
    .from("demo_trades")
    .select("id,status")
    .eq("user_id", currentSession.user.id)
    .eq("status", "OPEN")
    .limit(1);

  if (error) {
    console.error("Open Demo trade check failed:", error);
    throw new Error(
      "Unable to verify existing Demo trades. Please try again later."
    );
  }

  return Array.isArray(data) && data.length > 0;
}

// =====================================================
// LOAD DEMO TRADE HISTORY
// =====================================================

async function loadTradeMasterDemoHistory() {
  if (!supabaseClient || !currentSession) return;

  const history = $("tmDemoHistory");
  if (!history) return;

  history.textContent = "Loading history...";

  const { data, error } = await supabaseClient
    .from("demo_trades")
    .select(
      "id,contract_type,stake,status,payout,profit,created_at"
    )
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Demo history error:", error);
    history.textContent = "Unable to load trade history.";
    return;
  }

  if (!data || data.length === 0) {
    history.textContent = "No Demo trades yet.";
    return;
  }

  const hasOpen = data.some(
    trade => String(trade.status).toUpperCase() === "OPEN"
  );

  demoTradePending = hasOpen;

  history.innerHTML = data.map(trade => {
    const status = String(trade.status || "").toUpperCase();

    const resultClass =
      status === "WON" ? "won" :
      status === "LOST" ? "lost" : "open";

    const date = new Date(trade.created_at)
      .toLocaleString();

    let resultText = status;

    if (status === "WON") {
      resultText += " ↓ +" + money(trade.profit);
    } else if (status === "LOST") {
      resultText += " ↓ -" + money(trade.stake);
    } else if (status === "OPEN") {
      resultText = "PENDING";
    }

    return `
      <div class="tm-demo-history-row">
        <div>
          <strong>${trade.contract_type}</strong>
          <br>
          <small>${date}</small>
        </div>

        <div style="text-align:right">
          <strong>${money(trade.stake)}</strong>
          <br>
          <span class="${resultClass}">${resultText}</span>
        </div>
      </div>
    `;
  }).join("");

  updateDemoTradeButtons();
}

// =====================================================
// DISPLAY DEMO RESULT
// =====================================================

function showTradeMasterDemoResult(type, message) {
  const box = $("tmDemoResult");
  if (!box) return;

  box.className = "tm-demo-result " + type;
  box.textContent = message;
}

// =====================================================
// UPDATE DEMO TRADE BUTTONS
// =====================================================

function updateDemoTradeButtons() {
  const evenButton = $("tmDemoEven");
  const oddButton = $("tmDemoOdd");

  if (!evenButton || !oddButton) return;

  const disabled =
    demoTradeBusy ||
    demoTradePending ||
    tradeMasterAccountMode !== "DEMO";

  evenButton.disabled = disabled;
  oddButton.disabled = disabled;

  if (demoTradePending && !demoTradeBusy) {
    evenButton.textContent = "TRADE PENDING";
    oddButton.textContent = "TRADE PENDING";
  } else if (demoTradeBusy) {
    evenButton.textContent = "PLEASE WAIT...";
    oddButton.textContent = "PLEASE WAIT...";
  } else {
    evenButton.textContent = "EVEN";
    oddButton.textContent = "ODD";
  }
}

// =====================================================
// PLACE DEMO TRADE
// =====================================================

async function placeTradeMasterDemoTrade(contractType) {
  if (demoTradeBusy || demoTradePending) {
    toast("Please wait for the previous Demo trade to settle.");
    return;
  }

  if (!supabaseClient || !currentSession) {
    toast("Please log in first.");
    return;
  }

  if (tradeMasterAccountMode !== "DEMO") {
    toast("Switch to Demo account first.");
    return;
  }

  if (!marketConnected || !marketLastPrice) {
    toast("Wait for the live market to connect first.");
    return;
  }

  if (!["EVEN", "ODD"].includes(contractType)) {
    toast("Invalid Demo contract type.");
    return;
  }

  const stake = Number($("stake")?.value);

  if (!Number.isFinite(stake) || stake < 0.35) {
    toast("Minimum Demo stake is $0.35.");
    return;
  }

  if (stake > demoWalletBalance) {
    toast("Insufficient Demo balance.");
    return;
  }

  try {
    // Check Supabase before starting a new trade.
    const existingOpenTrade = await hasOpenDemoTrade();

    if (existingOpenTrade) {
      demoTradePending = true;

      showTradeMasterDemoResult(
        "pending",
        "An earlier Demo trade is still open. Do not submit another trade."
      );

      updateDemoTradeButtons();
      return;
    }

  } catch (error) {
    toast(error.message);
    return;
  }

  demoTradeBusy = true;
  updateDemoTradeButtons();

  showTradeMasterDemoResult(
    "pending",
    "Waiting for market entry and settlement..."
  );

  try {
    const { data, error } =
      await supabaseClient.functions.invoke(
        "demo-trade",
        {
          body: {
            contract_type: contractType,
            stake
          }
        }
      );

    if (error) throw error;

    if (!data) {
      throw new Error("Empty response from Demo trading server.");
    }

    if (data.error) {
      throw new Error(data.error);
    }

    if (
      String(data.status).toUpperCase() === "PENDING" ||
      data.status === "OPEN"
    ) {
      demoTradePending = true;

      showTradeMasterDemoResult(
        "pending",
        "Trade is pending settlement. Do not submit another trade. Trade ID: " +
        (data.trade_id || "Not supplied")
      );

      await loadTradeMasterDemoWallet();
      await loadTradeMasterDemoHistory();

      return;
    }

    const status = String(data.status || "").toUpperCase();

    if (status !== "WON" && status !== "LOST") {
      throw new Error(
        "The server returned an unrecognized trade result."
      );
    }

    const won = status === "WON";

    const profit = Number(data.profit || 0);
    const payout = Number(data.payout || 0);

    if (won) {
      showTradeMasterDemoResult(
        "win",
        "↓ PROFIT +" + money(profit) +
        " · Payout " + money(payout)
      );
    } else {
      showTradeMasterDemoResult(
        "loss",
        "↓ LOSS -" + money(stake)
      );
    }

    demoTradePending = false;

    await loadTradeMasterDemoWallet();
    await loadTradeMasterDemoHistory();

    toast(won ? "Demo trade won." : "Demo trade lost.");

  } catch (error) {
    console.error("Demo trade error:", error);

    // A network failure can happen after the server creates
    // a trade. Never automatically submit the same trade again.
    showTradeMasterDemoResult(
      "pending",
      "Result not confirmed. Checking your Demo trade history. Do not retry yet."
    );

    try {
      await loadTradeMasterDemoWallet();
      await loadTradeMasterDemoHistory();

      const openTrade = await hasOpenDemoTrade();

      if (openTrade) {
        demoTradePending = true;

        showTradeMasterDemoResult(
          "pending",
          "An unsettled Demo trade exists. Wait for settlement before placing another trade."
        );
      } else {
        showTradeMasterDemoResult(
          "pending",
          "The result could not be confirmed. Check your history before trying again."
        );
      }

    } catch (checkError) {
      console.error("Trade verification error:", checkError);
    }

  } finally {
    demoTradeBusy = false;
    updateDemoTradeButtons();
  }
}

// =====================================================
// INITIALIZE DEMO INTERFACE
// =====================================================

function initializeTradeMasterDemo() {
  if (!currentSession || !$("app")) return;

  createDemoInterface();

  loadTradeMasterDemoWallet();
  loadTradeMasterDemoHistory();

  updateDemoMarketDisplay();
}

// =====================================================
// RESTORE SUPABASE SESSION
// =====================================================

(async function init() {
  updatePayout();
  updateDepositEstimate();

  if (!supabaseClient) {
    authMessage(
      "Supabase connection unavailable. Check that the Supabase JavaScript library is loaded in index.html and that your project details are correct."
    );

    return;
  }

  try {
    const {
      data,
      error
    } = await supabaseClient.auth.getSession();

    if (error) throw error;

    if (data.session) {
      currentSession = data.session;

      await loadProfile();
      enterDashboard();

    } else {
      showAuth();
    }

  } catch (error) {
    console.error("Session restoration error:", error);

    authMessage(
      error.message || "Unable to restore your session."
    );

    showAuth();
  }
})();

// ==========================================
// AUTH STATE CHANGES
// ==========================================

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(
    (event, session) => {
      currentSession = session;

      if (event === "SIGNED_OUT") {
        currentProfile = {};
        demoTradePending = false;

        stopDerivMarket();
        showAuth();
      }
    }
  );
}

console.log("Trade Master application script loaded.");
console.log("Trade Master Demo module loaded.");
