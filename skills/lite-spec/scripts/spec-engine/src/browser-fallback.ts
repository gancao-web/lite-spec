import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { promisify } from 'node:util';
import type { OpenApiCollected, OpenApiCollectedOperation } from './connectors/openapi.js';
import WebSocket from 'ws';

const execFileAsync = promisify(execFile);

type ReqHeader = { name: string; value: string; required?: string };
type ReqParam = { name: string; desc?: string; required?: string };

export async function collectKnife4jDocWithBrowser(url: string): Promise<OpenApiCollected> {
  const browserPath = await findBrowserPath();
  if (!browserPath) {
    throw new Error('No local Edge/Chrome browser was found for Knife4j page fallback.');
  }

  const html = await dumpDomWithBrowser(browserPath, url);
  return parseKnife4jHtml(url, html);
}

export async function collectPageDomWithBrowser(url: string): Promise<string> {
  const browserPath = await findBrowserPath();
  if (!browserPath) {
    throw new Error('No local Edge/Chrome browser was found for page DOM fallback.');
  }

  return await dumpDomWithBrowser(browserPath, url);
}

export async function capturePagePreviewWithBrowser(
  url: string,
  outputPath: string,
  options: {
    width: number;
    height: number;
    quality?: number;
  },
): Promise<void> {
  const browserPath = await findBrowserPath();
  if (!browserPath) {
    throw new Error('No local Edge/Chrome browser was found for page preview capture.');
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lite-spec-preview-'));
  const pngPath = path.join(tmpDir, 'preview.png');
  try {
    const quality = clampInt(options.quality ?? 80, 30, 100);
    const fallbackWidth = clampInt(options.width, 900, 3200);
    const fallbackHeight = clampInt(options.height, 900, 2800);

    await capturePngWithBrowser(browserPath, url, pngPath, fallbackWidth, fallbackHeight);
    await trimSolidBorderInPlace(pngPath);
    await convertPngToJpeg(pngPath, outputPath, quality);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function capturePagePreviewSequenceWithBrowser(
  url: string,
  outputDir: string,
  baseName: string,
  options: {
    width: number;
    height: number;
    quality?: number;
  },
): Promise<string[]> {
  const browserPath = await findBrowserPath();
  if (!browserPath) {
    throw new Error('No local Edge/Chrome browser was found for page preview capture.');
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lite-spec-preview-seq-'));
  try {
    const quality = clampInt(options.quality ?? 80, 30, 100);
    const fallbackWidth = clampInt(options.width, 900, 3200);
    const fallbackHeight = clampInt(options.height, 900, 2800);

    let pngPaths: string[] = [];
    try {
      pngPaths = await capturePngSegmentsWithCdp(
        browserPath,
        url,
        tmpDir,
        baseName,
        fallbackWidth,
        fallbackHeight,
      );
    } catch {
      const fallbackPngPath = path.join(tmpDir, `${baseName}.png`);
      await execFileAsync(
        browserPath,
        [
          '--headless',
          '--disable-gpu',
          '--hide-scrollbars',
          '--virtual-time-budget=120000',
          '--run-all-compositor-stages-before-draw',
          `--window-size=${fallbackWidth},${fallbackHeight}`,
          `--screenshot=${fallbackPngPath}`,
          url,
        ],
        {
          windowsHide: true,
          timeout: 180000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      pngPaths = [fallbackPngPath];
    }

    const resultPaths: string[] = [];
    for (let i = 0; i < pngPaths.length; i += 1) {
      const pngPath = pngPaths[i];
      await trimSolidBorderInPlace(pngPath);
      const filename =
        pngPaths.length === 1
          ? `${baseName}.jpg`
          : `${baseName}-part${String(i + 1).padStart(2, '0')}.jpg`;
      const outputPath = path.join(outputDir, filename);
      await convertPngToJpeg(pngPath, outputPath, quality);
      resultPaths.push(outputPath);
    }

    return resultPaths;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function findBrowserPath(): Promise<string | null> {
  for (const candidate of getBrowserCandidates()) {
    try {
      await access(candidate);
      if (candidate) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getBrowserCandidates(): string[] {
  switch (os.platform()) {
    case 'win32':
      return [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];
    default:
      return [];
  }
}

async function dumpDomWithBrowser(browserPath: string, url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    browserPath,
    [
      '--headless',
      '--disable-gpu',
      '--virtual-time-budget=120000',
      '--run-all-compositor-stages-before-draw',
      '--dump-dom',
      url,
    ],
    {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const html = stdout.trim();
  if (!html) {
    throw new Error('Headless browser fallback returned empty DOM output.');
  }

  return html;
}

async function capturePngWithBrowser(
  browserPath: string,
  url: string,
  outputPath: string,
  fallbackWidth: number,
  fallbackHeight: number,
): Promise<void> {
  try {
    await capturePngWithCdp(browserPath, url, outputPath, fallbackWidth, fallbackHeight);
  } catch {
    await execFileAsync(
      browserPath,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--virtual-time-budget=120000',
        '--run-all-compositor-stages-before-draw',
        `--window-size=${fallbackWidth},${fallbackHeight}`,
        `--screenshot=${outputPath}`,
        url,
      ],
      {
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  }
}

async function capturePngSegmentsWithCdp(
  browserPath: string,
  url: string,
  tmpDir: string,
  baseName: string,
  fallbackWidth: number,
  fallbackHeight: number,
): Promise<string[]> {
  const browser = await launchBrowserForCdp(browserPath);
  try {
    const client = await createCdpClient(browser.wsUrl);
    try {
      const page = await client.createPage();
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Page.navigate', { url });
      await page.waitFor('Page.loadEventFired', 180000);
      await delay(1200);

      const metrics = await page.evaluate<{
        width?: number;
        height?: number;
      }>(`(() => {
        const doc = document.documentElement;
        const body = document.body;
        const parsePx = (value) => {
          if (!value || typeof value !== 'string') return 0;
          const matched = value.match(/-?\\d+(?:\\.\\d+)?/);
          return matched ? Number(matched[0]) : 0;
        };
        const computedBody = body ? window.getComputedStyle(body) : null;
        const computedDoc = doc ? window.getComputedStyle(doc) : null;
        const bodyRect = body?.getBoundingClientRect();
        const docRect = doc?.getBoundingClientRect();
        const bodyRectWidth = bodyRect ? Math.abs(bodyRect.right - bodyRect.left) : 0;
        const bodyRectHeight = bodyRect ? Math.abs(bodyRect.bottom - bodyRect.top) : 0;
        const docRectWidth = docRect ? Math.abs(docRect.right - docRect.left) : 0;
        const docRectHeight = docRect ? Math.abs(docRect.bottom - docRect.top) : 0;
        return {
          width: Math.max(
            doc?.scrollWidth || 0,
            body?.scrollWidth || 0,
            doc?.clientWidth || 0,
            body?.clientWidth || 0,
            doc?.offsetWidth || 0,
            body?.offsetWidth || 0,
            bodyRectWidth,
            docRectWidth,
            parsePx(computedBody?.width),
            parsePx(computedBody?.maxWidth),
            parsePx(computedDoc?.width),
            parsePx(computedDoc?.maxWidth)
          ),
          height: Math.max(
            doc?.scrollHeight || 0,
            body?.scrollHeight || 0,
            doc?.clientHeight || 0,
            body?.clientHeight || 0,
            doc?.offsetHeight || 0,
            body?.offsetHeight || 0,
            bodyRectHeight,
            docRectHeight,
            parsePx(computedBody?.height),
            parsePx(computedBody?.maxHeight),
            parsePx(computedDoc?.height),
            parsePx(computedDoc?.maxHeight)
          ),
        };
      })()`);

      const width = clampInt(metrics.width || fallbackWidth, 900, 3200);
      const fullHeight = clampInt(metrics.height || fallbackHeight, 900, 12000);
      const segmentHeight = 2200;
      const overlap = 120;
      const viewportHeight = Math.min(segmentHeight, fullHeight);
      const paths: string[] = [];

      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: viewportHeight,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(200);

      if (fullHeight <= 2400) {
        const screenshot = await page.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width,
            height: fullHeight,
            scale: 1,
          },
        });
        const base64 = stringValue(screenshot.data);
        if (!base64) {
          throw new Error('Browser screenshot capture returned empty payload.');
        }
        const outputPath = path.join(tmpDir, `${baseName}.png`);
        const { writeFile } = await import('node:fs/promises');
        await writeFile(outputPath, Buffer.from(base64, 'base64'));
        return [outputPath];
      }

      let index = 0;
      for (let y = 0; y < fullHeight; y += segmentHeight - overlap) {
        const clipHeight = Math.min(segmentHeight, fullHeight - y);
        const screenshot = await page.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y,
            width,
            height: clipHeight,
            scale: 1,
          },
        });
        const base64 = stringValue(screenshot.data);
        if (!base64) {
          throw new Error('Browser screenshot capture returned empty payload.');
        }
        index += 1;
        const outputPath = path.join(tmpDir, `${baseName}-part${String(index).padStart(2, '0')}.png`);
        const { writeFile } = await import('node:fs/promises');
        await writeFile(outputPath, Buffer.from(base64, 'base64'));
        paths.push(outputPath);
        if (y + clipHeight >= fullHeight) {
          break;
        }
      }

      return paths;
    } finally {
      await client.close();
    }
  } finally {
    browser.child.kill();
    await rm(browser.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertPngToJpeg(
  inputPath: string,
  outputPath: string,
  quality: number,
): Promise<void> {
  switch (os.platform()) {
    case 'win32':
      await convertPngToJpegOnWindows(inputPath, outputPath, quality);
      return;
    case 'darwin':
      await convertPngToJpegOnMac(inputPath, outputPath, quality);
      return;
    default:
      throw new Error('JPEG conversion is only supported on Windows and macOS.');
  }
}

async function convertPngToJpegOnWindows(
  inputPath: string,
  outputPath: string,
  quality: number,
): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$inputPath = '${escapeSingleQuoted(inputPath)}'
$outputPath = '${escapeSingleQuoted(outputPath)}'
$quality = ${quality}
$image = [System.Drawing.Image]::FromFile($inputPath)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$encoder = [System.Drawing.Imaging.Encoder]::Quality
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($encoder, [long]$quality)
$image.Save($outputPath, $codec, $params)
$image.Dispose()
`;

  await execFileAsync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function convertPngToJpegOnMac(
  inputPath: string,
  outputPath: string,
  quality: number,
): Promise<void> {
  await execFileAsync(
    'sips',
    ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), inputPath, '--out', outputPath],
    {
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function escapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

type BrowserLaunch = {
  child: ReturnType<typeof spawn>;
  wsUrl: string;
  userDataDir: string;
};

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
};

async function capturePngWithCdp(
  browserPath: string,
  url: string,
  outputPath: string,
  fallbackWidth: number,
  fallbackHeight: number,
): Promise<void> {
  const browser = await launchBrowserForCdp(browserPath);
  try {
    const client = await createCdpClient(browser.wsUrl);
    try {
      const page = await client.createPage();
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Page.navigate', { url });
      await page.waitFor('Page.loadEventFired', 180000);
      await delay(1200);

      const metrics = await page.evaluate<{
        width?: number;
        height?: number;
      }>(`(() => {
        const doc = document.documentElement;
        const body = document.body;
        const parsePx = (value) => {
          if (!value || typeof value !== 'string') return 0;
          const matched = value.match(/-?\\d+(?:\\.\\d+)?/);
          return matched ? Number(matched[0]) : 0;
        };
        const computedBody = body ? window.getComputedStyle(body) : null;
        const computedDoc = doc ? window.getComputedStyle(doc) : null;
        const bodyRect = body?.getBoundingClientRect();
        const docRect = doc?.getBoundingClientRect();
        const bodyRectWidth = bodyRect ? Math.abs(bodyRect.right - bodyRect.left) : 0;
        const bodyRectHeight = bodyRect ? Math.abs(bodyRect.bottom - bodyRect.top) : 0;
        const docRectWidth = docRect ? Math.abs(docRect.right - docRect.left) : 0;
        const docRectHeight = docRect ? Math.abs(docRect.bottom - docRect.top) : 0;
        return {
          width: Math.max(
            doc?.scrollWidth || 0,
            body?.scrollWidth || 0,
            doc?.clientWidth || 0,
            body?.clientWidth || 0,
            doc?.offsetWidth || 0,
            body?.offsetWidth || 0,
            bodyRectWidth,
            docRectWidth,
            parsePx(computedBody?.width),
            parsePx(computedBody?.maxWidth),
            parsePx(computedDoc?.width),
            parsePx(computedDoc?.maxWidth)
          ),
          height: Math.max(
            doc?.scrollHeight || 0,
            body?.scrollHeight || 0,
            doc?.clientHeight || 0,
            body?.clientHeight || 0,
            doc?.offsetHeight || 0,
            body?.offsetHeight || 0,
            bodyRectHeight,
            docRectHeight,
            parsePx(computedBody?.height),
            parsePx(computedBody?.maxHeight),
            parsePx(computedDoc?.height),
            parsePx(computedDoc?.maxHeight)
          ),
        };
      })()`);

      const width = clampInt(metrics.width || fallbackWidth, 900, 3200);
      const height = clampInt(metrics.height || fallbackHeight, 900, 2800);

      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(200);

      const screenshot = await page.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
      });
      const base64 = stringValue(screenshot.data);
      if (!base64) {
        throw new Error('Browser screenshot capture returned empty payload.');
      }

      const { writeFile } = await import('node:fs/promises');
      await writeFile(outputPath, Buffer.from(base64, 'base64'));
    } finally {
      await client.close();
    }
  } finally {
    browser.child.kill();
    await rm(browser.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function launchBrowserForCdp(browserPath: string): Promise<BrowserLaunch> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'lite-spec-cdp-'));
  const child = spawn(
    browserPath,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const wsUrl = await new Promise<string>((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for browser DevTools endpoint. stderr=${stderr}`));
    }, 20000);

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/i);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited before DevTools was ready. code=${code}`));
    });
  });

  return { child, wsUrl, userDataDir };
}

async function createCdpClient(browserWsUrl: string) {
  const ws = new WebSocket(browserWsUrl);
  await waitForSocketOpen(ws);

  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  const listeners = new Map<string, Array<(message: CdpMessage) => void>>();

  ws.on('message', (raw: WebSocket.RawData) => {
    const message = JSON.parse(String(raw)) as CdpMessage;
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id)!;
      pending.delete(message.id);
      item.resolve(message.result || {});
      return;
    }

    if (message.method) {
      const key = `${message.sessionId || ''}:${message.method}`;
      for (const listener of listeners.get(key) || []) {
        listener(message);
      }
    }
  });

  async function send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id = nextId++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    ws.send(JSON.stringify(payload));
    return await result;
  }

  function on(method: string, sessionId: string, listener: (message: CdpMessage) => void) {
    const key = `${sessionId}:${method}`;
    const current = listeners.get(key) || [];
    current.push(listener);
    listeners.set(key, current);
  }

  return {
    async createPage() {
      const target = await send('Target.createTarget', { url: 'about:blank' });
      const targetId = stringValue(target.targetId);
      if (!targetId) {
        throw new Error('Target.createTarget did not return targetId.');
      }

      const attached = await send('Target.attachToTarget', { targetId, flatten: true });
      const sessionId = stringValue(attached.sessionId);
      if (!sessionId) {
        throw new Error('Target.attachToTarget did not return sessionId.');
      }

      return {
        send: (method: string, params: Record<string, unknown> = {}) =>
          send(method, params, sessionId),
        waitFor: async (method: string, timeoutMs: number) =>
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timed out waiting for ${method}`)),
              timeoutMs,
            );
            on(method, sessionId, () => {
              clearTimeout(timer);
              resolve();
            });
          }),
        evaluate: async <T>(expression: string): Promise<T> => {
          const result = await send(
            'Runtime.evaluate',
            {
              expression,
              returnByValue: true,
              awaitPromise: true,
            },
            sessionId,
          );
          return (result.result as { value?: T } | undefined)?.value as T;
        },
      };
    },
    async close() {
      ws.close();
      await delay(100);
    },
  };
}

function waitForSocketOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket open.')), 10000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Failed to open WebSocket connection.'));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function trimSolidBorderInPlace(filePath: string): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const input = await readFile(filePath);
  const png = PNG.sync.read(input);
  const crop = detectSolidBorderCrop(png);
  if (!crop) {
    return;
  }

  const cropped = new PNG({ width: crop.width, height: crop.height });
  PNG.bitblt(png, cropped, crop.left, crop.top, crop.width, crop.height, 0, 0);
  await writeFile(filePath, PNG.sync.write(cropped));
}

function detectSolidBorderCrop(
  png: PNG,
): { left: number; top: number; width: number; height: number } | null {
  const width = png.width;
  const height = png.height;
  if (width < 40 || height < 40) {
    return null;
  }

  const background = detectBackgroundColor(png);
  const tolerance = 16;
  const contentRatio = 0.01;
  const safetyPadding = 12;

  let top = 0;
  while (top < height - 1 && isBackgroundRow(png, top, background, tolerance, contentRatio)) {
    top += 1;
  }

  let bottom = height - 1;
  while (bottom > top && isBackgroundRow(png, bottom, background, tolerance, contentRatio)) {
    bottom -= 1;
  }

  let left = 0;
  while (left < width - 1 && isBackgroundColumn(png, left, background, tolerance, contentRatio)) {
    left += 1;
  }

  let right = width - 1;
  while (right > left && isBackgroundColumn(png, right, background, tolerance, contentRatio)) {
    right -= 1;
  }

  if (top === 0 && left === 0 && right === width - 1 && bottom === height - 1) {
    return null;
  }

  top = Math.max(0, top - safetyPadding);
  left = Math.max(0, left - safetyPadding);
  right = Math.min(width - 1, right + safetyPadding);
  bottom = Math.min(height - 1, bottom + safetyPadding);

  const croppedWidth = right - left + 1;
  const croppedHeight = bottom - top + 1;
  if (croppedWidth < width * 0.35 || croppedHeight < height * 0.2) {
    return null;
  }

  return {
    left,
    top,
    width: croppedWidth,
    height: croppedHeight,
  };
}

