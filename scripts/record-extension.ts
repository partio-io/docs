import puppeteer, { Browser, Page } from "puppeteer";
import GIFEncoder from "gif-encoder-2";
import { PNG } from "pngjs";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_LOGIN = process.env.GITHUB_LOGIN || "demo-user";
const PARTIO_DEMO_REPO = process.env.PARTIO_DEMO_REPO; // "owner/repo"
const PARTIO_DEMO_SHA = process.env.PARTIO_DEMO_SHA; // optional
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}
if (!PARTIO_DEMO_REPO) {
  console.error("PARTIO_DEMO_REPO is required (e.g. owner/repo)");
  process.exit(1);
}

const [OWNER, REPO] = PARTIO_DEMO_REPO.split("/");
const OUTPUT_DIR = path.resolve(__dirname, "../images/extension");
const EXTENSION_PATH = path.resolve(__dirname, "../../extension/dist");

const GIF_WIDTH = 1280;
const GIF_HEIGHT = 900;
const FPS = 8;
const FRAME_DELAY = 1000 / FPS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture a single PNG screenshot as an RGBA buffer at GIF_WIDTH x GIF_HEIGHT. */
async function captureFrame(
  page: Page,
  clipWidth: number,
  clipHeight: number
): Promise<Buffer> {
  // When capturing at full viewport size, omit clip to respect scroll position.
  // clip coordinates are absolute (page top-left), ignoring scroll.
  const opts: Parameters<Page["screenshot"]>[0] =
    clipWidth === GIF_WIDTH && clipHeight === GIF_HEIGHT
      ? { type: "png" as const }
      : { type: "png" as const, clip: { x: 0, y: 0, width: clipWidth, height: clipHeight } };
  const rawPng = await page.screenshot(opts);
  // Puppeteer may return Uint8Array; pngjs requires a Node Buffer.
  const pngBuf = Buffer.from(rawPng);

  const png = PNG.sync.read(pngBuf);

  // Center-pad to GIF_WIDTH x GIF_HEIGHT
  const padded = new PNG({ width: GIF_WIDTH, height: GIF_HEIGHT });
  // Fill with white background
  for (let i = 0; i < padded.data.length; i += 4) {
    padded.data[i] = 255;
    padded.data[i + 1] = 255;
    padded.data[i + 2] = 255;
    padded.data[i + 3] = 255;
  }

  const offsetX = Math.floor((GIF_WIDTH - png.width) / 2);
  const offsetY = Math.floor((GIF_HEIGHT - png.height) / 2);

  for (let y = 0; y < png.height && y + offsetY < GIF_HEIGHT; y++) {
    for (let x = 0; x < png.width && x + offsetX < GIF_WIDTH; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = ((y + offsetY) * GIF_WIDTH + (x + offsetX)) * 4;
      padded.data[dstIdx] = png.data[srcIdx];
      padded.data[dstIdx + 1] = png.data[srcIdx + 1];
      padded.data[dstIdx + 2] = png.data[srcIdx + 2];
      padded.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }

  return padded.data as unknown as Buffer;
}

/** Capture frames for a given duration (ms) at FPS rate. */
async function captureFrames(
  page: Page,
  durationMs: number,
  clipWidth: number,
  clipHeight: number
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  const frameCount = Math.ceil(durationMs / FRAME_DELAY);
  for (let i = 0; i < frameCount; i++) {
    frames.push(await captureFrame(page, clipWidth, clipHeight));
    if (i < frameCount - 1) {
      await sleep(FRAME_DELAY);
    }
  }
  return frames;
}

/** Encode RGBA frames into a GIF file. */
function writeGif(filePath: string, frames: Buffer[]): void {
  const encoder = new GIFEncoder(GIF_WIDTH, GIF_HEIGHT);
  const writeStream = fs.createWriteStream(filePath);
  encoder.createReadStream().pipe(writeStream);

  encoder.start();
  encoder.setRepeat(0); // loop forever
  encoder.setDelay(Math.round(FRAME_DELAY));
  encoder.setQuality(10);

  for (const frame of frames) {
    encoder.addFrame(frame);
  }

  encoder.finish();
  console.log(`  Written: ${filePath} (${frames.length} frames)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Check GitHub auth status; prompt login only for private repos. */
async function ensureGitHubAuth(page: Page): Promise<void> {
  // Check if repo is public via API — skip browser login if so
  const repoRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  if (repoRes.ok) {
    const repoData = (await repoRes.json()) as { private: boolean };
    if (!repoData.private) {
      console.log("  Repo is public — skipping browser login");
      return;
    }
  }

  // Private repo: need browser login
  await page.goto("https://github.com", { waitUntil: "networkidle0" });

  const userMeta = await page.$('meta[name="user-login"]');
  const login = userMeta
    ? await page.evaluate((el) => el.getAttribute("content"), userMeta)
    : null;

  if (login) {
    console.log(`  Already logged in to GitHub as ${login}`);
  } else {
    await page.goto("https://github.com/login", { waitUntil: "networkidle0" });
    console.log("\n  *** Please log in to GitHub in the browser window. ***");
    console.log("  Press Enter here when done...\n");
    await new Promise<void>((resolve) =>
      process.stdin.once("data", () => resolve())
    );
  }
}

/** Capture raw RGBA pixel data at the given dimensions (no padding). */
async function captureRawFrame(
  page: Page,
  width: number,
  height: number
): Promise<{ data: Buffer; width: number; height: number }> {
  const rawPng = await page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width, height },
  });
  const png = PNG.sync.read(Buffer.from(rawPng));
  return {
    data: png.data as unknown as Buffer,
    width: png.width,
    height: png.height,
  };
}

/** Composite a foreground RGBA buffer onto a background RGBA buffer. */
function compositeOnto(
  bg: Buffer,
  bgW: number,
  bgH: number,
  fg: Buffer,
  fgW: number,
  fgH: number,
  x: number,
  y: number
): Buffer {
  const result = Buffer.from(bg);
  for (let row = 0; row < fgH; row++) {
    const dy = row + y;
    if (dy < 0 || dy >= bgH) continue;
    for (let col = 0; col < fgW; col++) {
      const dx = col + x;
      if (dx < 0 || dx >= bgW) continue;
      const si = (row * fgW + col) * 4;
      const di = (dy * bgW + dx) * 4;
      const a = fg[si + 3] / 255;
      result[di] = Math.round(fg[si] * a + result[di] * (1 - a));
      result[di + 1] = Math.round(fg[si + 1] * a + result[di + 1] * (1 - a));
      result[di + 2] = Math.round(fg[si + 2] * a + result[di + 2] * (1 - a));
      result[di + 3] = 255;
    }
  }
  return result;
}

/** Auto-discover a demo commit SHA from the checkpoint branch. */
async function discoverDemoSha(): Promise<string> {
  if (PARTIO_DEMO_SHA) return PARTIO_DEMO_SHA;

  console.log("Auto-discovering demo commit SHA...");
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/partio/checkpoints/v1?recursive=1`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!res.ok) {
    throw new Error(
      `Failed to read checkpoint tree: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as { tree: Array<{ path: string }> };
  // Match only checkpoint-level metadata (2-char shard / 10-char rest / metadata.json),
  // never session-level metadata (which lives under a 0/ subdirectory).
  const METADATA_PATH_RE = /^[0-9a-f]{2}\/[0-9a-f]{10}\/metadata\.json$/;
  const metadataFile = data.tree.find((f) =>
    METADATA_PATH_RE.test(f.path)
  );

  if (!metadataFile) {
    throw new Error("No checkpoint-level metadata.json found on checkpoint branch");
  }

  console.log(`  Found checkpoint metadata: ${metadataFile.path}`);

  // Fetch the metadata to get the commit_hash
  const blobRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${metadataFile.path}?ref=partio/checkpoints/v1`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!blobRes.ok) {
    throw new Error(`Failed to read metadata: ${blobRes.status}`);
  }

  const blobData = (await blobRes.json()) as { content: string };
  const metadata = JSON.parse(
    Buffer.from(blobData.content, "base64").toString("utf-8")
  );
  const sha = metadata.commit_hash;

  if (!sha) {
    throw new Error("metadata.json has no commit_hash field");
  }

  console.log(`  Found demo commit: ${sha.slice(0, 12)}`);
  return sha;
}

// ---------------------------------------------------------------------------
// Browser setup
// ---------------------------------------------------------------------------

async function launchBrowser(): Promise<Browser> {
  console.log("Launching Chrome with extension...");
  console.log(`  Extension path: ${EXTENSION_PATH}`);

  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(
      `Extension dist not found at ${EXTENSION_PATH}. Run 'npm run build' in extension/ first.`
    );
  }

  const browser = await puppeteer.launch({
    headless: false, // MV3 extensions require headed mode
    protocolTimeout: 120000, // 2 min timeout for slow page loads
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--disable-default-apps",
      "--window-size=1280,800",
    ],
    defaultViewport: null,
  });

  return browser;
}

