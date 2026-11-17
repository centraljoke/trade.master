/* ==========================================
TRADE MASTER
SUPABASE + MPESA + DERIV + LIVE MARKET
========================================== */
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
let chartPoints = [];
let usdKesRate = 130.03;
// ==========================================
// DERIV LIVE MARKET CONFIGURATION
// ==========================================
const DERIV_MARKET_SYMBOL = "1HZ10V";
const DERIV_MARKET_NAME = "Volatility 10 (1s) Index";
const DERIV_PUBLIC_WS =
"wss://api.derivws.com/trading/v1/options/ws/public";
let marketSocket = null;
let marketReconnectTimer = null;
let marketReconnectDelay = 3000;
let marketHistoryLoaded = false;
let marketConnected = false;
let marketPrices = [];
let marketTimes = [];
let marketLastPrice = null;
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
$("app").hidden = true;
$("authPage").hidden = false;
window.scrollTo(0, 0);
}
function showApp() {
$("authPage").hidden = true;
$("app").hidden = false;
window.scrollTo(0, 0);
}
// ==========================================
// SIGNUP / LOGIN SWITCH
// ==========================================
function setSignupMode() {
isSignup = !isSignup;
["nameField", "phoneField", "ageField"].forEach(id => {
$(id).hidden = !isSignup;
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
$("switchAuth").addEventListener(
"click",
setSignupMode
);
// ==========================================
// AUTHENTICATION
// ==========================================
$("authForm").addEventListener("submit", async (event) => {
event.preventDefault();
if (!supabaseClient) {
return authMessage(
"Supabase connection is unavailable. Check your Supabase library and configuration."
);
}
const email = $("authEmail").value.trim().toLowerCase();
const password = $("authPassword").value;
try {
$("authSubmit").disabled = true;
$("authSubmit").textContent = "Please wait...";
if (isSignup) { const age = Number($("authAge").value); if ( !$("fullName").value.trim() || !$("authPhone").value.trim() || !age || age < 18 || age > 100 ) { throw new Error( "Enter your name, phone number and a valid age (18+)." ); } const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: $("fullName").value.trim(), phone: $("authPhone").value.trim(), age: age } } }); if (error) throw error; if (!data.session) { authMessage( "Account created. Check your email to confirm, then log in.", false ); return; } currentSession = data.session; } else { const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password }); if (error) throw error; currentSession = data.session; } await loadProfile(); enterDashboard(); 
} catch (error) {
authMessage(error.message || "Unable to authenticate.");
} finally {
$("authSubmit").disabled = false;
$("authSubmit").textContent = isSignup ? "Create Account" : "Login"; 
}
});
// ==========================================
// LOAD USER PROFILE
// ==========================================
async function loadProfile() {
const {
data: { user },
error
} = await supabaseClient.auth.getUser();
if (error) throw error;
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
$("profileName").value = currentProfile.name || "";
$("profileEmail").value = currentProfile.email || "";
$("profilePhone").value = currentProfile.phone || "";
$("profileAge").value = currentProfile.age || "";
$("profileBalance").value = "Loading REAL balance...";
$("balanceValue").textContent = "Loading REAL balance...";
renderChart();
renderDigits();
loadExchangeRate();
loadDerivAccounts();
connectDerivMarket();
}
// ==========================================
// LOAD REAL DERIV ACCOUNT BALANCE ONLY
// ==========================================
async function loadDerivAccounts() {
if (!supabaseClient || !currentSession) {
return;
}
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
{
body: {}
}
);
if (error) throw error; if (!data || !data.success) { throw new Error( data?.error || "Could not retrieve Deriv accounts." ); } const response = data.accounts; let accounts = []; if (Array.isArray(response)) { accounts = response; } else if (Array.isArray(response?.data)) { accounts = response.data; } else if (Array.isArray(response?.data?.accounts)) { accounts = response.data.accounts; } else if (Array.isArray(response?.accounts)) { accounts = response.accounts; } // IDENTIFY REAL ACCOUNTS const realAccounts = accounts.filter(account => { const type = String( account.account_type || account.type || "" ).toLowerCase(); return ( type === "real" || type.includes("real_money") || account.is_virtual === false ); }); if (realAccounts.length === 0) { throw new Error( "No REAL Deriv account was found." ); } const accountLines = realAccounts.map(account => { const amount = Number(account.balance); const currency = account.currency || "USD"; if (!Number.isFinite(amount)) { throw new Error( "Deriv returned an invalid REAL account balance." ); } return ( `${currency} ` + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ); }); const display = accountLines.join(" | "); if (balanceElement) { balanceElement.textContent = display; } if (profileBalanceElement) { profileBalanceElement.value = display; } console.log( "REAL Deriv accounts loaded:", realAccounts.length ); toast("REAL Deriv balance loaded."); 
} catch (error) {
console.error("Deriv balance error:", error);
if (balanceElement) { balanceElement.textContent = "REAL balance unavailable"; } if (profileBalanceElement) { profileBalanceElement.value = "Unavailable"; } toast( error.message || "Unable to load REAL balance." ); 
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
marketSocket.onopen = () => { marketConnected = true; marketReconnectDelay = 3000; setMarketStatus("Live market connected"); console.log("Deriv market connected."); // REQUEST HISTORICAL MARKET PRICES marketSocket.send(JSON.stringify({ ticks_history: DERIV_MARKET_SYMBOL, count: 70, end: "latest", style: "ticks", req_id: 1 })); }; marketSocket.onmessage = (event) => { let message; try { message = JSON.parse(event.data); } catch (error) { console.error("Invalid market response:", error); return; } if (message.error) { console.error( "Deriv market error:", message.error ); setMarketStatus( message.error.message || "Market feed error" ); return; } // HISTORICAL DATA if (message.history) { const prices = message.history.prices || []; const times = message.history.times || []; marketPrices = prices.map(Number).filter(Number.isFinite); marketTimes = times.map(Number); marketHistoryLoaded = true; updateLiveChart(); // SUBSCRIBE TO LIVE TICKS if ( marketSocket && marketSocket.readyState === WebSocket.OPEN ) { marketSocket.send(JSON.stringify({ ticks: DERIV_MARKET_SYMBOL, subscribe: 1, req_id: 2 })); } setMarketStatus("Live market running"); console.log( "Market history loaded:", marketPrices.length ); return; } // LIVE TICK DATA if (message.tick) { const price = Number(message.tick.quote); const epoch = Number(message.tick.epoch); if (!Number.isFinite(price)) return; marketLastPrice = price; marketPrices.push(price); marketTimes.push( Number.isFinite(epoch) ? epoch : Math.floor(Date.now() / 1000) ); // KEEP THE LATEST 70 PRICES if (marketPrices.length > 70) { marketPrices.shift(); marketTimes.shift(); } updateLiveChart(); setMarketStatus("Live market running"); return; } if (message.msg_type === "ping") { return; } }; marketSocket.onerror = (error) => { console.error("Deriv market WebSocket error:", error); setMarketStatus("Market connection error"); }; marketSocket.onclose = () => { marketConnected = false; marketHistoryLoaded = false; setMarketStatus("Market disconnected. Reconnecting..."); console.log("Deriv market disconnected."); scheduleMarketReconnect(); }; 
} catch (error) {
console.error("Market connection failed:", error);
setMarketStatus("Unable to connect to market"); scheduleMarketReconnect(); 
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
console.log("Market status:", status);
}
// ==========================================
// UPDATE LIVE CHART
// ==========================================
function updateLiveChart() {
if (!marketPrices.length) return;
const latestPrice = marketPrices[
marketPrices.length - 1
];
if (chart) {
chart.data.labels = marketPrices.map(
(_, index) => index
);
chart.data.datasets[0].data = [...marketPrices]; chart.update("none"); 
}
const priceElement = $("marketPrice");
if (priceElement) {
priceElement.textContent = latestPrice.toFixed(2);
}
marketLastPrice = latestPrice;
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
const { error } = await supabaseClient.auth.signOut();
if (error) { toast("Unable to log out. Please try again."); return; } 
}
currentSession = null;
currentProfile = {};
showAuth();
closeModals();
}
$("logoutBtn").addEventListener("click", signOut);
$("profileLogoutBtn").addEventListener("click", signOut);
// ==========================================
// MODAL NAVIGATION
// ==========================================
function openDeposit() {
$("depositModal").hidden = false;
updateDepositEstimate();
setTimeout(() => {
$("depositAmount").focus();
}, 30);
}
function closeModals() {
$("depositModal").hidden = true;
$("accountModal").hidden = true;
}
// OPEN DEPOSIT
document.querySelectorAll("[data-open-deposit]").forEach(btn => {
btn.addEventListener("click", (event) => {
event.preventDefault();
openDeposit();
});
});
// CLOSE DEPOSIT
document.querySelectorAll("[data-close-modal]").forEach(btn => {
btn.addEventListener("click", closeModals);
});
// CLOSE ACCOUNT
document.querySelectorAll("[data-close-account]").forEach(btn => {
btn.addEventListener("click", closeModals);
});
$("depositModal").addEventListener("click", event => {
if (event.target === $("depositModal")) {
closeModals();
}
});
$("accountModal").addEventListener("click", event => {
if (event.target === $("accountModal")) {
closeModals();
}
});
document.addEventListener("keydown", event => {
if (event.key === "Escape") {
closeModals();
}
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
["withdraw", "history", "chat", "profile"].forEach(key => {
$(key + "Panel").hidden = key !== name;
});
$("accountModalTitle").textContent =
names[name] || "Account";
$("accountModalSubtitle").textContent =
name === "profile"
? (currentProfile.email || "Your account")
: "Trade Master";
$("accountModal").hidden = false;
}
document.querySelectorAll("[data-open-panel]").forEach(btn => {
btn.addEventListener("click", event => {
event.preventDefault();
openAccountPanel(btn.dataset.openPanel);
});
});
// ==========================================
// USD TO KES CONVERSION
// ==========================================
function updateDepositEstimate() {
const amount = Math.max(
0,
Number($("depositAmount").value) || 0
);
const kes = amount * usdKesRate;
$("depositFx").textContent =
"≈ KES " + kes.toLocaleString("en-KE", {
minimumFractionDigits: 2,
maximumFractionDigits: 2
});
$("depositBtn").textContent =
"Deposit " + money(amount);
}
// UPDATE WHEN AMOUNT CHANGES
$("depositAmount").addEventListener(
"input",
updateDepositEstimate
);
// ==========================================
// PRESET AMOUNTS
// ==========================================
document.querySelectorAll("[data-amount]").forEach(btn => {
btn.addEventListener("click", () => {
$("depositAmount").value = btn.dataset.amount;
document.querySelectorAll("[data-amount]").forEach(b => { b.classList.toggle("active", b === btn); }); updateDepositEstimate(); 
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
if (!response.ok) { throw new Error("Rate unavailable"); } const data = await response.json(); if (data.rates && Number(data.rates.KES) > 0) { usdKesRate = Number(data.rates.KES); } 
} catch (error) {
console.log("Using fallback USD/KES estimate.");
}
updateDepositEstimate();
}
// ==========================================
// MPESA DEPOSIT
// ==========================================
// NORMALIZE KENYAN PHONE NUMBER
function normalizeKenyanPhone(raw) {
let phone = String(raw || "").replace(/[\s+()-]/g, "");
if (phone.startsWith("0")) {
phone = "254" + phone.slice(1);
}
if (phone.startsWith("7") || phone.startsWith("1")) {
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
error?.message || "Unable to start the M-Pesa request.";
console.error("M-Pesa function error:", error);
if (error?.context) {
try {
let response = error.context;
if (typeof response.clone === "function") { response = response.clone(); } if (typeof response.json === "function") { const details = await response.json(); if ( Array.isArray(details.missing) && details.missing.length > 0 ) { return "Missing configuration: " + details.missing.join(", "); } if (details.error) { return details.error; } if (details.message) { return details.message; } } else if (typeof response === "string") { return response; } } catch (readError) { console.error( "Could not read Edge Function response:", readError ); } 
}
return message;
}
// ==========================================
// REQUEST MPESA PAYMENT
// ==========================================
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
"Please log in with your Supabase account before requesting a deposit.";
return;
}
const amountKes = Math.round(amountUsd * usdKesRate);
try {
$("depositBtn").disabled = true;
$("depositBtn").textContent = "Requesting M-Pesa...";
const { data, error } = await supabaseClient.functions.invoke( "mpesa-stk-push", { body: { phone: phone, amount: amountKes, amount_usd: amountUsd, currency: "KES" } } ); if (error) { const actualMessage = await getDepositErrorMessage(error); throw new Error(actualMessage); } if (!data) { throw new Error( "The payment function returned an empty response." ); } if (data.error) { throw new Error(data.error); } $("depositMsg").textContent = data.message || "M-Pesa request submitted. Check your phone and approve only if the amount and business details are correct."; toast("M-Pesa request sent. Await payment confirmation."); 
} catch (error) {
console.error("Deposit request failed:", error);
$("depositMsg").textContent = error.message || "Unable to start the M-Pesa request. Please try again."; toast( error.message || "M-Pesa request failed." ); 
} finally {
$("depositBtn").disabled = false;
updateDepositEstimate();
}
});
// ==========================================
// MARKET CHART
// LIVE DERIV DATA - NO RANDOM PREVIEW DATA
// ==========================================
function renderChart() {
const canvas = $("marketChart");
if (!canvas || !window.Chart) return;
if (chart) {
chart.destroy();
}
chartPoints = [];
chart = new Chart(canvas, {
type: "line",
data: { labels: [], datasets: [{ label: DERIV_MARKET_NAME, data: [], borderColor: "#00c49a", backgroundColor: "rgba(0,196,154,.08)", borderWidth: 1.8, pointRadius: 0, tension: 0.15, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: true } }, scales: { x: { display: false, grid: { display: false } }, y: { position: "right", ticks: { color: "#8b98ac", maxTicksLimit: 6, font: { size: 9 } }, grid: { color: "rgba(100,120,150,.10)" } } } } 
});
const priceElement = $("marketPrice");
if (priceElement) {
priceElement.textContent = "Connecting...";
}
}
// ==========================================
// DIGIT STRIP
// ==========================================
function renderDigits() {
$("digitStrip").innerHTML =
Array.from({ length: 10 }, (_, i) => <div class="digit ${i === 7 ? "hot" : ""}"> ${i} <small>--</small> </div> ).join("");
}
// ==========================================
// CLOCK
// ==========================================
function updateClock() {
$("clock").textContent =
new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();
// ==========================================
// STAKE AND PAYOUT
// ==========================================
$("stake").addEventListener("input", updatePayout);
function updatePayout() {
const stake = Math.max(
0,
Number($("stake").value) || 0
);
const payout = money(stake * 1.9522);
$("evenPayout").textContent = payout;
$("oddPayout").textContent = payout;
}
$("minusStake").addEventListener("click", () => {
$("stake").value = Math.max(
0.35,
(Number($("stake").value) || 1) - 0.1
).toFixed(2);
updatePayout();
});
$("plusStake").addEventListener("click", () => {
$("stake").value = (
(Number($("stake").value) || 1) + 0.1
).toFixed(2);
updatePayout();
});
// ==========================================
// TRADE MODE AND STAKE MODE
// ==========================================
["tradeMode", "stakeMode"].forEach(id => {
$(id).querySelectorAll("button").forEach(btn => {
btn.addEventListener("click", () => {
$(id).querySelectorAll("button").forEach(b => {
b.classList.remove("chosen");
});
btn.classList.add("chosen"); }); 
});
});
// ==========================================
// OPEN / CLOSED / TRANSACTIONS
// ==========================================
document.querySelectorAll(".tabs .tab").forEach(btn => {
btn.addEventListener("click", () => {
document.querySelectorAll(".tabs .tab").forEach(b => {
b.classList.remove("selected");
});
btn.classList.add("selected"); const states = { open: [ "No open positions", "Your active trades will appear here" ], closed: [ "No closed positions", "Your completed trades will appear here" ], transactions: [ "No transactions yet", "Your account activity will appear here" ] }; const [title, sub] = states[btn.dataset.tab] || states.open; $("positionsState").innerHTML = ` <div class="target">◎</div> <strong>${title}</strong> <span>${sub}</span> `; 
});
});
// ==========================================
// THEME
// ==========================================
$("themeBtn").addEventListener("click", () => {
document.body.classList.toggle("light");
});
// ==========================================
// AI SCANNER
// ==========================================
$("scannerBtn").addEventListener("click", () => {
toast(
"Scanner is in preview mode until its analysis engine is connected."
);
});
// ==========================================
// TRADE MASTER AI SUPPORT
// EDUCATIONAL RESPONSES ONLY
// ==========================================
function addChatMessage(text, who) {
const box = $("aiMessages");
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
return "Even/Odd contracts predict whether the last digit of a market tick is even or odd. The live chart displays market prices, but this screen does not currently place trades.";
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
// QUICK QUESTIONS
document.querySelectorAll("[data-ai-question]").forEach(btn => {
btn.addEventListener("click", () => {
const q = btn.dataset.aiQuestion;
addChatMessage(q, "user"); addChatMessage(answerQuestion(q), "bot"); 
});
});
// CHAT FORM
$("aiChatForm").addEventListener("submit", event => {
event.preventDefault();
const q = $("aiInput").value.trim();
if (!q) return;
addChatMessage(q, "user");
addChatMessage(answerQuestion(q), "bot");
$("aiInput").value = "";
});
// CLEAR CHAT
$("clearAIChat").addEventListener("click", () => {
$("aiMessages").innerHTML = "";
addChatMessage(
"Hello! Welcome to Trade Master. How can I help you today?",
"bot"
);
});
// ==========================================
// RESTORE SUPABASE SESSION
// ==========================================
(async function init() {
updatePayout();
updateDepositEstimate();
if (!supabaseClient) {
authMessage(
"Supabase connection unavailable. Check that the Supabase JavaScript library is loaded in index.html and that your project details are correct."
);
return; 
}
const {
data,
error
} = await supabaseClient.auth.getSession();
if (error) {
authMessage(error.message);
return;
}
if (data.session) {
currentSession = data.session;
try { await loadProfile(); enterDashboard(); } catch (error) { authMessage(error.message); } 
} else {
showAuth();
}
})();
// ==========================================
// AUTH STATE CHANGES
// ==========================================
if (supabaseClient) {
supabaseClient.auth.onAuthStateChange(
async (event, session) => {
currentSession = session;
if (event === "SIGNED_OUT") { currentProfile = {}; stopDerivMarket(); showAuth(); } } 
);
}
