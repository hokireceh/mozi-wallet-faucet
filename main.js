require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const API_BASE = "https://api.mozi.finance";
const TOKENS = process.env.AUTH_TOKENS.split("|||").map(t => t.trim());
const RECEIVER = process.env.RECEIVER;
const WEBHOOK = process.env.DISCORD_WEBHOOK;

const delay = ms => new Promise(res => setTimeout(res, ms));

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

function getUsernameFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload?.userData?.username || token.slice(0, 6);
  } catch (e) {
    return token.slice(0, 6);
  }
}

function logToFile(account, message) {
  const logPath = path.join(__dirname, `mozi-${account.slice(0, 6)}.log`);
  const logMsg = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logPath, logMsg);
}

const discordLogs = {};

function log(account, message) {
  console.log(`[${account}] ${message}`);
  logToFile(account, message);
  if (!discordLogs[account]) discordLogs[account] = [];
  discordLogs[account].push(`[${account}] ${message}`);
}

async function sendDiscordNotification(account, title, message, txHash = null) {
  if (!WEBHOOK || !WEBHOOK.startsWith("https://")) return;
  try {
    await axios.post(WEBHOOK, {
      username: "Mozi Faucet Bot",
      embeds: [
        {
          title,
          description: `${message}${txHash ? `\n\n🔗 [View TX](https://testnet.monadexplorer.com/tx/${txHash})` : ""}`,
          color: 0x00ff99,
          timestamp: new Date().toISOString(),
          footer: { text: `Akun ${account} - Mozi Watchdog 🕵️` }
        }
      ]
    });
  } catch (err) {
    console.error("❌ Gagal kirim ke Discord:", err.message);
  }
}

async function sendDiscordLogSummary(account) {
  if (!WEBHOOK || !WEBHOOK.startsWith("https://")) return;
  if (!discordLogs[account]) return;
  const fullMessage = discordLogs[account].join("\n").slice(0, 4000);
  try {
    await axios.post(WEBHOOK, {
      username: "Mozi Faucet Bot",
      embeds: [
        {
          title: `📒 Laporan Akun: ${account}`,
          description: `
${fullMessage}`,
          color: 0x3498db,
          timestamp: new Date().toISOString(),
          footer: { text: "Mozi Watchdog 🕵️" }
        }
      ]
    });
  } catch (err) {
    console.error("❌ Gagal kirim log ringkasan ke Discord:", err.message);
  }
}

async function withRetry(fn, account, retries = 3, delayMs = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isNotEligible = err.response?.data?.message === "Not eligible.";
      if (isNotEligible) {
        log(account, "🚫 Faucet sudah diklaim, lanjut ke transfer.");
        return { eligible: false };
      }
      log(account, `⚠️ Attempt ${i + 1} gagal → ${err.response?.status} ${JSON.stringify(err.response?.data || err.message)}`);
      if (i < retries - 1) await delay(delayMs);
      else log(account, `❌ Final error → ${JSON.stringify(err.response?.data || err.message)}`);
    }
  }
}

async function claimFaucet(account, headers) {
  return await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/faucet`, {}, {
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
    if (res.data?.result === "success" && res.data?.txHash) {
      log(account, `✅ Faucet claimed! TX: ${res.data.txHash}`);
      await sendDiscordNotification(account, "✅ Faucet Claimed", `Berhasil klaim faucet.`, res.data.txHash);
      return { claimed: true };
    }
    if (res.data?.message === "Not eligible.") {
      log(account, "🕒 Faucet sudah diklaim.");
      return { claimed: false, eligible: false };
    }
    log(account, `❌ Unexpected response: ${JSON.stringify(res.data)}`);
    return { claimed: false };
  }, account);
}

async function getBalance(account, headers) {
  try {
    const res = await axios.get(`${API_BASE}/api/wallet-data/tokens`, { headers });
    const tokens = res.data?.result?.data || [];
    const mon = tokens.find(t => t.symbol === "MON");
    const balance = mon?.balance || "0";
    log(account, `💰 MON Balance: ${balance}`);
    return balance;
  } catch (err) {
    log(account, `🚨 Gagal cek balance: ${JSON.stringify(err.response?.data || err.message)}`);
    return "0";
  }
}

async function sendMon(account, headers, amount) {
  const weiValue = (BigInt(parseFloat(amount) * 1e18)).toString();
  await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/wallet/tx/send`, {
      to: RECEIVER,
      value: weiValue,
      chainId: 10143
    }, { headers });
    if (res.data?.status === "success") {
      log(account, `📤 Sent ${amount} MON to ${RECEIVER}`);
      log(account, `🔗 TX Hash: ${res.data.data}`);
      await sendDiscordNotification(account, "📤 Transfer MON", `Kirim ${amount} MON ke ${RECEIVER}`, res.data.data);
    } else {
      log(account, `❌ Transfer gagal: ${JSON.stringify(res.data)}`);
    }
  }, account);
}

async function runForAccount(token) {
  const username = getUsernameFromToken(token);
  const headers = { Authorization: `Bearer ${token}` };

  console.log("=".repeat(50));
  console.log(`🔍 Memproses akun: ${username}`);

  const claimResult = await claimFaucet(username, headers);
  await delay(10000);
  const balance = await getBalance(username, headers);
  if (parseFloat(balance) >= 0.01) {
    await sendMon(username, headers, "0.01");
  } else {
    log(username, `⚠️ MON tidak cukup untuk transfer.`);
  }
  await sendDiscordLogSummary(username);
}

async function runLoop() {
  while (true) {
    console.log(`\n🚀 Menjalankan semua akun (${TOKENS.length})`);
    for (const token of TOKENS) {
      await runForAccount(token);
    }
    console.log("⏱️ Selesai semua akun. Tidur 24 jam...");
    await countdown(24 * 60 * 60 * 1000);
  }
}

runLoop();
