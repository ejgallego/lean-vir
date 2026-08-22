import { existsSync } from "node:fs";
import { chromium } from "playwright";

const defaultChromium = "/usr/bin/google-chrome";

export function launchBenchmarkBrowser() {
  const executablePath =
    process.env.CHROMIUM ??
    (existsSync(defaultChromium) ? defaultChromium : undefined);
  return chromium.launch({
    headless: true,
    executablePath,
  });
}
