const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const distDir = path.join(rootDir, 'dist');
const stageDir = path.join(distDir, '.extension-package');

const packageFiles = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'results.html',
  'results.js',
  'results-database.js',
  'background.js',
  'background-database.js',
  'shared-utils.js',
  'shared-records.js',
  'content-common.js',
  'boss-extractor.js',
  'liepin-extractor.js',
  'content.js',
  'boss-hook.js',
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
  copyPackageFiles();

  const outputPath = createZip(outputName);
  fs.rmSync(stageDir, { recursive: true, force: true });

  console.log(`Created ${path.relative(rootDir, outputPath)}`);
  console.log(`Included ${packageFiles.length} files.`);
}

main();