async function getExtensionId(browser: Browser): Promise<string> {
  console.log("Discovering extension ID...");

  // Wait for the service worker to appear
  const swTarget = await browser.waitForTarget(
    (t) =>
      t.type() === "service_worker" && t.url().includes("service-worker"),
    { timeout: 15000 }
  );

  const swUrl = swTarget.url();
  // URL is like: chrome-extension://<id>/service-worker.js
  const match = swUrl.match(/chrome-extension:\/\/([^/]+)/);
  if (!match) {
    throw new Error(`Could not extract extension ID from ${swUrl}`);
  }

  const extensionId = match[1];
  console.log(`  Extension ID: ${extensionId}`);
  return extensionId;
}

/** Set extension auth using the utility page (chrome-extension:// only). */
async function seedAuth(
  extPage: Page,
  extensionId: string
): Promise<void> {
  console.log("Pre-seeding auth...");
  await extPage.goto(
    `chrome-extension://${extensionId}/src/popup/popup.html`,
    { waitUntil: "domcontentloaded" }
  );

  await extPage.evaluate(
    (token: string, login: string) => {
      return chrome.storage.local.set({
        partioToken: token,
        partioLogin: login,
        partioDisconnected: false,
      });
    },
    GITHUB_TOKEN!,
    GITHUB_LOGIN
  );

  console.log(`  Auth set for ${GITHUB_LOGIN}`);
}

