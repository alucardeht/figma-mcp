import CDP from 'chrome-remote-interface';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';

const DEFAULT_CDP_PORT = 9222;
const CONNECTION_TIMEOUT = 5000;
const CHROME_LAUNCH_TIMEOUT = 10000;
const CHROME_POLL_INTERVAL = 500;
const DEFAULT_TIMEOUT = 30000;

let chromeProcess = null;
let launchingPromise = null;

function findChromePath() {
  const paths = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe'
    ]
  };

  const currentPlatform = platform();
  const candidates = paths[currentPlatform] || [];

  for (const chromePath of candidates) {
    if (existsSync(chromePath)) {
      return chromePath;
    }
  }

  return null;
}

async function launchChrome(port = DEFAULT_CDP_PORT) {
  if (launchingPromise) {
    return launchingPromise;
  }

  launchingPromise = (async () => {
    try {
      const chromePath = findChromePath();
      if (!chromePath) {
        throw new Error(`Chrome não encontrado no sistema (${platform()})`);
      }

      const args = [
        `--remote-debugging-port=${port}`,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--window-size=1920,1080',
        '--disable-web-resources',
        '--disable-default-apps',
        '--no-first-run'
      ];

      chromeProcess = spawn(chromePath, args, {
        detached: true,
        stdio: 'ignore'
      });

      chromeProcess.unref();

      await waitForChromeConnection(port);
      return true;
    } catch (error) {
      chromeProcess = null;
      throw error;
    } finally {
      launchingPromise = null;
    }
  })();

  return launchingPromise;
}

async function waitForChromeConnection(port = DEFAULT_CDP_PORT) {
  const startTime = Date.now();
  const maxAttempts = Math.ceil(CHROME_LAUNCH_TIMEOUT / CHROME_POLL_INTERVAL);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const client = await CDP({ port, timeout: 1000 });
      await client.close();
      return true;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= CHROME_LAUNCH_TIMEOUT) {
        throw new Error(
          `Timeout aguardando Chrome iniciar na porta ${port} (${CHROME_LAUNCH_TIMEOUT}ms)`
        );
      }
      await new Promise(resolve => setTimeout(resolve, CHROME_POLL_INTERVAL));
    }
  }
}

async function ensureChromeRunning(port = DEFAULT_CDP_PORT) {
  try {
    const client = await CDP({ port, timeout: 2000 });
    await client.close();
    return true;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.message?.includes('connect ECONNREFUSED')) {
      await launchChrome(port);
      return true;
    }
    throw error;
  }
}

const withTimeout = (promise, ms, errorMsg) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), ms)
    )
  ]);
};

export async function captureScreenshot(url, viewport, port = DEFAULT_CDP_PORT) {
  let client = null;

  try {
    await ensureChromeRunning(port);

    client = await CDP({ port, timeout: CONNECTION_TIMEOUT });

    const { Page, Emulation } = client;

    await Emulation.setDeviceMetricsOverride({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });

    await Page.enable();

    await withTimeout(Page.navigate({ url }), DEFAULT_TIMEOUT, `Page navigation timeout after ${DEFAULT_TIMEOUT}ms`);
    await withTimeout(Page.loadEventFired(), DEFAULT_TIMEOUT, `Page load timeout after ${DEFAULT_TIMEOUT}ms`);

    await new Promise(resolve => setTimeout(resolve, 500));

    const { data } = await withTimeout(
      Page.captureScreenshot({ format: 'png' }),
      DEFAULT_TIMEOUT,
      `Screenshot capture timeout after ${DEFAULT_TIMEOUT}ms`
    );

    return { success: true, data };

  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.message?.includes('connect ECONNREFUSED')) {
      return {
        success: false,
        error: 'CDP_CONNECTION_REFUSED',
        message: `Falha ao conectar ao Chrome na porta ${port}`
      };
    }

    if (error.message?.includes('timeout')) {
      return {
        success: false,
        error: 'CDP_TIMEOUT',
        message: `Timeout ao conectar ao Chrome na porta ${port}`
      };
    }

    if (error.message?.includes('Chrome não encontrado')) {
      return {
        success: false,
        error: 'CHROME_NOT_FOUND',
        message: `Chrome não instalado no sistema`
      };
    }

    return {
      success: false,
      error: 'CDP_ERROR',
      message: error.message
    };

  } finally {
    if (client) {
      try {
        await client.close();
      } catch (e) {
        // Ignorar - client pode já estar desconectado
      }
    }
  }
}

export async function captureScreenshotRegion(url, region, fullViewport, port = DEFAULT_CDP_PORT) {
  let client = null;

  try {
    await ensureChromeRunning(port);

    client = await CDP({ port, timeout: CONNECTION_TIMEOUT });

    const { Page, Emulation } = client;

    await Emulation.setDeviceMetricsOverride({
      width: fullViewport.width,
      height: fullViewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });

    await Page.enable();

    await withTimeout(Page.navigate({ url }), DEFAULT_TIMEOUT, `Page navigation timeout after ${DEFAULT_TIMEOUT}ms`);
    await withTimeout(Page.loadEventFired(), DEFAULT_TIMEOUT, `Page load timeout after ${DEFAULT_TIMEOUT}ms`);

    await Page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const { data } = await withTimeout(
      Page.captureScreenshot({
        format: 'png',
        clip: {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          scale: 1
        }
      }),
      DEFAULT_TIMEOUT,
      `Screenshot capture timeout after ${DEFAULT_TIMEOUT}ms`
    );

    return { success: true, data };

  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.message?.includes('connect ECONNREFUSED')) {
      return {
        success: false,
        error: 'CDP_CONNECTION_REFUSED',
        message: `Falha ao conectar ao Chrome na porta ${port}`
      };
    }

    if (error.message?.includes('timeout')) {
      return {
        success: false,
        error: 'CDP_TIMEOUT',
        message: `Timeout ao conectar ao Chrome na porta ${port}`
      };
    }

    if (error.message?.includes('Chrome não encontrado')) {
      return {
        success: false,
        error: 'CHROME_NOT_FOUND',
        message: `Chrome não instalado no sistema`
      };
    }

    return {
      success: false,
      error: 'CDP_ERROR',
      message: error.message
    };

  } finally {
    if (client) {
      try {
        await client.close();
      } catch (e) {
        // Ignorar - client pode já estar desconectado
      }
    }
  }
}

export async function checkChromeAvailable(port = DEFAULT_CDP_PORT) {
  try {
    await ensureChromeRunning(port);
    return { available: true, port, autoLaunched: chromeProcess !== null };
  } catch (error) {
    return {
      available: false,
      port,
      error: error.message
    };
  }
}

export { DEFAULT_CDP_PORT, DEFAULT_TIMEOUT };
