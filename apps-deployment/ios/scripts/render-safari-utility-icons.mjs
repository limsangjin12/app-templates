#!/usr/bin/env node
// Render full-bleed app icons for the Safari utility apps.
//
// App Store icons must be square artwork with no transparent/white padding.
// The OS applies its own mask, so this script fills every pixel of the source
// image and derives all iOS, macOS, watchOS, extension, and docs sizes from it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const apps = [
  {
    dir: 'utilities/autoscroll',
    ios: 'AutoScroll',
    mac: 'AutoScrollMac',
    watch: 'AutoScrollWatch',
    gradient: ['#007aff', '#00a2ff'],
    extension: '#0a84ff',
    symbol: 'scroll',
  },
  {
    dir: 'utilities/auto-refresh',
    ios: 'AutoRefresh',
    mac: 'AutoRefreshMac',
    gradient: ['#16a34a', '#35d66b'],
    extension: '#30d158',
    symbol: 'refresh',
  },
  {
    dir: 'utilities/web-screenshot',
    ios: 'WebScreenshot',
    mac: 'WebScreenshotMac',
    gradient: ['#5448ff', '#8d5cff'],
    extension: '#6e5cff',
    symbol: 'screenshot',
  },
  {
    dir: 'utilities/autoscripts',
    ios: 'Autoscripts',
    mac: 'AutoscriptsMac',
    sourceImage: true,
  },
];

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function scaledDraw(commands, size) {
  const ratio = size / 1024;
  return commands.map(command => {
    if (command.type === 'path') {
      return `path '${command.d}'`;
    }
    if (command.type === 'line') {
      return `line ${command.x1 * ratio},${command.y1 * ratio} ${command.x2 * ratio},${command.y2 * ratio}`;
    }
    if (command.type === 'roundRectangle') {
      return `roundrectangle ${command.x1 * ratio},${command.y1 * ratio} ${command.x2 * ratio},${command.y2 * ratio} ${command.rx * ratio},${command.ry * ratio}`;
    }
    if (command.type === 'circle') {
      return `circle ${command.cx * ratio},${command.cy * ratio} ${command.cx * ratio},${(command.cy - command.r) * ratio}`;
    }
    throw new Error(`Unknown draw command: ${command.type}`);
  }).join(' ');
}

function symbolDraw(app, size) {
  const ratio = size / 1024;
  const sw = Math.max(2, Math.round({
    scroll: 74,
    refresh: 72,
    screenshot: 62,
  }[app.symbol] * ratio));

  const symbols = {
    scroll: [
      { type: 'line', x1: 512, y1: 260, x2: 512, y2: 615 },
      { type: 'path', d: `M ${355 * ratio},${468 * ratio} L ${512 * ratio},${625 * ratio} L ${669 * ratio},${468 * ratio}` },
      { type: 'line', x1: 330, y1: 742, x2: 694, y2: 742 },
    ],
    refresh: [
      { type: 'path', d: `M ${712 * ratio},${360 * ratio} C ${650 * ratio},${282 * ratio} ${536 * ratio},${254 * ratio} ${438 * ratio},${300 * ratio} C ${304 * ratio},${362 * ratio} ${246 * ratio},${522 * ratio} ${320 * ratio},${652 * ratio} C ${394 * ratio},${782 * ratio} ${560 * ratio},${822 * ratio} ${684 * ratio},${736 * ratio} C ${728 * ratio},${706 * ratio} ${760 * ratio},${662 * ratio} ${776 * ratio},${612 * ratio}` },
      { type: 'path', d: `M ${726 * ratio},${220 * ratio} L ${726 * ratio},${382 * ratio} L ${564 * ratio},${382 * ratio}` },
    ],
    screenshot: [
      { type: 'path', d: `M ${310 * ratio},${272 * ratio} L ${252 * ratio},${272 * ratio} L ${252 * ratio},${440 * ratio}` },
      { type: 'path', d: `M ${252 * ratio},${584 * ratio} L ${252 * ratio},${752 * ratio} L ${420 * ratio},${752 * ratio}` },
      { type: 'path', d: `M ${604 * ratio},${752 * ratio} L ${772 * ratio},${752 * ratio} L ${772 * ratio},${584 * ratio}` },
      { type: 'path', d: `M ${772 * ratio},${440 * ratio} L ${772 * ratio},${272 * ratio} L ${604 * ratio},${272 * ratio}` },
      { type: 'roundRectangle', x1: 350, y1: 354, x2: 674, y2: 616, rx: 46, ry: 46 },
    ],
  };

  return { strokeWidth: sw, draw: scaledDraw(symbols[app.symbol], size) };
}