function detectBackgroundColor(png: PNG): [number, number, number, number] {
  const samples = [
    getPixel(png, 0, 0),
    getPixel(png, png.width - 1, 0),
    getPixel(png, 0, png.height - 1),
    getPixel(png, png.width - 1, png.height - 1),
    getPixel(png, Math.floor(png.width / 2), 0),
    getPixel(png, 0, Math.floor(png.height / 2)),
  ];

  const avg = [0, 0, 0, 0];
  for (const sample of samples) {
    avg[0] += sample[0];
    avg[1] += sample[1];
    avg[2] += sample[2];
    avg[3] += sample[3];
  }

  return [
    Math.round(avg[0] / samples.length),
    Math.round(avg[1] / samples.length),
    Math.round(avg[2] / samples.length),
    Math.round(avg[3] / samples.length),
  ];
}

function isBackgroundRow(
  png: PNG,
  y: number,
  background: [number, number, number, number],
  tolerance: number,
  contentRatio: number,
): boolean {
  let different = 0;
  for (let x = 0; x < png.width; x += 2) {
    if (!isBackgroundPixel(getPixel(png, x, y), background, tolerance)) {
      different += 1;
    }
  }

  return different / Math.ceil(png.width / 2) <= contentRatio;
}

function isBackgroundColumn(
  png: PNG,
  x: number,
  background: [number, number, number, number],
  tolerance: number,
  contentRatio: number,
): boolean {
  let different = 0;
  for (let y = 0; y < png.height; y += 2) {
    if (!isBackgroundPixel(getPixel(png, x, y), background, tolerance)) {
      different += 1;
    }
  }

  return different / Math.ceil(png.height / 2) <= contentRatio;
}