/** Clear extension auth using the utility page (chrome-extension:// only). */
async function clearAuth(
  extPage: Page,
  extensionId: string
): Promise<void> {
  await extPage.goto(
    `chrome-extension://${extensionId}/src/popup/popup.html`,
    { waitUntil: "domcontentloaded" }
  );

  await extPage.evaluate(() => {
    return chrome.storage.local.set({ partioDisconnected: true });
  });
  await extPage.evaluate(() => {
    return chrome.storage.local.remove(["partioToken", "partioLogin"]);
  });
}

// ---------------------------------------------------------------------------
// Scene recorders
// ---------------------------------------------------------------------------

async function recordPopupAuth(
  ghPage: Page,
  extPage: Page,
  extensionId: string,
  commitUrl: string
): Promise<void> {
  console.log("\nScene 1: Popup auth");
  const frames: Buffer[] = [];
  const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
  const popupW = 360;
  const popupH = 300;

  // Capture GitHub page as background (ghPage never touches chrome-extension://)
  await ghPage.setViewport({ width: GIF_WIDTH, height: GIF_HEIGHT });
  await ghPage.goto(commitUrl, { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  const bgFrame = await captureFrame(ghPage, GIF_WIDTH, GIF_HEIGHT);

  // Show the GitHub page alone first
  const holdFrames = Math.ceil(2000 / FRAME_DELAY);
  for (let i = 0; i < holdFrames; i++) frames.push(bgFrame);

  // Position popup at top-right (where browser extension popups appear)
  const popupX = GIF_WIDTH - popupW - 8;
  const popupY = 8;

  // --- Not-connected state (use extPage for all extension operations) ---
  await clearAuth(extPage, extensionId);
  await extPage.setViewport({ width: popupW, height: popupH });
  await extPage.goto(popupUrl, { waitUntil: "networkidle0" });
  await sleep(500);
  await extPage.waitForSelector("#not-connected:not([hidden])", { timeout: 5000 }).catch(() => {
    console.log("  Warning: #not-connected not visible, capturing anyway");
  });
  const popup1 = await captureRawFrame(extPage, popupW, popupH);

  const composited1 = compositeOnto(
    bgFrame, GIF_WIDTH, GIF_HEIGHT,
    popup1.data, popup1.width, popup1.height,
    popupX, popupY
  );
  for (let i = 0; i < holdFrames; i++) frames.push(composited1);

  // --- Connected state ---
  await seedAuth(extPage, extensionId);
  await extPage.goto(popupUrl, { waitUntil: "networkidle0" });
  await sleep(500);
  await extPage.waitForSelector("#connected:not([hidden])", { timeout: 5000 }).catch(() => {
    console.log("  Warning: #connected not visible, capturing anyway");
  });
  const popup2 = await captureRawFrame(extPage, popupW, popupH);

  const composited2 = compositeOnto(
    bgFrame, GIF_WIDTH, GIF_HEIGHT,
    popup2.data, popup2.width, popup2.height,
    popupX, popupY
  );
  for (let i = 0; i < holdFrames; i++) frames.push(composited2);

  writeGif(path.join(OUTPUT_DIR, "popup-auth.gif"), frames);
}

async function recordPanelExpanding(
  page: Page,
  commitUrl: string
): Promise<void> {
  console.log("\nScene 2: Panel expanding");
  const frames: Buffer[] = [];

  console.log("  Navigating to commit page...");
  await page.goto(commitUrl, { waitUntil: "networkidle0", timeout: 60000 });

  // Wait for the panel to be injected
  console.log("  Waiting for #partio-container...");
  await page.waitForSelector("#partio-container", { timeout: 60000 });
  await sleep(1000);

  // Debug: check panel dimensions and content
  const panelInfo = await page.evaluate(() => {
    const panel = document.getElementById("partio-container");
    if (!panel) return { found: false };
    const rect = panel.getBoundingClientRect();
    return {
      found: true,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      display: getComputedStyle(panel).display,
      visibility: getComputedStyle(panel).visibility,
      innerHTML: panel.innerHTML.slice(0, 200),
      classList: Array.from(panel.classList),
    };
  });
  console.log("  Panel info:", JSON.stringify(panelInfo, null, 2));

  // Scroll the panel into view near the bottom so GitHub header stays visible
  console.log("  Scrolling panel into view...");
  await page.evaluate(() => {
    const panel = document.getElementById("partio-container");
    if (panel) panel.scrollIntoView({ block: "end", behavior: "instant" });
  });
  await sleep(500);

  // Capture collapsed state (single frame, held for 2s worth of GIF frames)
  console.log("  Capturing collapsed state...");
  const collapsedFrame = await captureFrame(page, GIF_WIDTH, GIF_HEIGHT);
  const holdFrames = Math.ceil(2000 / FRAME_DELAY);
  for (let i = 0; i < holdFrames; i++) frames.push(collapsedFrame);

  // Click header to expand using DOM click (avoids heavy Puppeteer click flow)
  console.log("  Clicking header to expand...");
  await page.evaluate(() => {
    const header = document.querySelector(".partio-header") as HTMLElement;
    if (header) header.click();
  });
  await sleep(2000); // Give extension time to expand and render

  // Re-scroll so the expanded panel is visible with GitHub header above
  await page.evaluate(() => {
    const panel = document.getElementById("partio-container");
    if (panel) {
      const rect = panel.getBoundingClientRect();
      window.scrollBy(0, rect.top - 200);
    }
  });
  await sleep(500);

  // Capture expanded state
  console.log("  Capturing expanded state...");
  const expandedFrame = await captureFrame(page, GIF_WIDTH, GIF_HEIGHT);
  for (let i = 0; i < holdFrames; i++) frames.push(expandedFrame);

  writeGif(path.join(OUTPUT_DIR, "panel-expanding.gif"), frames);
}

async function recordTranscriptPlanTabs(page: Page): Promise<void> {
  console.log("\nScene 3: Transcript & Plan tabs");
  const frames: Buffer[] = [];
  const holdFrames = Math.ceil(2000 / FRAME_DELAY);

  // Panel should already be expanded from scene 2
  // Ensure panel is visible with GitHub header above
  await page.evaluate(() => {
    const panel = document.getElementById("partio-container");
    if (panel) {
      const rect = panel.getBoundingClientRect();
      window.scrollBy(0, rect.top - 200);
    }
  });
  await sleep(500);

  // Ensure transcript tab is active
  console.log("  Clicking Transcript tab...");
  await page.evaluate(() => {
    const tab = document.querySelector('.partio-tab[data-tab="transcript"]') as HTMLElement;
    if (tab) tab.click();
  });
  await sleep(1000);

  // Capture Transcript tab
  console.log("  Capturing Transcript tab...");
  const transcriptFrame = await captureFrame(page, GIF_WIDTH, GIF_HEIGHT);
  for (let i = 0; i < holdFrames; i++) frames.push(transcriptFrame);

  // Click Plan tab
  console.log("  Clicking Plan tab...");
  await page.evaluate(() => {
    const tab = document.querySelector('.partio-tab[data-tab="plan"]') as HTMLElement;
    if (tab) tab.click();
  });
  await sleep(1000);

  // Capture Plan tab
  console.log("  Capturing Plan tab...");
  const planFrame = await captureFrame(page, GIF_WIDTH, GIF_HEIGHT);
  for (let i = 0; i < holdFrames; i++) frames.push(planFrame);

  writeGif(path.join(OUTPUT_DIR, "transcript-plan-tabs.gif"), frames);
}

async function recordCommitBadges(
  page: Page,
  commitsUrl: string
): Promise<void> {
  console.log("\nScene 4: Commit badges");
  const frames: Buffer[] = [];
  const holdFrames = Math.ceil(2000 / FRAME_DELAY);

  console.log("  Navigating to commits page...");
  await page.goto(commitsUrl, { waitUntil: "networkidle0", timeout: 60000 });

  // Wait for badges to appear
  await page
    .waitForSelector(".partio-commit-badge", { timeout: 30000 })
    .catch(() => {
      console.log("  Warning: No commit badges found, capturing page anyway");
    });
  await sleep(1000);

  // Capture commit list with badges
  console.log("  Capturing badges...");
  const badgesFrame = await captureFrame(page, GIF_WIDTH, GIF_HEIGHT);
  for (let i = 0; i < holdFrames; i++) frames.push(badgesFrame);

  // Hover over a badge to show tooltip
  console.log("  Hovering badge...");
  await page.evaluate(() => {
    const badge = document.querySelector(".partio-commit-badge") as HTMLElement;
    if (badge) badge.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  });
  await sleep(1000);

  // Capture hover state
  console.log("  Capturing hover state...");
  const hoverFrame = await captureFrame(page, GIF_WIDTH, GIF_HEIGHT);
  for (let i = 0; i < holdFrames; i++) frames.push(hoverFrame);

  writeGif(path.join(OUTPUT_DIR, "commit-badges.gif"), frames);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Partio Extension GIF Recorder ===\n");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const demoSha = await discoverDemoSha();
  const commitUrl = `https://github.com/${OWNER}/${REPO}/commit/${demoSha}`;
  const commitsUrl = `https://github.com/${OWNER}/${REPO}/commits`;

  const browser = await launchBrowser();

  try {
    const extensionId = await getExtensionId(browser);

    // Ensure GitHub browser auth first (login may detach other frames)
    const ghPage = await browser.newPage();
    await ensureGitHubAuth(ghPage);

    // Verify the commit URL is accessible before proceeding
    console.log(`\nVerifying commit URL: ${commitUrl}`);
    await ghPage.goto(commitUrl, { waitUntil: "networkidle0", timeout: 30000 });
    const pageTitle = await ghPage.title();
    console.log(`  Page title: ${pageTitle}`);
    if (pageTitle.includes("Page not found") || pageTitle.includes("Sign in")) {
      throw new Error(
        `Cannot access ${commitUrl}\n` +
        `  Page title: "${pageTitle}"\n` +
        `  Make sure the logged-in GitHub account has access to ${OWNER}/${REPO}\n` +
        `  and that commit ${demoSha.slice(0, 12)} exists.`
      );
    }
    console.log("  Commit page accessible!");

    // Create extPage AFTER login — two pages with strict origin separation:
    // ghPage  — only navigates to github.com (preserves SameSite cookies)
    // extPage — only navigates to chrome-extension:// URLs
    const extPage = await browser.newPage();

    // Ensure extension auth is set before recording
    await seedAuth(extPage, extensionId);

    // Scene 1: Popup auth (composited onto GitHub page background)
    await recordPopupAuth(ghPage, extPage, extensionId, commitUrl);

    // Re-seed auth (popup auth scene clears it)
    await seedAuth(extPage, extensionId);

    // Scene 2: Panel expanding (ghPage stays on github.com)
    await ghPage.setViewport({ width: GIF_WIDTH, height: GIF_HEIGHT });
    await recordPanelExpanding(ghPage, commitUrl);

    // Scene 3: Transcript & Plan tabs (reuses ghPage from scene 2)
    await recordTranscriptPlanTabs(ghPage);

    // Scene 4: Commit badges
    await recordCommitBadges(ghPage, commitsUrl);

    await ghPage.close();
    await extPage.close();
  } finally {
    await browser.close();
  }

  console.log("\n=== Done! GIFs written to", OUTPUT_DIR, "===");
}

main().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
