const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageScript = path.join(__dirname, 'package-extension.js');
const skipGa4 = process.argv.includes('--skip-ga4');
const browserArguments = process.argv.filter((argument) => argument.startsWith('--browser='));

if (browserArguments.length > 1) {
  throw new Error('Only one --browser argument is allowed.');
}

const browserArgs = browserArguments;

function askVisible(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error(
      'GA4 configuration is required in non-interactive mode. '
      + 'Set JOB_CHAT_GA4_MEASUREMENT_ID and JOB_CHAT_GA4_API_SECRET.'
    ));
  }
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error(
      'GA4 API Secret is required in non-interactive mode. '
      + 'Set JOB_CHAT_GA4_API_SECRET.'
    ));
  }

  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = '';

    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
    };

    const finish = () => {
      cleanup();
      output.write('\n');
      resolve(value.trim());
    };

    const cancel = () => {
      cleanup();
      output.write('\n');
      reject(new Error('Packaging cancelled.'));
    };

    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          cancel();
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };

    output.write(question);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

function runPackage(environment, args = []) {
  const result = spawnSync(process.execPath, [packageScript, ...args], {
    cwd: rootDir,
    env: environment,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

async function main() {
  if (skipGa4) {
    runPackage(process.env, ['--skip-ga4', ...browserArgs]);
    return;
  }

  const measurementId = String(process.env.JOB_CHAT_GA4_MEASUREMENT_ID || '').trim()
    || await askVisible('GA4 Measurement ID (G-XXXXXXXXXX): ');
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) {
    throw new Error('GA4 Measurement ID must use the G-XXXXXXXX format.');
  }

  const apiSecret = String(process.env.JOB_CHAT_GA4_API_SECRET || '').trim()
    || await askSecret('GA4 Measurement Protocol API Secret: ');
  if (!apiSecret) throw new Error('GA4 Measurement Protocol API Secret is required.');

  runPackage({
    ...process.env,
    JOB_CHAT_GA4_MEASUREMENT_ID: measurementId,
    JOB_CHAT_GA4_API_SECRET: apiSecret
  }, browserArgs);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