function renderIconToPng(app, out, size) {
  if (app.sourceImage) {
    renderSourceImageToPng(app, out, size);
    return;
  }

  const [start, end] = app.gradient;
  const { strokeWidth, draw } = symbolDraw(app, size);
  ensureDir(out);
  run('magick', [
    '-size', `${size}x${size}`,
    `gradient:${start}-${end}`,
    '-fill', 'none',
    '-stroke', '#fff',
    '-strokewidth', String(strokeWidth),
    '-draw', draw,
    '-alpha', 'off',
    out,
  ]);
}

function renderExtensionIconToPng(app, out, size) {
  if (app.sourceImage) {
    renderSourceImageToPng(app, out, size);
    return;
  }

  const { strokeWidth, draw } = symbolDraw(app, size);
  ensureDir(out);
  run('magick', [
    '-size', `${size}x${size}`,
    'xc:transparent',
    '-fill', 'none',
    '-stroke', app.extension,
    '-strokewidth', String(strokeWidth),
    '-draw', draw,
    out,
  ]);
}

function renderSourceImageToPng(app, out, size) {
  const appRoot = path.join(root, app.dir);
  const source = path.join(appRoot, app.ios, 'Resources', 'app-icon-source.png');
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source icon: ${source}`);
  }

  ensureDir(out);
  const target = path.resolve(out);
  const tempOut = target === path.resolve(source)
    ? path.join(os.tmpdir(), `${app.ios}-app-icon-source-${size}-${Date.now()}.png`)
    : out;

  run('magick', [
    source,
    '-resize', `${size}x${size}!`,
    '-alpha', 'off',
    tempOut,
  ]);

  if (tempOut !== out) {
    fs.renameSync(tempOut, out);
  }
}

function dimensionsForImage(image) {
  const base = Number.parseFloat(String(image.size).split('x')[0]);
  const scale = image.scale === '3x' ? 3 : image.scale === '2x' ? 2 : 1;
  return Math.round(base * scale);
}

function renderAssetCatalog(app, catalogPath) {
  const jsonPath = path.join(catalogPath, 'Contents.json');
  if (!fs.existsSync(jsonPath)) return;
  const contents = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  for (const image of contents.images || []) {
    if (!image.filename) continue;
    const px = dimensionsForImage(image);
    renderIconToPng(app, path.join(catalogPath, image.filename), px);
  }
}

for (const app of apps) {
  const appRoot = path.join(root, app.dir);
  const master = path.join(appRoot, app.ios, 'Resources', 'app-icon-source.png');
  renderIconToPng(app, master, 1024);

  renderAssetCatalog(app, path.join(appRoot, app.ios, 'Resources', 'Assets.xcassets', 'AppIcon.appiconset'));
  renderAssetCatalog(app, path.join(appRoot, app.mac, 'Resources', 'Assets.xcassets', 'AppIcon.appiconset'));
  if (app.watch) {
    renderAssetCatalog(app, path.join(appRoot, app.watch, 'Resources', 'Assets.xcassets', 'AppIcon.appiconset'));
  }

  for (const size of [48, 96, 128]) {
    renderExtensionIconToPng(app, path.join(appRoot, 'ExtensionResources', 'images', `icon-${size}.png`), size);
  }
  for (const size of [192, 512]) {
    renderIconToPng(app, path.join(appRoot, 'docs', `icon-${size}.png`), size);
  }

  console.log(`wrote ${app.dir}`);
}
