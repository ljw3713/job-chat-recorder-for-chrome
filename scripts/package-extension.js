const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { transformSync } = require('esbuild');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const distDir = path.join(rootDir, 'dist');
const skipGa4 = process.argv.includes('--skip-ga4');
const DEFAULT_CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/%E7%9B%B4%E8%81%98%E7%8C%8E%E8%81%98-%E6%B2%9F%E9%80%9A%E5%8A%A9%E6%89%8B/phnaloiemmlklelkahjmpmhemmdidkmj';

const packageFiles = [
  'manifest.json',
  'popup.html',
  'auto-message-panel.html',
  'results.html',
  'src/popup.js',
  'src/auto-message-panel.js',
  'src/results.js',
  'src/results-database.js',
  'src/background.js',
  'src/background-database.js',
  'src/deepseek-job-matcher.js',
  'src/analytics.js',
  'src/runtime-config.js',
  'src/shared-utils.js',
  'src/shared-records.js',
  'src/content-common.js',
  'src/online-job-filter.js',
  'src/site-adapters.js',
  'src/job-sync-core.js',
  'src/boss-extractor.js',
  'src/liepin-extractor.js',
  'src/content.js',
  'src/boss-auto-greeting.js',
  'src/liepin-auto-greeting.js',
  'src/boss-hook.js',
  'src/liepin-online-job-hook.js',
  'src/boss-message-protocol.js',
  'assets/icons/icon-16.png',
  'assets/icons/icon-32.png',
  'assets/icons/icon-48.png',
  'assets/icons/icon-128.png'
];

function parseBrowserTarget(argv) {
  const browserArguments = argv.filter((argument) => argument.startsWith('--browser='));
  if (browserArguments.length > 1) throw new Error('Only one --browser argument is allowed.');
  const target = browserArguments.length ? browserArguments[0].slice('--browser='.length) : 'chrome';
  if (!['chrome', 'edge', 'all'].includes(target)) {
    throw new Error(`Unsupported browser target: ${target}. Use chrome, edge, or all.`);
  }
  return target;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function stagePath(browserTarget) {
  return path.join(distDir, `.extension-package-${browserTarget}`);
}

function storeUrlFor(browserTarget) {
  if (browserTarget === 'chrome') {
    return String(process.env.JOB_CHAT_CHROME_STORE_URL || DEFAULT_CHROME_STORE_URL).trim();
  }
  return String(process.env.JOB_CHAT_EDGE_STORE_URL || '').trim();
}

function replaceRequired(source, searchValue, replacement, errorMessage) {
  if (!source.includes(searchValue)) throw new Error(errorMessage);
  return source.replace(searchValue, replacement);
}

function copyPackageFiles(stageDir, browserTarget) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const relativePath of packageFiles) {
    const sourcePath = path.join(rootDir, relativePath);
    const targetPath = path.join(stageDir, relativePath);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing package file: ${relativePath}`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }

  const packagedManifestPath = path.join(stageDir, 'manifest.json');
  const packagedManifest = JSON.parse(fs.readFileSync(packagedManifestPath, 'utf8'));
  if (!packagedManifest.name.endsWith('-dev')) {
    throw new Error('Development manifest name must end with "-dev".');
  }
  packagedManifest.name = packagedManifest.name.slice(0, -'-dev'.length);
  if (browserTarget === 'edge') delete packagedManifest.minimum_chrome_version;
  fs.writeFileSync(packagedManifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`);

  const runtimeConfigPath = path.join(stageDir, 'src/runtime-config.js');
  const developmentConfig = fs.readFileSync(runtimeConfigPath, 'utf8');
  let releaseConfig = replaceRequired(
    developmentConfig,
    'enableDebugLog: true',
    'enableDebugLog: false',
    'Unable to create release runtime config.'
  );
  if (skipGa4) {
    releaseConfig = replaceRequired(
      releaseConfig,
      'analyticsEnabled: true',
      'analyticsEnabled: false',
      'Unable to disable GA4 for skipped build.'
    );
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
    releaseConfig = replaceRequired(
      releaseConfig,
      "ga4MeasurementId: ''",
      `ga4MeasurementId: ${JSON.stringify(measurementId)}`,
      'Unable to inject GA4 measurement ID.'
    );
    releaseConfig = replaceRequired(
      releaseConfig,
      "ga4ApiSecret: ''",
      `ga4ApiSecret: ${JSON.stringify(apiSecret)}`,
      'Unable to inject GA4 API Secret.'
    );
  }

  const storeUrl = storeUrlFor(browserTarget);
  const storeUrlPattern = /storeUrl:\s*'[^']*'/;
  if (!storeUrlPattern.test(releaseConfig)) {
    throw new Error('Unable to set the rating store URL for the release package.');
  }
  releaseConfig = releaseConfig.replace(storeUrlPattern, `storeUrl: ${JSON.stringify(storeUrl)}`);
  if (browserTarget === 'edge' && releaseConfig.includes('chromewebstore.google.com')) {
    throw new Error('Edge release package must not include a Chrome Web Store URL.');
  }
  fs.writeFileSync(runtimeConfigPath, releaseConfig);
  return { analyticsEnabled: Boolean(measurementId), storeUrl };
}

