require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const API_BASE = "https://api.mozi.finance";
const headers = {
  Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
};

// Utility
const delay = ms => new Promise(res => setTimeout(res, ms));

function logToFile(message) {
  const logPath = path.join(__dirname, "mozi.log");
  const logMsg = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logPath, logMsg);
}

function log(message) {
  console.log(message);
  logToFile(message);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function countdown(ms) {
  while (ms > 0) {
    const timeStr = formatTime(ms);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`⏳ Menunggu: ${timeStr}`);
    await delay(1000);
    ms -= 1000;
  }
  process.stdout.write("\n");
}

// Retry wrapper
async function withRetry(fn, retries = 3, delayMs = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isNotEligible = err.response?.data?.message === "Not eligible.";
      if (isNotEligible) {
        log("🚫 Faucet sudah diklaim, lanjut ke transfer.");
        return { eligible: false };
      }

      log(`⚠️ Attempt ${i + 1} failed → ${err.response?.status} ${JSON.stringify(err.response?.data || err.message)}`);
      if (i < retries - 1) await delay(delayMs);
      else log(`❌ Final error → ${JSON.stringify(err.response?.data || err.message)}`);
    }
  }
}

// Faucet
async function claimFaucet() {
  return await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/faucet`, {}, {
      headers: { ...headers, 'Content-Type': 'application/json' }
    });

    if (res.data?.result === "success" && res.data?.txHash) {
      log(`✅ Faucet claimed! TX: ${res.data.txHash}`);
      return { claimed: true };
    }

    if (res.data?.message === "Not eligible.") {
      log(`🕒 Faucet already claimed.`);
      return { claimed: false, eligible: false };
    }

    log(`❌ Unexpected claim result: ${JSON.stringify(res.data)}`);
    return { claimed: false };
  });
}

// Balance
async function getBalance() {
  try {
    const res = await axios.get(`${API_BASE}/api/wallet-data/tokens`, { headers });
    const tokens = res.data?.result?.data || [];
    const mon = tokens.find(t => t.symbol === "MON");
    const balance = mon?.balance || "0";
    log(`💰 MON Balance: ${balance}`);
    return balance;
  } catch (err) {
    log(`🚨 Error checking balance: ${JSON.stringify(err.response?.data || err.message)}`);
    return "0";
  }
}

// Transfer MON
async function sendMon(valueInEther) {
  const weiValue = (BigInt(parseFloat(valueInEther) * 1e18)).toString();

  await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/wallet/tx/send`, {
      to: process.env.RECEIVER,
      value: weiValue,
      chainId: 10143
    }, { headers });

    if (res.data?.status === "success") {
      log(`📤 Sent ${valueInEther} MON to ${process.env.RECEIVER}`);
      log(`🔗 TX Hash: ${res.data.data}`);
    } else {
      log(`❌ Send failed: ${JSON.stringify(res.data)}`);
    }
  });
}


// Main loop
async function runLoop() {
  while (true) {
    log("\n🔁 New Cycle Started");

    const claimResult = await claimFaucet();

    // Tetap lanjut kirim walau gak eligible
    await delay(10000); // tunggu MON masuk
    const balance = await getBalance();

    if (parseFloat(balance) >= 0.01) {
      await sendMon("0.01");
    } else {
      log(`⚠️ Not enough MON to transfer.`);
    }

    log("🕓 Sleeping for 24 hours before next cycle...");
    await countdown(24 * 60 * 60 * 1000); // 24 jam countdown animasi
  }
}

runLoop();
