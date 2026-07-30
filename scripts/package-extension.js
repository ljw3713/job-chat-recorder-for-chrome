const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { transformSync } = require('esbuild');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const distDir = path.join(rootDir, 'dist');
const stageDir = path.join(distDir, '.extension-package');
const skipGa4 = process.argv.includes('--skip-ga4');

const packageFiles = [
  'manifest.json',
  'popup.html',
  'results.html',
  'src/popup.js',
  'src/results.js',
  'src/results-database.js',
  'src/background.js',
  'src/background-database.js',
  'src/analytics.js',
  'src/runtime-config.js',
  'src/shared-utils.js',
  'src/shared-records.js',
  'src/content-common.js',
  'src/site-adapters.js',
  'src/job-sync-core.js',
  'src/boss-extractor.js',
  'src/liepin-extractor.js',
  'src/content.js',
  'src/boss-hook.js',
  'src/boss-message-protocol.js',
  'assets/icons/icon-16.png',
  'assets/icons/icon-32.png',
  'assets/icons/icon-48.png',
  'assets/icons/icon-128.png'
];

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function copyPackageFiles() {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const relativePath of packageFiles) {
    const sourcePath = path.join(rootDir, relativePath);
    const targetPath = path.join(stageDir, relativePath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing package file: ${relativePath}`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }

  const runtimeConfigPath = path.join(stageDir, 'src/runtime-config.js');
  const developmentConfig = fs.readFileSync(runtimeConfigPath, 'utf8');
  let releaseConfig = developmentConfig.replace('enableDebugLog: true', 'enableDebugLog: false');
  if (releaseConfig === developmentConfig) throw new Error('Unable to create release runtime config.');
  if (skipGa4) {
    const disabledConfig = releaseConfig.replace('analyticsEnabled: true', 'analyticsEnabled: false');
    if (disabledConfig === releaseConfig) throw new Error('Unable to disable GA4 for skipped build.');
    releaseConfig = disabledConfig;
  }
  const measurementId = skipGa4 ? '' : String(process.env.JOB_CHAT_GA4_MEASUREMENT_ID || '').trim();
  const apiSecret = skipGa4 ? '' : String(process.env.JOB_CHAT_GA4_API_SECRET || '').trim();
  if (!skipGa4 && (!measurementId || !apiSecret)) {
    throw new Error(
      'JOB_CHAT_GA4_MEASUREMENT_ID and JOB_CHAT_GA4_API_SECRET are required. '
      + 'Use "npm run package -- --skip-ga4" to explicitly build without analytics.'
    );
  }
  if (measurementId && !/^G-[A-Z0-9]+$/i.test(measurementId)) {
    throw new Error('JOB_CHAT_GA4_MEASUREMENT_ID must use the G-XXXXXXXX format.');
  }
  if (measurementId) {
    const measurementPlaceholder = "ga4MeasurementId: ''";
    const secretPlaceholder = "ga4ApiSecret: ''";
    if (!releaseConfig.includes(measurementPlaceholder) || !releaseConfig.includes(secretPlaceholder)) {
      throw new Error('Unable to inject GA4 release config.');
    }
    releaseConfig = releaseConfig
      .replace(measurementPlaceholder, `ga4MeasurementId: ${JSON.stringify(measurementId)}`)
      .replace(secretPlaceholder, `ga4ApiSecret: ${JSON.stringify(apiSecret)}`);
  }
  fs.writeFileSync(runtimeConfigPath, releaseConfig);
  return { analyticsEnabled: Boolean(measurementId) };
}

function minifyJavaScriptFiles() {
  let originalBytes = 0;
  let minifiedBytes = 0;

  for (const relativePath of packageFiles.filter((file) => file.endsWith('.js'))) {
    const filePath = path.join(stageDir, relativePath);
    const source = fs.readFileSync(filePath, 'utf8');
    const result = transformSync(source, {
      loader: 'js',
      target: 'es2020',
      minifySyntax: true,
      minifyWhitespace: true,
      minifyIdentifiers: false,
      legalComments: 'none',
      sourcemap: false,
      charset: 'utf8'
    });
    const minified = `${result.code.trim()}\n`;
    originalBytes += Buffer.byteLength(source);
    minifiedBytes += Buffer.byteLength(minified);
    fs.writeFileSync(filePath, minified);
  }

  return { originalBytes, minifiedBytes };
}

function createZip(outputName) {
  const outputPath = path.join(distDir, outputName);
  fs.rmSync(outputPath, { force: true });

  const result = spawnSync('zip', ['-X', '-r', outputPath, '.'], {
    cwd: stageDir,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`zip failed:\n${result.stderr || result.stdout}`);
  }

  return outputPath;
}

function main() {
  const manifest = readManifest();
  const outputName = `job-chat-recorder-v${manifest.version}.zip`;

  fs.mkdirSync(distDir, { recursive: true });
  const releaseConfig = copyPackageFiles();
  const minifyStats = minifyJavaScriptFiles();

  const outputPath = createZip(outputName);
  fs.rmSync(stageDir, { recursive: true, force: true });

  console.log(`Created ${path.relative(rootDir, outputPath)}`);
  console.log(`Included ${packageFiles.length} files.`);
  console.log(`Minified JavaScript: ${minifyStats.originalBytes} -> ${minifyStats.minifiedBytes} bytes.`);
  console.log(`GA4 analytics: ${releaseConfig.analyticsEnabled ? 'enabled' : 'disabled (--skip-ga4)'}.`);
}

main();
