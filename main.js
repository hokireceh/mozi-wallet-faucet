require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.mozi.finance";
const headers = {
  Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
};

// Logger function
function logToFile(message) {
  const logPath = path.join(__dirname, "mozi.log");
  const logMsg = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logPath, logMsg);
}

// Print + log wrapper
function log(message) {
  console.log(message);
  logToFile(message);
}

// Retry wrapper
async function withRetry(fn, retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const errMsg = `⚠️  Attempt ${i + 1} failed → ${err.response?.status} ${JSON.stringify(err.response?.data || err.message)}`;
      log(errMsg);
      if (i < retries - 1) await new Promise(res => setTimeout(res, delay));
      else {
        const finalErr = `❌  Final error → ${JSON.stringify(err.response?.data || err.message)}`;
        log(finalErr);
      }
    }
  }
}

// Claim faucet
async function claimFaucet() {
  return await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/faucet`, {}, {
      headers: { ...headers, 'Content-Type': 'application/json' }
    });

    if (res.data?.result === "success" && res.data?.txHash) {
      log(`✅  Faucet claimed successfully!`);
      log(`🔗  TX Hash        : ${res.data.txHash}`);
    } else if (res.data?.nextFaucetRequestAt) {
      log(`🕒  Already claimed. Next claim at: ${res.data.nextFaucetRequestAt}`);
    } else {
      log(`❌  Faucet claim failed: ${JSON.stringify(res.data)}`);
    }
  });
}

// Check balance
async function getBalance() {
  try {
    const res = await axios.get(`${API_BASE}/api/wallet-data/tokens`, { headers });
    const tokens = res.data?.result?.data || [];
    const monToken = tokens.find(t => t.symbol === "MON");
    const balance = monToken?.balance || "0";
    log(`💰  MON Balance    : ${balance}`);
    return balance;
  } catch (err) {
    const msg = `🚨  Balance check error: ${JSON.stringify(err.response?.data || err.message)}`;
    log(msg);
    return "0";
  }
}

// Send MON
async function sendMon(amount) {
  return await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/wallet/tx/send`, {
      to: process.env.RECEIVER,
      symbol: "MON",
      amount: amount,
    }, { headers });

    if (res.data?.status === "success") {
      log(`📤  Sent ${amount} MON → ${process.env.RECEIVER}`);
      log(`🔗  TX Hash        : ${res.data.data}`);
    } else {
      log(`❌  Send failed: ${JSON.stringify(res.data)}`);
    }
  });
}

// Run
(async () => {
  log("🔁  Auto Claim & Transfer Script Started");

  await claimFaucet();
  await new Promise(res => setTimeout(res, 10000)); // wait MON masuk

  const balance = await getBalance();
  if (parseFloat(balance) >= 0.01) {
    await sendMon("0.01");
  } else {
    log(`⚠️  Not enough MON to transfer.`);
  }

  log("✅  Script Finished\n");
})();
