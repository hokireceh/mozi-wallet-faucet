const fs = require('fs');

// Data akun-akun kamu (JSON)
const raw = [
{
    "accessToken": "",
    "refreshToken": ""
}
];

// Data receiver wallet & webhook
const RECEIVER = "0x103D1D8d46de2E7829Ad5FBe2D322c705B602780";
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1360668461940080640/vxoh7Xnw7UyjoywzaNdvTtXh5ortzWlkdnHqBLOzGLDWY5NljNhVPIICtumj8O1JPgbJ";

try {
  const authJson = JSON.stringify(raw);
  const output = `
AUTH_JSON='${authJson}'
RECEIVER=${RECEIVER}
DISCORD_WEBHOOK=${DISCORD_WEBHOOK}
  `.trim();

  fs.writeFileSync('.env', output + '\n');
  console.log('\n✅ Saved to .env');
} catch (err) {
  console.error('❌ Error:', err.message);
}
