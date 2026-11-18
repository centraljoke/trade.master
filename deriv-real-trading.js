/* =========================================================
   TRADE MASTER — OUR OWN EVEN / ODD BUTTONS
   DERIV AUTHENTICATED REAL ACCOUNT
   LIVE PROPOSALS | CONFIRMED PURCHASES | LIVE RESULTS
========================================================= */

(() => {
  "use strict";

  const BALANCE_FUNCTION = "deriv-account-balance";
  const SESSION_FUNCTION = "deriv-websocket-session";

  const SYMBOL = "1HZ10V";
  const DURATION = 1;
  const DURATION_UNIT = "t";

  let ws = null;
  let connected = false;
  let connecting = false;
  let trading = false;

  let accounts = [];
  let selectedAccount = null;
  let pendingProposal = null;
  let activeContractId = null;

  let requestNumber = 500;
  const requests = new Map();

  const $ = (id) => document.getElementById(id);

  function supabase() {
    if (typeof supabaseClient !== "undefined") {
      return supabaseClient;
    }
    if (window.supabaseClient) {
      return window.supabaseClient;
    }
    throw new Error("Supabase client unavailable.");
  }

  function mode() {
    try {
      if (typeof tradeMasterAccountMode !== "undefined") {
        return String(tradeMasterAccountMode).toUpperCase();
      }
    } catch (_) {}

    const realButton = $("tmRealMode");
    const demoButton = $("tmDemoMode");

    if (realButton && realButton.classList.contains("active")) {
      return "REAL";
    }

    if (demoButton && demoButton.classList.contains("active")) {
      return "DEMO";
    }

    return "REAL";
  }

  function notify(message) {
    if (typeof toast === "function") {
      toast(message);
    } else {
      alert(message);
    }
  }

  function setStatus(message, success = connected) {
    const status = $("tmrStatus");
    const dot = $("tmrDot");

    if (status) status.textContent = message;
    if (dot) dot.style.color = success ? "#00d49a" : "#ff4545";
  }

  function cash(value) {
    const n = Number(value);
    return "$" + (Number.isFinite(n) ? n.toFixed(2) : "0.00");
  }

  function getAccountId(account) {
    return String(
      account?.account_id ||
      account?.accountId ||
      account?.loginid ||
      account?.id ||
      ""
    );
  }

  function getCurrency(account) {
    return String(
      account?.currency ||
      account?.currency_code ||
      "USD"
    ).toUpperCase();
  }

  function getBalance(account) {
    const n = Number(account?.balance ?? account?.account_balance ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  function isReal(account) {
    if (account?.is_virtual === false) return true;
    if (account?.is_virtual === true) return false;

    const type = String(
      account?.account_type ||
      account?.type ||
      account?.account_category ||
      ""
    ).toLowerCase();

    return type.includes("real") ||
      type.includes("financial") ||
      type.includes("investment");
  }

  function findAccounts(value) {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value.flatMap(item => {
        if (!item || typeof item !== "object") return [];

        if (
          item.account_id ||
          item.accountId ||
          item.loginid ||
          item.id
        ) return [item];

        return findAccounts(item);
      });
    }

    if (typeof value === "object") {
      for (const key of ["accounts", "data", "results", "items"]) {
        if (value[key]) {
          const result = findAccounts(value[key]);
          if (result.length) return result;
        }
      }
    }

    return [];
  }

  function buildInterface() {
    if ($("tmrOwnTrading")) return;

    const panel = document.createElement("section");
    panel.id = "tmrOwnTrading";

    panel.innerHTML = `
      <div class="tmr-top">
        <div>
          <strong>TRADE MASTER</strong>
          <small>REAL MARKET TRADING</small>
        </div>
        <span id="tmrDot">●</span>
      </div>

      <div class="tmr-connection">
        <select id="tmrAccount">
          <option value="">Loading real accounts...</option>
        </select>
        <button id="tmrConnect" type="button">CONNECT</button>
      </div>

      <div class="tmr-status" id="tmrStatus">
        Waiting for Deriv connection...
      </div>

      <div class="tmr-balance">
        <span>REAL ACCOUNT BALANCE</span>
        <strong id="tmrBalance">R $0.00</strong>
      </div>

      <div class="tmr-stake">
        <label for="tmrStake">TRADE STAKE (USD)</label>
        <input id="tmrStake" type="number" min="0.35"
          step="0.01" value="1">
      </div>

      <div class="tmr-buttons">
        <button id="tmrEven" type="button" disabled>
          <span>EVEN</span>
          <small>00 · 02 · 04 · 06 · 08</small>
        </button>

        <button id="tmrOdd" type="button" disabled>
          <span>ODD</span>
          <small>01 · 03 · 05 · 07 · 09</small>
        </button>
      </div>

      <div class="tmr-calculator">
        <div>
          <small>Potential payout</small>
          <strong id="tmrPayout">$0.00</strong>
        </div>
        <div>
          <small>Potential profit</small>
          <strong id="tmrProfit">$0.00</strong>
        </div>
        <div>
          <small>Maximum loss</small>
          <strong id="tmrLoss">$0.00</strong>
        </div>
        <div>
          <small>Actual result</small>
          <strong id="tmrResult">—</strong>
        </div>
      </div>

      <div id="tmrConfirmBox" hidden>
        <p id="tmrConfirmText"></p>
        <div class="tmr-confirm-actions">
          <button id="tmrCancel" type="button">CANCEL</button>
          <button id="tmrBuy" type="button">CONFIRM PURCHASE</button>
        </div>
      </div>

      <div class="tmr-foot">
        One-tick EVEN / ODD contract · Volatility 10 (1s)
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #tmrOwnTrading {
        width:100%;
        box-sizing:border-box;
        padding:14px;
        margin:10px 0;
        border:1px solid #2c3b50;
        border-radius:13px;
        background:#101a2a;
        color:#f1f5fb;
        font-family:inherit;
      }

      #tmrOwnTrading * { box-sizing:border-box; }

      .tmr-top,.tmr-connection,.tmr-balance {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }

      .tmr-top strong {
        display:block;
        font-size:14px;
        letter-spacing:1px;
      }

      .tmr-top small,.tmr-status,.tmr-foot {
        color:#93a4bb;
        font-size:11px;
      }

      .tmr-top small { display:block; margin-top:3px; }
      #tmrDot { color:#ff4545; }

      .tmr-connection { margin-top:13px; }

      .tmr-connection select {
        flex:1;
        min-width:0;
        background:#091321;
        border:1px solid #34445b;
        border-radius:8px;
        color:white;
        padding:11px 8px;
      }

      .tmr-connection button {
        background:#087fce;
        color:white;
        border:0;
        border-radius:8px;
        padding:11px;
        font-weight:800;
      }

      .tmr-status {
        margin-top:9px;
        min-height:16px;
      }

      .tmr-balance {
        background:#091321;
        border-radius:8px;
        padding:12px;
        margin-top:12px;
      }

      .tmr-balance span,.tmr-stake label {
        font-size:10px;
        color:#93a4bb;
      }

      .tmr-balance strong {
        color:#00d49a;
        font-size:17px;
      }

      .tmr-stake { margin-top:12px; }
      .tmr-stake label { display:block; margin-bottom:6px; }

      .tmr-stake input {
        width:100%;
        padding:11px;
        color:white;
        background:#091321;
        border:1px solid #34445b;
        border-radius:8px;
        font-size:16px;
      }

      .tmr-buttons {
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:10px;
        margin-top:12px;
      }

      .tmr-buttons button {
        min-height:76px;
        border:0;
        border-radius:10px;
        color:white;
        font-weight:900;
        font-size:21px;
        cursor:pointer;
      }

      #tmrEven { background:#079b68; }
      #tmrOdd { background:#d93643; }

      .tmr-buttons button small {
        display:block;
        font-size:10px;
        margin-top:6px;
        font-weight:600;
      }

      .tmr-buttons button:disabled {
        opacity:.4;
        cursor:not-allowed;
      }

      .tmr-calculator {
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:8px;
        margin-top:12px;
      }

      .tmr-calculator div {
        background:#1a293d;
        padding:10px;
        border-radius:8px;
      }

      .tmr-calculator small {
        display:block;
        color:#93a4bb;
        font-size:10px;
      }

      .tmr-calculator strong {
        display:block;
        margin-top:5px;
        font-size:14px;
      }

      #tmrConfirmBox {
        margin-top:12px;
        padding:12px;
        border:1px solid #c89532;
        border-radius:9px;
        background:#302714;
      }

      #tmrConfirmText {
        font-size:12px;
        line-height:1.6;
      }

      .tmr-confirm-actions {
        display:flex;
        gap:8px;
      }

      .tmr-confirm-actions button {
        flex:1;
        border:0;
        border-radius:8px;
        padding:11px 5px;
        font-weight:800;
      }

      #tmrCancel { background:#34445b;color:white; }
      #tmrBuy { background:#00b887;color:#041b15; }

      .tmr-foot {
        margin-top:12px;
        text-align:center;
      }
    `;

    document.head.appendChild(style);

    const parent =
      document.querySelector(".trade-panel") ||
      document.querySelector("#tradePanel") ||
      document.querySelector(".workspace");

    if (parent) {
      parent.prepend(panel);
    } else {
      document.body.appendChild(panel);
    }

    $("tmrConnect").addEventListener("click", connect);
    $("tmrEven").addEventListener("click", () => requestTrade("EVEN"));
    $("tmrOdd").addEventListener("click", () => requestTrade("ODD"));
    $("tmrBuy").addEventListener("click", buyTrade);
    $("tmrCancel").addEventListener("click", cancelTrade);

    $("tmrAccount").addEventListener("change", event => {
      selectedAccount = accounts.find(
        item => getAccountId(item) === event.target.value
      ) || null;

      disconnect();

      updateBalance();
      setStatus("Account selected. Press CONNECT.");
    });
  }

  async function loadAccounts() {
    const { data, error } = await supabase().functions.invoke(
      BALANCE_FUNCTION,
      { body: {} }
    );

    if (error) throw new Error(error.message);
    if (!data?.success) {
      throw new Error(data?.error || "Could not load accounts.");
    }

    accounts = findAccounts(data.accounts).filter(isReal);

    const select = $("tmrAccount");
    select.innerHTML = "";

    if (!accounts.length) {
      select.innerHTML =
        '<option value="">No real accounts found</option>';
      throw new Error("No real Deriv account was found.");
    }

    accounts.forEach(account => {
      const option = document.createElement("option");
      option.value = getAccountId(account);
      option.textContent =
        `${getAccountId(account)} — ${getCurrency(account)} ${getBalance(account).toFixed(2)}`;
      select.appendChild(option);
    });

    selectedAccount = accounts[0];
    select.value = getAccountId(selectedAccount);
    updateBalance();
  }

  function updateBalance() {
    if (!selectedAccount) return;

    $("tmrBalance").textContent =
      `R ${getCurrency(selectedAccount)} ${getBalance(selectedAccount).toFixed(2)}`;
  }

  async function connect() {
    if (connecting) return;

    connecting = true;
    $("tmrConnect").disabled = true;
    $("tmrConnect").textContent = "CONNECTING";

    try {
      if (!selectedAccount) await loadAccounts();

      const { data, error } = await supabase().functions.invoke(
        SESSION_FUNCTION,
        {
          body: {
            account_id: getAccountId(selectedAccount),
            mode: "REAL"
          }
        }
      );

      if (error) throw new Error(error.message);
      if (!data?.success || !data.url) {
        throw new Error(data?.error || "Deriv session failed.");
      }

      disconnect();

      ws = new WebSocket(data.url);

      ws.onopen = () => {
        connected = true;
        connecting = false;

        $("tmrConnect").disabled = false;
        $("tmrConnect").textContent = "CONNECTED";

        setStatus("Authenticated real trading connection ready.", true);
        updateButtons();
        refreshBalance();
      };

      ws.onmessage = event => {
        let message;

        try {
          message = JSON.parse(event.data);
        } catch (_) {
          return;
        }

        handleMessage(message);
      };

      ws.onerror = () => {
        setStatus("WebSocket connection error.", false);
      };

      ws.onclose = () => {
        connected = false;
        connecting = false;
        trading = false;

        $("tmrConnect").disabled = false;
        $("tmrConnect").textContent = "CONNECT";
        setStatus("Trading connection closed.", false);
        updateButtons();

        requests.forEach(item => item.reject(
          new Error("Deriv connection closed.")
        ));
        requests.clear();
      };

    } catch (error) {
      connected = false;
      connecting = false;
      $("tmrConnect").disabled = false;
      $("tmrConnect").textContent = "CONNECT";
      setStatus(error.message || "Connection failed.", false);
      notify(error.message || "Connection failed.");
    }
  }

  function disconnect() {
    connected = false;

    if (ws) {
      try { ws.close(); } catch (_) {}
    }

    ws = null;
    requests.clear();
    updateButtons();
  }

  function updateButtons() {
    const enabled =
      connected &&
      !trading &&
      !activeContractId &&
      mode() === "REAL";

    if ($("tmrEven")) $("tmrEven").disabled = !enabled;
    if ($("tmrOdd")) $("tmrOdd").disabled = !enabled;

    const panel = $("tmrOwnTrading");
    if (panel) {
      panel.style.display = mode() === "REAL" ? "block" : "none";
    }
  }

  function send(payload) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Connect your real account first."));
        return;
      }

      const id = ++requestNumber;

      requests.set(id, { resolve, reject });

      try {
        ws.send(JSON.stringify({
          ...payload,
          req_id: id
        }));
      } catch (error) {
        requests.delete(id);
        reject(error);
        return;
      }

      setTimeout(() => {
        if (requests.has(id)) {
          requests.delete(id);
          reject(new Error("Deriv response timed out."));
        }
      }, 15000);
    });
  }

  function handleMessage(message) {
    if (message.req_id && requests.has(message.req_id)) {
      const pending = requests.get(message.req_id);
      requests.delete(message.req_id);

      if (message.error) {
        pending.reject(
          new Error(message.error.message || "Deriv request failed.")
        );
      } else {
        pending.resolve(message);
      }
    }

    if (message.error) {
      setStatus(message.error.message || "Deriv error.", connected);
    }

    const contract =
      message.proposal_open_contract ||
      (message.msg_type === "proposal_open_contract" ? message : null);

    if (contract) updateContract(contract);
  }

  function getStake() {
    const stake = Number($("tmrStake").value);

    if (!Number.isFinite(stake) || stake < 0.35) {
      throw new Error("Enter a valid stake of at least $0.35.");
    }

    if (stake > getBalance(selectedAccount)) {
      throw new Error("Your real account balance is too low.");
    }

    return stake;
  }

  async function requestTrade(direction) {
    if (mode() !== "REAL") {
      notify("Select REAL account mode first.");
      return;
    }

    if (!connected) {
      notify("Connect your Deriv account first.");
      return;
    }

    if (trading || activeContractId) {
      notify("Wait for the current trade to finish.");
      return;
    }

    try {
      const stake = getStake();

      trading = true;
      updateButtons();
      setStatus(`Requesting live ${direction} proposal...`);

      const response = await send({
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type: direction === "EVEN" ? "DIGITEVEN" : "DIGITODD",
        currency: getCurrency(selectedAccount),
        duration: DURATION,
        duration_unit: DURATION_UNIT,
        underlying_symbol: SYMBOL,
        subscribe: 1
      });

      const proposal = response.proposal;

      if (!proposal?.id) {
        throw new Error("Deriv did not return a proposal ID.");
      }

      const ask = Number(proposal.ask_price);
      const payout = Number(proposal.payout);

      if (!Number.isFinite(ask) || !Number.isFinite(payout) ||
          ask <= 0 || payout <= 0) {
        throw new Error("Invalid proposal price returned by Deriv.");
      }

      pendingProposal = {
        id: proposal.id,
        direction,
        ask,
        payout,
        stake,
        created: Date.now()
      };

      $("tmrPayout").textContent = cash(payout);
      $("tmrProfit").textContent = cash(payout - ask);
      $("tmrLoss").textContent = cash(ask);
      $("tmrResult").textContent = "Pending";

      $("tmrConfirmText").textContent =
        `${direction} | Stake: ${cash(ask)} | ` +
        `Potential payout: ${cash(payout)} | ` +
        `Potential profit: ${cash(payout - ask)} | ` +
        `Maximum loss: ${cash(ask)}. Confirm to purchase.`;

      $("tmrConfirmBox").hidden = false;
      $("tmrBuy").disabled = false;

      setStatus("Live proposal received. Waiting for your confirmation.");

    } catch (error) {
      trading = false;
      updateButtons();
      setStatus(error.message, connected);
      notify(error.message);
    }
  }

  function cancelTrade() {
    pendingProposal = null;
    trading = false;
    $("tmrConfirmBox").hidden = true;
    setStatus("Purchase cancelled. No trade was placed.");
    updateButtons();
  }

  async function buyTrade() {
    if (!pendingProposal || !connected) {
      notify("No valid proposal is available.");
      return;
    }

    if (Date.now() - pendingProposal.created > 110000) {
      cancelTrade();
      notify("Proposal expired. Request a new one.");
      return;
    }

    const proposal = pendingProposal;

    $("tmrBuy").disabled = true;
    $("tmrBuy").textContent = "PURCHASING";
    setStatus("Sending purchase confirmation to Deriv...");

    try {
      const response = await send({
        buy: proposal.id,
        price: proposal.ask
      });

      const bought = response.buy;

      if (!bought?.contract_id) {
        throw new Error(
          "No contract ID received. Check your Deriv portfolio before trying again."
        );
      }

      activeContractId = bought.contract_id;
      pendingProposal = null;
      $("tmrConfirmBox").hidden = true;
      $("tmrResult").textContent = "Running";

      setStatus(`Purchase confirmed. Contract ${activeContractId} is running.`);

      await send({
        proposal_open_contract: 1,
        contract_id: activeContractId,
        subscribe: 1
      });

    } catch (error) {
      // Never blindly retry an uncertain purchase.
      pendingProposal = null;
      trading = false;
      $("tmrConfirmBox").hidden = true;
      setStatus(error.message || "Purchase response uncertain.", false);
      notify(
        "Check your Deriv portfolio before attempting another purchase."
      );
    }

    $("tmrBuy").textContent = "CONFIRM PURCHASE";
    updateButtons();
  }

  function updateContract(contract) {
    if (!activeContractId) return;

    if (
      contract.contract_id &&
      String(contract.contract_id) !== String(activeContractId)
    ) return;

    const finished =
      contract.is_sold ||
      contract.is_expired ||
      contract.status === "sold" ||
      contract.status === "expired";

    if (!finished) {
      if (contract.status) {
        setStatus(`Contract status: ${contract.status}`);
      }
      return;
    }

    const profit = Number(contract.profit ?? 0);

    $("tmrResult").textContent = cash(profit);
    $("tmrResult").style.color =
      profit >= 0 ? "#00d49a" : "#ff4545";

    setStatus(
      profit >= 0
        ? `Contract finished. Profit: ${cash(profit)}`
        : `Contract finished. Loss: ${cash(Math.abs(profit))}`
    );

    activeContractId = null;
    trading = false;
    updateButtons();
    refreshBalance();
    notify(`Trade settled. Result: ${cash(profit)}`);
  }

  async function refreshBalance() {
    try {
      const { data, error } = await supabase().functions.invoke(
        BALANCE_FUNCTION,
        { body: {} }
      );

      if (error || !data?.success) return;

      const latest = findAccounts(data.accounts).find(
        item => getAccountId(item) === getAccountId(selectedAccount)
      );

      if (latest) {
        selectedAccount = latest;
        updateBalance();
      }
    } catch (error) {
      console.error("Balance refresh failed:", error);
    }
  }

  async function initialise() {
    buildInterface();

    $("tmrEven").disabled = true;
    $("tmrOdd").disabled = true;

    try {
      await loadAccounts();
      setStatus("Select your account and press CONNECT.", false);
    } catch (error) {
      setStatus(error.message, false);
    }

    setInterval(updateButtons, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise);
  } else {
    initialise();
  }
})();