function minifyJavaScriptFiles(stageDir) {
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

function outputName(browserTarget, version) {
  return `job-chat-recorder-${browserTarget}-v${version}.zip`;
}

function createZip(stageDir, outputNameValue) {
  const outputPath = path.join(distDir, outputNameValue);
  fs.rmSync(outputPath, { force: true });
  const result = spawnSync('zip', ['-X', '-r', outputPath, '.'], {
    cwd: stageDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(`zip failed:\n${result.stderr || result.stdout}`);
  return outputPath;
}

function verifyZip(outputPath, browserTarget) {
  const integrity = spawnSync('unzip', ['-t', outputPath], { encoding: 'utf8' });
  if (integrity.status !== 0) throw new Error(`ZIP integrity check failed:\n${integrity.stderr || integrity.stdout}`);

  const manifestResult = spawnSync('unzip', ['-p', outputPath, 'manifest.json'], { encoding: 'utf8' });
  if (manifestResult.status !== 0) throw new Error(`Unable to read packaged manifest:\n${manifestResult.stderr || manifestResult.stdout}`);
  const packagedManifest = JSON.parse(manifestResult.stdout);
  if (packagedManifest.name.endsWith('-dev')) throw new Error('Release manifest name must not end with "-dev".');
  if (browserTarget === 'edge' && Object.hasOwn(packagedManifest, 'minimum_chrome_version')) {
    throw new Error('Edge release manifest must not include minimum_chrome_version.');
  }
  if (browserTarget === 'chrome' && !Object.hasOwn(packagedManifest, 'minimum_chrome_version')) {
    throw new Error('Chrome release manifest must include minimum_chrome_version.');
  }
}

function buildBrowserPackage(browserTarget, manifest) {
  const stageDir = stagePath(browserTarget);
  try {
    const releaseConfig = copyPackageFiles(stageDir, browserTarget);
    const minifyStats = minifyJavaScriptFiles(stageDir);
    const outputPath = createZip(stageDir, outputName(browserTarget, manifest.version));
    verifyZip(outputPath, browserTarget);
    console.log(`Created ${path.relative(rootDir, outputPath)}`);
    console.log(`Included ${packageFiles.length} files.`);
    console.log(`Minified JavaScript: ${minifyStats.originalBytes} -> ${minifyStats.minifiedBytes} bytes.`);
    console.log(`GA4 analytics: ${releaseConfig.analyticsEnabled ? 'enabled' : 'disabled (--skip-ga4)'}.`);
    console.log(`Rating store: ${releaseConfig.storeUrl || 'disabled'}.`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

function main() {
  const browserTarget = parseBrowserTarget(process.argv.slice(2));
  const manifest = readManifest();
  const targets = browserTarget === 'all' ? ['chrome', 'edge'] : [browserTarget];
  fs.mkdirSync(distDir, { recursive: true });
  for (const target of targets) buildBrowserPackage(target, manifest);
}

main();