function isBackgroundPixel(
  pixel: [number, number, number, number],
  background: [number, number, number, number],
  tolerance: number,
): boolean {
  return (
    Math.abs(pixel[0] - background[0]) <= tolerance &&
    Math.abs(pixel[1] - background[1]) <= tolerance &&
    Math.abs(pixel[2] - background[2]) <= tolerance &&
    Math.abs(pixel[3] - background[3]) <= tolerance
  );
}

function getPixel(png: PNG, x: number, y: number): [number, number, number, number] {
  const idx = (png.width * y + x) << 2;
  return [
    png.data[idx] || 0,
    png.data[idx + 1] || 0,
    png.data[idx + 2] || 0,
    png.data[idx + 3] || 0,
  ];
}


function parseKnife4jHtml(url: string, html: string): OpenApiCollected {
  const title =
    extractFirstText(html, [
      /<div[^>]*class="knife4j-api-title[^"]*"[\s\S]*?<span[^>]*>\s*([^<]+?)\s*<\/span>/i,
      /<div[^>]*class="ant-tabs-tab-active[^"]*"[^>]*>[\s\S]*?<div[^>]*class="ant-tabs-tab-btn"[^>]*>([^<]+)<\/div>/i,
      /<div[^>]*class="api-title"[^>]*>\s*([^<]+?)\s*<\/div>/i,
    ]) || '未命名接口';
  const method = extractFirstText(html, [
    /<span[^>]*class="http-method[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/i,
    /<span[^>]*class="path-method[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/i,
    /<span[^>]*>\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*<\/span>\s*<\/div>\s*<div[^>]*class="path"/i,
    />(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)</i,
  ]).toUpperCase();
  const path = extractApiPath(html);
  const reqBodyType = extractFieldValue(html, '请求数据类型') || '';
  const responseType = extractFieldValue(html, '响应数据类型') || '';
  const requestBody = extractRequestExample(html);
  const reqParams = extractRequestParams(html);
  const reqHeaders: ReqHeader[] = reqBodyType
    ? [{ name: 'Content-Type', value: reqBodyType, required: '1' }]
    : [];
  const responseStatuses = extractResponseStatuses(html);
  const operation: OpenApiCollectedOperation = {
    title,
    method: method || 'POST',
    path,
    desc: title,
    reqBodyType: reqBodyType ? 'json' : '',
    requestBody,
    responseBody: {
      contentType: responseType,
      statuses: responseStatuses,
    },
    reqHeaders,
    reqQuery: [],
    reqParams,
    operationId: extractOperationId(url),
  };

  return {
    ...operation,
    sourceType: 'openapi',
    specTitle: 'Knife4j Document',
    specVersion: '',
    specUrl: url,
    operations: [operation],
    raw: {
      title,
      method: operation.method,
      path,
      reqBodyType,
      responseType,
      htmlSnippet: html.slice(0, 2000),
    },
  };
}

