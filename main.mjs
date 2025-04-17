import inquirer from 'inquirer';
import { spawn } from 'child_process';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

console.clear();
console.log(`\n===========================================`);
console.log(`🚀 Mozi Faucet Helper | HOKIRECEH MODE 🔥`);
console.log(`===========================================\n`);

function runWithLiveLogs(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true });

    child.on('exit', code => {
      resolve(code);
    });

    child.on('error', err => {
      reject(err);
    });
  });
}

async function autoBackToMenu() {
  console.log('\n🔄 Balik menyang menu nang 3 detik...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await mainMenu();
}

async function mainMenu() {
  try {
    const { choice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'choice',
        message: '👉 Pilih sing arep dijalanke, JANCOK:',
        choices: [
          { name: '🔁 MLK main.js (auto-claim & transfer)', value: 'main' },
          { name: '🛠️  MLK json.js (generate .env sek)', value: 'json' },
          { name: '❌ METU SEK COK', value: 'exit' }
        ]
      }
    ]);

    switch (choice) {
      case 'main':
        console.log('✅ Lagi mlaku main.js COK...\n');
        await runWithLiveLogs('node', ['faucet.js', '--once']);
        await autoBackToMenu();
        break;

      case 'json':
        console.log('✅ Lagi mlaku json.js COK...\n');
        await runWithLiveLogs('node', ['json.js']);
        await autoBackToMenu();
        break;

      case 'exit':
      default:
        console.log('👋 METU COK! RA USAH MLAYU-MLAYU.');
        process.exit(0);
    }
  } catch (err) {
    console.log('\n❌ Kesalahan: ', err.message || err);
    process.exit(1);
  }
}

mainMenu();
