import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer, { type Browser } from "puppeteer-core";
import type { ExcalidrawData } from "./lexical.js";

declare global {
  interface Window {
    __hubtheConvertMermaid?: (
      mermaidSyntax: string,
    ) => Promise<ExcalidrawData>;
  }
}

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const converterBundlePath = path.join(
  runtimeDir,
  "..",
  "browser",
  "mermaid-converter.js",
);

const browserCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_EXECUTABLE_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
].filter((candidate): candidate is string => Boolean(candidate));

let browserPromise: Promise<Browser> | null = null;

function resolveBrowserExecutablePath(): string {
  for (const candidate of browserCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "No Chromium/Chrome executable found for Mermaid conversion. " +
      "Set PUPPETEER_EXECUTABLE_PATH or run the Docker image that includes Chromium.",
  );
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: resolveBrowserExecutablePath(),
        headless: true,
        args: [
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--font-render-hinting=medium",
          "--no-first-run",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      })
      .then((browser) => {
        browser.process()?.unref();
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }

  return browserPromise;
}

function ensureBrowserBundle(): void {
  if (!existsSync(converterBundlePath)) {
    throw new Error(
      `Browser Mermaid bundle not found at ${converterBundlePath}. Run npm run build.`,
    );
  }
}

export async function mermaidToExcalidrawData(
  mermaidSyntax: string,
): Promise<ExcalidrawData> {
  ensureBrowserBundle();

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: 1600,
      height: 1200,
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>',
      { waitUntil: "domcontentloaded" },
    );
    await page.addScriptTag({ path: converterBundlePath });

    return await page.evaluate(async (diagram) => {
      const convert = window.__hubtheConvertMermaid;
      if (typeof convert !== "function") {
        throw new Error(
          "Mermaid converter bundle did not register on window.",
        );
      }
      return convert(diagram);
    }, mermaidSyntax);
  } finally {
    await page.close();
  }
}
