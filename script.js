// ==========================================
// LOAD REAL DERIV ACCOUNT BALANCES
// ==========================================

async function loadDerivAccounts() {
  if (!supabaseClient || !currentSession) {
    return;
  }

  const balanceElement = $("balanceValue");
  const profileBalanceElement = $("profileBalance");

  if (balanceElement) {
    balanceElement.textContent = "Loading Deriv balance...";
  }

  try {
    const { data, error } =
      await supabaseClient.functions.invoke(
        "deriv-account-balance",
        { body: {} }
      );

    if (error) {
      throw error;
    }

    if (!data || !data.success) {
      throw new Error(
        data?.error || "Could not retrieve Deriv accounts."
      );
    }

    const response = data.accounts;
    const accounts = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.data?.accounts)
        ? response.data.accounts
        : Array.isArray(response?.accounts)
          ? response.accounts
          : [];

    if (accounts.length === 0) {
      throw new Error("No Deriv trading accounts were returned.");
    }

    const accountLines = accounts.map(account => {
      const amount = Number(account.balance);
      const currency = account.currency || "USD";
      const type = account.account_type || "Account";

      if (!Number.isFinite(amount)) {
        throw new Error("Deriv returned an invalid balance.");
      }

      return `${type.toUpperCase()}: ${currency} ${amount.toLocaleString(
        "en-US",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      )}`;
    });

    const display = accountLines.join(" | ");

    if (balanceElement) {
      balanceElement.textContent = display;
    }

    if (profileBalanceElement) {
      profileBalanceElement.value = display;
    }

    console.log("Deriv accounts loaded:", accounts.length);

    toast("Deriv account balances loaded successfully.");

  } catch (error) {
    console.error("Deriv balance error:", error);

    if (balanceElement) {
      balanceElement.textContent = "Deriv balance unavailable";
    }

    if (profileBalanceElement) {
      profileBalanceElement.value = "Unavailable";
    }

    toast(error.message || "Unable to load Deriv balance.");
  }
}
