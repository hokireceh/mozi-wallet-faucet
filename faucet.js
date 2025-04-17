// ⚙️ CONFIG & SETUP
require("dotenv").config();
const axios = require("axios");

const API_BASE = "https://api.mozi.finance";
const TOKEN_PAIRS = (() => {
  try {
    return JSON.parse(process.env.AUTH_JSON || "[]")
      .map(p => ({
        accessToken: p.accessToken?.trim(),
        refreshToken: p.refreshToken?.trim()
      }))
      .filter(p => p.accessToken && p.refreshToken);
  } catch (e) {
    console.error("❌ Gagal parse AUTH_JSON COK:", e.message);
    return [];
  }
})();

const RECEIVER = process.env.RECEIVER;
const WEBHOOK = process.env.DISCORD_WEBHOOK;
const delay = ms => new Promise(res => setTimeout(res, ms));

const getUsernameFromToken = token => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload?.userData?.username || token.slice(0, 6);
  } catch {
    return token.slice(0, 6);
  }
};

const discordLogs = {};
const log = (account, message) => {
  console.log(`[${account}] ${message}`);
  discordLogs[account] = discordLogs[account] || [];
  discordLogs[account].push(`[${account}] ${message}`);
};

const sendDiscordNotification = async (account, title, message, txHash = null) => {
  if (!WEBHOOK?.startsWith("https://")) return;
  try {
    await axios.post(WEBHOOK, {
      username: "Mozi Faucet Bot",
      embeds: [{
        title,
        description: `${message}${txHash ? `\n\n🔗 [Lihat TX](https://testnet.monadexplorer.com/tx/${txHash})` : ""}`,
        color: 0x00ff99,
        timestamp: new Date().toISOString(),
        footer: { text: `Akun ${account} - Mozi Watchdog 🕵️` }
      }]
    });
  } catch (e) {
    console.error("❌ DISCORD ERROR COK:", e.message);
  }
};

const sendDiscordLogSummary = async (account) => {
  if (!WEBHOOK?.startsWith("https://") || !discordLogs[account]) return;
  const fullMessage = discordLogs[account].join("\n").slice(0, 4000);
  try {
    await axios.post(WEBHOOK, {
      username: "Mozi Faucet Bot",
      embeds: [{
        title: `📒 Rekapan Akun: ${account}`,
        description: fullMessage,
        color: 0x3498db,
        timestamp: new Date().toISOString(),
        footer: { text: "Mozi Watchdog 🕵️" }
      }]
    });
  } catch (e) {
    console.error("❌ Gagal ngirim ringkasan COK:", e.message);
  }
};

const withRetry = async (fn, account, retries = 3, delayMs = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.response?.data?.message;
      if (msg === "Not eligible.") {
        log(account, "🚫 Wis ra prawan, langsung Croot!");
        return { eligible: false };
      }
      if (err.response?.status === 401) throw err;
      log(account, `⚠️ Gagal attempt ${i + 1} → ${msg || err.message}`);
      if (i < retries - 1) await delay(delayMs);
      else log(account, `❌ Error terakhir → ${msg || err.message}`);
    }
  }
};

const refreshAccessToken = async (refreshToken, account) => {
  try {
    const res = await axios.post(`${API_BASE}/api/auth/refresh-token`, { refreshToken });
    const newToken = res.data?.accessToken;
    if (newToken) {
      log(account, "🔄 Token diperbarui sukses, COK!");
      return newToken;
    }
    log(account, "❌ Gagal refresh token, accessToken kosong!");
  } catch (err) {
    log(account, `❌ ERROR REFRESH: ${err.response?.status} ${JSON.stringify(err.response?.data || err.message)}`);
  }
  return null;
};

const getBalance = async (account, headers) => {
  try {
    const res = await axios.get(`${API_BASE}/api/wallet-data/tokens`, { headers });
    const tokens = res.data?.result?.data || [];
    const monToken = tokens.find(t => t.symbol === "MON" || t.isNative);
    const balance = parseFloat(monToken?.balance || "0");
    log(account, `💰 Saldo MON: ${balance}`);
    return { monBalance: balance, nativeBalance: balance };
  } catch (err) {
    log(account, `🚨 Gagal ambil saldo: ${JSON.stringify(err.response?.data || err.message)}`);
    return { monBalance: 0, nativeBalance: 0 };
  }
};

const claimFaucet = async (account, headers) =>
  await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/faucet`, {}, { headers });
    if (res.data?.result === "success" && res.data?.txHash) {
      log(account, `✅ Dapet faucet! TX: ${res.data.txHash}`);
      await sendDiscordNotification(account, "✅ Faucet Claimed", "Berhasil klaim faucet.", res.data.txHash);
      return { claimed: true };
    }
    if (res.data?.message === "Not eligible.") {
      log(account, "🕒 Faucet wis tau dijupuk. Skip.");
      return { claimed: false, eligible: false };
    }
    log(account, `❌ Respon aneh: ${JSON.stringify(res.data)}`);
    return { claimed: false };
  }, account);

const sendMon = async (account, headers, balance, nativeBalance) => {
  const reserveForGas = 0.005;
  const total = parseFloat(balance);
  if (nativeBalance < reserveForGas) {
    log(account, "⛔ Kurang lunyu Cok, Ora iso kirim MON.");
    return;
  }
  const amountToSend = total > reserveForGas ? (total - reserveForGas) : 0;
  if (amountToSend <= 0) {
    log(account, "⚠️ MON kurang. Sisane mung gawe gas.");
    return;
  }
  const wei = (BigInt(amountToSend * 1e18)).toString();
  await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/wallet/tx/send`, {
      to: RECEIVER,
      value: wei,
      chainId: 10143
    }, { headers });
    if (res.data?.status === "success") {
      log(account, `📤 Kirim ${amountToSend.toFixed(5)} MON nang ${RECEIVER}`);
      await sendDiscordNotification(account, "📤 Transfer MON", `Kirim ${amountToSend.toFixed(5)} MON ke ${RECEIVER}`, res.data.data);
    } else {
      log(account, `❌ Gagal transfer: ${JSON.stringify(res.data)}`);
    }
  }, account);
};

const runForAccount = async (pair) => {
  let token = pair.accessToken;
  const account = getUsernameFromToken(token);
  let headers = () => ({ Authorization: `Bearer ${token}` });
  console.log("=".repeat(60));
  console.log(`🔍 NGGARAP : ${account}`);
  try {
    await claimFaucet(account, headers());
    await delay(10000);
    const { monBalance, nativeBalance } = await getBalance(account, headers());
    await sendMon(account, headers(), monBalance, nativeBalance);
    await sendDiscordLogSummary(account);
  } catch (err) {
    if (err.response?.status === 401) {
      log(account, "⚠️ Token kadaluarsa, cobak refresh...");
      const newToken = await refreshAccessToken(pair.refreshToken, account);
      if (newToken) {
        token = newToken;
        headers = () => ({ Authorization: `Bearer ${token}` });
        await runForAccount({ accessToken: newToken, refreshToken: pair.refreshToken });
      } else {
        log(account, "🚫 Gagal refresh, skip sek COK!");
      }
    } else {
      log(account, `❌ ERROR PARAH: ${JSON.stringify(err.response?.data || err.message)}`);
    }
  }
};

const runOnce = async () => {
  console.log(`\n🚀 NGGASPOL KABEH AKUN (${TOKEN_PAIRS.length})\n`);
  for (const pair of TOKEN_PAIRS) {
    await runForAccount(pair);
  }
  console.log("\n✅ RAMPUNG SEMUA COK!\n");
  process.exit(0);
};

runOnce();