function extractApiPath(html: string): string {
  const direct = extractFirstText(html, [
    /<span[^>]*class="path-url[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/i,
    /<div[^>]*class="api-container[^"]*"[\s\S]*?>\s*<span[^>]*>\s*(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*<\/span>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i,
    />(\/api\/[^<\s]+)</i,
  ]);
  return direct || '';
}

function extractFieldValue(html: string, label: string): string {
  const escaped = escapeRegExp(label);
  const spanMatch = html.match(
    new RegExp(`${escaped}[\\s\\S]{0,200}?<span[^>]*>([^<]+)<\\/span>`, 'i'),
  );
  if (spanMatch?.[1]) {
    return decodeHtml(spanMatch[1]).trim();
  }

  const blockMatch = html.match(
    new RegExp(`${escaped}[\\s\\S]{0,120}?>\\s*([^<]{1,80}?)\\s*<`, 'i'),
  );
  return decodeHtml(blockMatch?.[1] || '').trim();
}

function extractRequestExample(html: string): unknown {
  const lines = Array.from(
    html.matchAll(
      /<span[^>]*class="ace_string"[^>]*>([\s\S]*?)<\/span>|<span[^>]*class="ace_constant ace_numeric"[^>]*>([\s\S]*?)<\/span>|<span[^>]*class="ace_paren"[^>]*>([\[\]\{\}])<\/span>|<span[^>]*class="ace_punctuation ace_operator"[^>]*>([:,])<\/span>/gi,
    ),
  ).map((match) => decodeHtml((match[1] || match[2] || match[3] || match[4] || '').trim()));

  if (!lines.length) {
    return null;
  }

  const joined = lines.join('').replace(/\s+/g, ' ').trim();
  return joined || null;
}

