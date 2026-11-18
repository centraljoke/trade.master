/* =====================================================
   TRADE MASTER — AUTHENTICATED DERIV REAL TRADING
   Live proposal → user confirmation → purchase
   Contract settlement monitoring
===================================================== */

(() => {
  "use strict";

  const SYMBOL = "1HZ10V";
  const MIN_STAKE = 0.35;

  let accounts = [];
  let selectedRealAccount = null;

  let tradingSocket = null;
  let socketPromise = null;

  let requestCounter = 100;
  let pendingRequests = new Map();

  let realTradeBusy = false;
  let activeContractId = null;

  let proposalSubscriptionId = null;

  const $ = id => document.getElementById(id);

  const money = value =>
    "$" + Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  function showMessage(message) {
    if (typeof toast === "function") {
      toast(message);
    } else {
      console.log(message);
    }
  }

  function extractAccounts(payload) {
    const found = [];

    function scan(value, depth = 0) {
      if (!value || depth > 5) return;

      if (Array.isArray(value)) {
        if (value.some(item => item?.account_id)) {
          value.forEach(item => {
            if (item?.account_id) found.push(item);
          });
          return;
        }

        value.forEach(item => scan(item, depth + 1));
        return;
      }

      if (typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (
            key === "account_id" &&
            typeof child === "string"
          ) {
            found.push(value);
            return;
          }

          scan(child, depth + 1);
        }
      }
    }

    scan(payload);

    return [
      ...new Map(
        found.map(account => [
          String(account.account_id),
          account
        ])
      ).values()
    ];
  }

  function isRealAccount(account) {
    const type = String(
      account.account_type ||
      account.type ||
      ""
    ).toLowerCase();

    return (
      account.is_virtual === false ||
      type === "real" ||
      type === "financial" ||
      type.includes("real_money")
    );
  }

  function accountLabel(account) {
    const id = account.account_id;
    const currency = account.currency || "USD";
    const balance = Number(account.balance || 0);

    return `${id} · ${currency} ${balance.toFixed(2)}`;
  }

  function createAccountSelector() {
    const switcher = $("tmAccountSwitch");

    if (!switcher || $("tmRealAccountSelect")) return;

    const select = document.createElement("select");

    select.id = "tmRealAccountSelect";
    select.setAttribute("aria-label", "Select Deriv Real account");

    select.style.cssText = `
      max-width:145px;
      min-width:90px;
      padding:7px 5px;
      border-radius:7px;
      border:1px solid #40536c;
      background:#101b2b;
      color:#eef3fb;
      font-size:10px;
      font-weight:700;
    `;

    select.addEventListener("change", () => {
      selectedRealAccount = accounts.find(
        account =>
          String(account.account_id) === select.value
      ) || null;

      closeTradingSocket();

      updateRealButtons();
    });

    switcher.appendChild(select);

    updateAccountSelector();
  }

  function updateAccountSelector() {
    const select = $("tmRealAccountSelect");

    if (!select) return;

    const realAccounts = accounts.filter(isRealAccount);

    select.innerHTML = "";

    realAccounts.forEach(account => {
      const option = document.createElement("option");

      option.value = String(account.account_id);
      option.textContent = accountLabel(account);

      select.appendChild(option);
    });

    if (selectedRealAccount) {
      select.value = String(selectedRealAccount.account_id);
    }

    select.disabled = realAccounts.length === 0;
  }

  async function loadRealTradingAccounts() {
    if (!window.supabase || !currentSession) return;

    try {
      const { data, error } =
        await supabaseClient.functions.invoke(
          "deriv-account-balance",
          { body: {} }
        );

      if (error) throw error;

      if (!data?.success) {
        throw new Error(
          data?.error || "Could not load Deriv accounts."
        );
      }

      accounts = extractAccounts(data.accounts);

      const realAccounts = accounts.filter(isRealAccount);

      if (!realAccounts.length) {
        selectedRealAccount = null;

        updateAccountSelector();
        updateRealButtons();

        showMessage("No Real Deriv account was found.");
        return;
      }

      if (
        !selectedRealAccount ||
        !realAccounts.some(
          account =>
            String(account.account_id) ===
            String(selectedRealAccount.account_id)
        )
      ) {
        selectedRealAccount = realAccounts[0];
      }

      createAccountSelector();
      updateAccountSelector();
      updateRealButtons();

    } catch (error) {
      console.error("Real account loading failed:", error);
      showMessage(error.message || "Unable to load Real accounts.");
    }
  }

  function nextRequestId() {
    requestCounter += 1;
    return requestCounter;
  }

  function closeTradingSocket() {
    if (tradingSocket) {
      tradingSocket.onclose = null;
      tradingSocket.onerror = null;
      tradingSocket.onmessage = null;

      try {
        tradingSocket.close();
      } catch (_) {}
    }

    tradingSocket = null;
    socketPromise = null;

    pendingRequests.forEach(item => {
      clearTimeout(item.timer);
      item.reject(new Error("Trading connection closed."));
    });

    pendingRequests.clear();
  }

  async function connectTradingSocket() {
    if (
      tradingSocket &&
      tradingSocket.readyState === WebSocket.OPEN
    ) {
      return tradingSocket;
    }

    if (socketPromise) return socketPromise;

    if (!selectedRealAccount) {
      throw new Error("Select a Real Deriv account first.");
    }

    socketPromise = (async () => {
      const accountId = String(
        selectedRealAccount.account_id
      );

      const { data, error } =
        await supabaseClient.functions.invoke(
          "deriv-websocket-session",
          {
            body: {
              account_id: accountId,
              mode: "REAL"
            }
          }
        );

      if (error) throw error;

      if (!data?.success || !data?.ws_url) {
        throw new Error(
          data?.error || "Deriv connection could not be created."
        );
      }

      if (data.mode !== "REAL") {
        throw new Error("Deriv returned the wrong account mode.");
      }

      const ws = new WebSocket(data.ws_url);

      tradingSocket = ws;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Deriv connection timed out."));
          closeTradingSocket();
        }, 15000);

        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Could not connect to Deriv."));
        };

        ws.onclose = () => {
          if (tradingSocket === ws) {
            tradingSocket = null;
            socketPromise = null;
          }
        };

        ws.onmessage = event => {
          handleTradingMessage(event, ws);
        };
      });

      return ws;
    })();

    try {
      return await socketPromise;
    } catch (error) {
      socketPromise = null;
      throw error;
    }
  }

  function handleTradingMessage(event, ws) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (message.error) {
      const requestId = message.req_id;

      if (pendingRequests.has(requestId)) {
        const pending = pendingRequests.get(requestId);

        clearTimeout(pending.timer);
        pendingRequests.delete(requestId);

        pending.reject(
          new Error(
            message.error.message || "Deriv rejected the request."
          )
        );
      } else {
        console.error("Deriv trading error:", message.error);
      }

      return;
    }

    const requestId = message.req_id;

    if (pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);

      clearTimeout(pending.timer);
      pendingRequests.delete(requestId);

      pending.resolve(message);
    }

    if (message.msg_type === "proposal_open_contract") {
      handleContractUpdate(message.proposal_open_contract);
    }

    if (message.msg_type === "balance" && message.balance) {
      console.log("Real account balance update:", message.balance);
    }
  }

  async function sendAndWait(payload, timeoutMs = 15000) {
    const ws = await connectTradingSocket();

    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error("Deriv trading connection is not open.");
    }

    const reqId = nextRequestId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(reqId);

        reject(
          new Error("Deriv did not respond in time. Check your account before retrying.")
        );
      }, timeoutMs);

      pendingRequests.set(reqId, {
        resolve,
        reject,
        timer
      });

      ws.send(JSON.stringify({
        ...payload,
        req_id: reqId
      }));
    });
  }

  function createProposalDialog(proposal, contractType, stake) {
    document.getElementById("tmProposalDialog")?.remove();

    const payout = Number(proposal.payout);
    const askPrice = Number(proposal.ask_price);
    const profit = payout - askPrice;

    if (
      !Number.isFinite(payout) ||
      !Number.isFinite(askPrice) ||
      askPrice <= 0
    ) {
      throw new Error("Deriv returned an invalid proposal.");
    }

    const overlay = document.createElement("div");

    overlay.id = "tmProposalDialog";

    overlay.style.cssText = `
      position:fixed;
      inset:0;
      z-index:99999;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:18px;
      background:rgba(0,0,0,.78);
    `;

    const panel = document.createElement("div");

    panel.style.cssText = `
      width:100%;
      max-width:380px;
      padding:20px;
      border-radius:15px;
      background:#172438;
      color:#f1f5f9;
      border:1px solid #34465c;
      box-shadow:0 20px 60px rgba(0,0,0,.45);
    `;

    const heading = document.createElement("h3");
    heading.textContent = `Confirm REAL ${contractType} trade`;

    const details = document.createElement("div");

    details.style.cssText = `
      display:grid;
      gap:12px;
      margin:18px 0;
      font-size:14px;
    `;

    const rows = [
      ["Market", SYMBOL],
      ["Stake", money(askPrice)],
      ["Potential payout", money(payout)],
      ["Potential profit", money(profit)],
      ["Maximum loss", money(askPrice)]
    ];

    rows.forEach(([label, value]) => {
      const row = document.createElement("div");

      row.style.cssText =
        "display:flex;justify-content:space-between;gap:10px;";

      const left = document.createElement("span");
      left.textContent = label;

      const right = document.createElement("strong");
      right.textContent = value;

      row.append(left, right);
      details.appendChild(row);
    });

    const warning = document.createElement("p");

    warning.style.cssText = `
      color:#f3c969;
      font-size:12px;
      line-height:1.5;
    `;

    warning.textContent =
      "Real money is at risk. Confirm only if you accept the quoted stake and possible loss.";

    const actions = document.createElement("div");

    actions.style.cssText =
      "display:flex;gap:10px;margin-top:18px;";

    const cancel = document.createElement("button");

    cancel.textContent = "Cancel";

    cancel.style.cssText = `
      flex:1;padding:12px;border:1px solid #52647c;
      border-radius:8px;background:transparent;
      color:white;font-weight:800;
    `;

    const confirm = document.createElement("button");

    confirm.textContent = "CONFIRM REAL TRADE";

    confirm.style.cssText = `
      flex:1;padding:12px;border:0;border-radius:8px;
      background:#087f68;color:white;font-weight:900;
    `;

    actions.append(cancel, confirm);
    panel.append(heading, details, warning, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    return new Promise(resolve => {
      cancel.onclick = () => {
        overlay.remove();
        resolve(false);
      };

      overlay.addEventListener("click", event => {
        if (event.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });

      confirm.onclick = () => {
        confirm.disabled = true;
        confirm.textContent = "PURCHASING...";

        cancel.disabled = true;

        resolve(true);
      };
    });
  }

  async function requestRealProposal(contractType) {
    if (realTradeBusy) return;

    if (
      typeof tradeMasterAccountMode !== "undefined" &&
      tradeMasterAccountMode !== "REAL"
    ) {
      return;
    }

    if (!supabaseClient || !currentSession) {
      showMessage("Please log in first.");
      return;
    }

    if (!selectedRealAccount) {
      await loadRealTradingAccounts();

      if (!selectedRealAccount) {
        showMessage("No Real Deriv account is available.");
        return;
      }
    }

    if (!marketConnected) {
      showMessage("Wait for the live market to connect.");
      return;
    }

    if (!["EVEN", "ODD"].includes(contractType)) {
      showMessage("Invalid contract type.");
      return;
    }

    const stake = Number($("stake")?.value);

    if (!Number.isFinite(stake) || stake < MIN_STAKE) {
      showMessage(`Minimum stake is ${money(MIN_STAKE)}.`);
      return;
    }

    realTradeBusy = true;
    updateRealButtons();

    try {
      const currency =
        selectedRealAccount.currency || "USD";

      const derivContractType =
        contractType === "EVEN"
          ? "DIGITEVEN"
          : "DIGITODD";

      showMessage("Connecting to your Deriv Real account...");

      const proposalResponse = await sendAndWait({
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type: derivContractType,
        currency,
        duration: 1,
        duration_unit: "t",
        underlying_symbol: SYMBOL,
        subscribe: 1
      });

      const proposal = proposalResponse.proposal;

      if (!proposal?.id) {
        throw new Error("Deriv did not return a valid proposal.");
      }

      proposalSubscriptionId =
        proposalResponse.subscription?.id || null;

      const confirmed = await createProposalDialog(
        proposal,
        contractType,
        stake
      );

      if (!confirmed) {
        showMessage("Trade cancelled. No purchase was made.");
        return;
      }

      // Buy only after the user confirms the live proposal.
      const buyResponse = await sendAndWait({
        buy: String(proposal.id),
        price: Number(proposal.ask_price)
      });

      const bought = buyResponse.buy;

      if (!bought?.contract_id) {
        throw new Error(
          "Deriv did not confirm the purchase. Check your account before retrying."
        );
      }

      activeContractId = bought.contract_id;

      showMessage(
        "REAL trade purchased. Contract #" + activeContractId
      );

      const positions = $("positionsState");

      if (positions) {
        positions.textContent =
          `REAL ${contractType} contract #${activeContractId} is open. Waiting for settlement...`;
      }

      await sendAndWait({
        proposal_open_contract: 1,
        contract_id: activeContractId,
        subscribe: 1
      });

    } catch (error) {
      console.error("Real trade error:", error);

      showMessage(
        error.message ||
        "Real trade request failed. Check your Deriv account before trying again."
      );

    } finally {
      realTradeBusy = false;
      updateRealButtons();
    }
  }

  function handleContractUpdate(contract) {
    if (!contract) return;

    if (
      activeContractId &&
      String(contract.contract_id) !== String(activeContractId)
    ) {
      return;
    }

    const status = String(
      contract.status || ""
    ).toLowerCase();

    const finished =
      contract.is_sold === 1 ||
      contract.is_expired === 1 ||
      status === "won" ||
      status === "lost" ||
      status === "sold";

    if (!finished) return;

    const profit = Number(contract.profit || 0);
    const payout = Number(contract.payout || 0);

    const result = profit > 0
      ? `REAL TRADE WON · Profit ${money(profit)} · Payout ${money(payout)}`
      : `REAL TRADE LOST · ${money(Math.abs(profit))}`;

    showMessage(result);

    const positions = $("positionsState");

    if (positions) {
      positions.textContent = result;
    }

    activeContractId = null;

    if (typeof loadDerivAccounts === "function") {
      loadDerivAccounts();
    }

    loadRealTradingAccounts();
  }

  function updateRealButtons() {
    const even = $("evenBtn");
    const odd = $("oddBtn");

    if (!even || !odd) return;

    const isReal =
      typeof tradeMasterAccountMode !== "undefined" &&
      tradeMasterAccountMode === "REAL";

    if (!isReal) return;

    const disabled =
      realTradeBusy || !selectedRealAccount;

    even.disabled = disabled;
    odd.disabled = disabled;

    even.textContent = realTradeBusy
      ? "PLEASE WAIT..."
      : "EVEN";

    odd.textContent = realTradeBusy
      ? "PLEASE WAIT..."
      : "ODD";
  }

  // Intercept Real button clicks before the old placeholder handlers.
  document.addEventListener("click", event => {
    const button = event.target.closest("#evenBtn, #oddBtn");

    if (!button) return;

    if (
      typeof tradeMasterAccountMode === "undefined" ||
      tradeMasterAccountMode !== "REAL"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    requestRealProposal(
      button.id === "evenBtn" ? "EVEN" : "ODD"
    );
  }, true);

  // Observe the dynamically created account switcher.
  const observer = new MutationObserver(() => {
    if ($("tmAccountSwitch")) {
      createAccountSelector();
      updateAccountSelector();
      updateRealButtons();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Keep the existing Demo button logic intact.
  const originalUpdateButtons = window.updateDemoTradeButtons;

  if (typeof originalUpdateButtons === "function") {
    window.updateDemoTradeButtons = function () {
      if (
        typeof tradeMasterAccountMode !== "undefined" &&
        tradeMasterAccountMode === "REAL"
      ) {
        updateRealButtons();
        return;
      }

      originalUpdateButtons();
    };
  }

  // Load the connected Real accounts after login.
  const accountObserver = new MutationObserver(() => {
    if (
      $("tmAccountSwitch") &&
      currentSession &&
      !accountObserver.loaded
    ) {
      accountObserver.loaded = true;
      loadRealTradingAccounts();
    }
  });

  accountObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  console.log("Trade Master Real trading module loaded.");
})();
