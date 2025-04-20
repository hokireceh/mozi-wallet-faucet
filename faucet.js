// ⚙️ SETUP COK
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
    console.error("❌ Ndlogok, AUTH_JSON ra iso di-parse COK:", e.message);
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
  console.log(message);
  discordLogs[account] = discordLogs[account] || [];
  discordLogs[account].push(message);
};


const sendDiscordNotification = async (account, title, message, txHash = null) => {
  if (!WEBHOOK?.startsWith("https://")) return;
  try {
    await axios.post(WEBHOOK, {
      username: "Mozi Bot Kandang",
      embeds: [{
        title,
        description: `${message}${txHash ? `\n\n🔗 [Tx-e nang kene COK](https://testnet.monadexplorer.com/tx/${txHash})` : ""}`,
        color: 0xff69b4,
        timestamp: new Date().toISOString(),
        footer: { text: `👙 Purel ${account} - Lembur Mozi 🥵` }
      }]
    });
  } catch (e) {
    console.error("❌ DISCORD ERROR, kontol:", e.message);
  }
};

const sendDiscordLogSummary = async (account) => {
  if (!WEBHOOK?.startsWith("https://") || !discordLogs[account]) return;
  const fullMessage = discordLogs[account].join("\n").slice(0, 4000);
  try {
    await axios.post(WEBHOOK, {
      username: "Mozi Bot Kandang",
      embeds: [{
        title: `📒 Laporan Jancok: ${account}`,
        description: fullMessage,
        color: 0xdb3434,
        timestamp: new Date().toISOString(),
        footer: { text: "🌃 Kegiatan Lembur Purel Mozi" }
      }]
    });
  } catch (e) {
    console.error("❌ Gagal ngirim log, kontol:", e.message);
  }
};

const withRetry = async (fn, account, retries = 3, delayMs = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.response?.data?.message;
      if (msg === "Not eligible.") {
        log(account, "🚫 Wes diapusi, ora iso entuk maneh, COK!");
        return { eligible: false };
      }
      if (err.response?.status === 401) {
        log(account, "⚠️ Token kadaluarsa, COK!");
        return { claimed: false }; // Token kadaluarsa langsung skip tanpa refresh
      }
      log(account, `⚠️ Kerep njepat: attempt ${i + 1} → ${msg || err.message}`);
      if (i < retries - 1) await delay(delayMs);
      else log(account, `❌ Gagal total COK: ${msg || err.message}`);
    }
  }
};

const getBalance = async (account, headers) => {
  try {
    const res = await axios.get(`${API_BASE}/api/wallet-data/tokens`, { headers });
    const tokens = res.data?.result?.data || [];
    const monToken = tokens.find(t =>
      t.contractAddress === "0x0000000000000000000000000000000000000000"
    );
    const balance = parseFloat(monToken?.balance || "0");
    log(account, `💰 Isine dompet: ${balance} MON`);
    return { monBalance: balance, nativeBalance: balance };
  } catch (err) {
    log(account, `🚨 Ora iso nyedot saldo: ${JSON.stringify(err.response?.data || err.message)}`);
    return { monBalance: 0, nativeBalance: 0 };
  }
};

const claimFaucet = async (account, headers) =>
  await withRetry(async () => {
    const res = await axios.post(`${API_BASE}/api/faucet`, {}, { headers });
    if (res.data?.result === "success" && res.data?.txHash) {
      log(account, `✅ Klaim faucet rampung COK! TX: ${res.data.txHash}`);
      await sendDiscordNotification(account, "✅ Klaim Sukses", "Uwis entuk MON, lebokno dompet!", res.data.txHash);
      return { claimed: true };
    }
    if (res.data?.message === "Not eligible.") {
      log(account, "🕒 Ra iso, wes entuk sadurunge.");
      return { claimed: false, eligible: false };
    }
    log(account, `❌ Respon janggal COK: ${JSON.stringify(res.data)}`);
    return { claimed: false };
  }, account);

const sendMon = async (account, headers, balance, nativeBalance) => {
  const reserveForGas = 0.005;
  const total = parseFloat(balance);
  if (nativeBalance < reserveForGas) {
    log(account, "⛔ Gas ora cukup, MON ngendon ae.");
    return;
  }
  const amountToSend = total > reserveForGas ? (total - reserveForGas) : 0;
  if (amountToSend <= 0) {
    log(account, "⚠️ Kurang gas, ra iso dikirim.");
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
      log(account, `📤 Kirim ${amountToSend.toFixed(5)} MON → ${RECEIVER}`);
      await sendDiscordNotification(account, "📤 MON Mlayu", `Kirim ${amountToSend.toFixed(5)} MON nang ${RECEIVER}`, res.data.data);
    } else {
      log(account, `❌ Error kirim: ${JSON.stringify(res.data)}`);
    }
  }, account);
};

const runForAccount = async (pair) => {
  let token = pair.accessToken;
  const account = getUsernameFromToken(token);
  let headers = () => ({ Authorization: `Bearer ${token}` });
  console.log("✘⋇⊶==========================⊷⋇✘");
  console.log(`🔍 GILIRAN MU: ${account}`);
  console.log("✘⋇⊶==========================⊷⋇✘");
  try {
    await claimFaucet(account, headers());
    await delay(10000);
    const { monBalance, nativeBalance } = await getBalance(account, headers());
    await sendMon(account, headers(), monBalance, nativeBalance);
    await sendDiscordLogSummary(account);
  } catch (err) {
    if (err.response?.status === 401) {
      log(account, "⚠️ Token kadaluarsa, langsung skip.");
    } else {
      log(account, `❌ ERROR GEDE: ${JSON.stringify(err.response?.data || err.message)}`);
    }
  }
};

const runOnce = async () => {
  console.log(`\n🚀 NGGRAP ${TOKEN_PAIRS.length} PUREL SEK JHON!!!\n`);
  for (const pair of TOKEN_PAIRS) {
    await runForAccount(pair);
  }
  console.log("\n✅ WES RAMPUNG COK, WIS DADI ORA PERAWAN KABEH 😈\n");
  process.exit(0);
};

runOnce();