function extractRequestParams(html: string): ReqParam[] {
  const sectionMatch = html.match(
    /请求参数[\s\S]*?<tbody class="ant-table-tbody">([\s\S]*?)<\/tbody>/i,
  );
  if (!sectionMatch) {
    return [];
  }

  const rowMatches = Array.from(sectionMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  const params: ReqParam[] = [];

  for (const [, rowHtml] of rowMatches) {
    const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) =>
      normalizeCellText(match[1]),
    );
    if (!cells.length) continue;
    const name = cells[0];
    if (!name || /^collapse row$/i.test(name)) continue;

    params.push({
      name,
      desc: cells[1] || undefined,
      required: cells[3] === 'true' ? '1' : '0',
    });
  }

  return params;
}

function extractResponseStatuses(html: string): Array<{ code: string; desc: string }> {
  const sectionMatch = html.match(
    /响应状态[\s\S]*?<tbody class="ant-table-tbody">([\s\S]*?)<\/tbody>/i,
  );
  if (!sectionMatch) {
    return [];
  }

  const rows = Array.from(sectionMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  const result: Array<{ code: string; desc: string }> = [];

  for (const [, rowHtml] of rows) {
    const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) =>
      normalizeCellText(match[1]),
    );
    if (cells[0]) {
      result.push({ code: cells[0], desc: cells[1] || '' });
    }
  }

  return result;
}

function extractOperationId(url: string): string {
  const hash = new URL(url).hash.replace(/^#\/+/, '');
  const parts = hash.split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function extractFirstText(html: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = decodeHtml(match?.[1] || '').trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function normalizeCellText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
