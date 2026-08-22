import { existsSync } from "node:fs";
import { chromium } from "playwright";

export async function launchBenchmarkBrowser() {
  const configuredChrome = process.env.CHROMIUM ?? "/usr/bin/google-chrome";
  return chromium.launch({
    headless: true,
    executablePath: existsSync(configuredChrome) ? configuredChrome : undefined,
  });
}
