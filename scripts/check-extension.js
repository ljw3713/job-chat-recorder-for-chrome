const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packageScriptPath = path.join(rootDir, 'scripts/package-extension.js');

function assertFile(relativePath, referencedBy) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${referencedBy} references missing file: ${relativePath}`);
  }
}

function walkJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function checkJavaScriptSyntax() {
  const files = [
    ...walkJavaScriptFiles(path.join(rootDir, 'src')),
    ...walkJavaScriptFiles(path.join(rootDir, 'scripts'))
  ];
  for (const filePath of files) {
    const result = spawnSync(process.execPath, ['--check', filePath], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `Syntax check failed: ${filePath}`);
    }
  }
  return files.length;
}

function manifestReferences(manifest) {
  const files = new Set();
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  if (manifest.side_panel?.default_path) files.add(manifest.side_panel.default_path);
  for (const definition of manifest.content_scripts || []) {
    for (const file of definition.js || []) files.add(file);
  }
  for (const definition of manifest.web_accessible_resources || []) {
    for (const file of definition.resources || []) files.add(file);
  }
  for (const sizeMap of [manifest.icons, manifest.action?.default_icon]) {
    for (const file of Object.values(sizeMap || {})) files.add(file);
  }
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  return files;
}

function htmlScriptReferences(relativePath) {
  const html = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function workerImportReferences(relativePath) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const workerDirectory = path.posix.dirname(relativePath);
  return [...source.matchAll(/importScripts\(([^)]*)\)/g)]
    .flatMap((call) => [...call[1].matchAll(/["']([^"']+\.js)["']/g)])
    .map((match) => path.posix.join(workerDirectory, match[1]));
}

function packageFileReferences() {
  const source = fs.readFileSync(packageScriptPath, 'utf8');
  const match = source.match(/const packageFiles = \[([\s\S]*?)\];/);
  if (!match) throw new Error('Unable to read packageFiles from scripts/package-extension.js.');
  return new Set([...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]));
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const referencedFiles = manifestReferences(manifest);
  const htmlFiles = new Set(['popup.html', 'results.html', 'auto-message-panel.html']);
  if (manifest.side_panel?.default_path) htmlFiles.add(manifest.side_panel.default_path);
  for (const htmlFile of htmlFiles) {
    assertFile(htmlFile, 'CI');
    for (const scriptFile of htmlScriptReferences(htmlFile)) referencedFiles.add(scriptFile);
  }
  for (const importedFile of workerImportReferences(manifest.background.service_worker)) {
    if (importedFile.endsWith('/runtime-config.local.js')) continue;
    referencedFiles.add(importedFile);
  }

  const packageFiles = packageFileReferences();
  for (const relativePath of referencedFiles) {
    assertFile(relativePath, 'Extension');
    if (!packageFiles.has(relativePath)) {
      throw new Error(`Package file list is missing extension dependency: ${relativePath}`);
    }
  }
  for (const relativePath of packageFiles) assertFile(relativePath, 'Package file list');

  const checkedCount = checkJavaScriptSyntax();
  console.log(`CI checks passed: ${checkedCount} JavaScript files, ${referencedFiles.size} extension references.`);
}

main();
