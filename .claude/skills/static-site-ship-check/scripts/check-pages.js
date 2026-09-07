#!/usr/bin/env node
/**
 * Loads pages from a running static server in a real headless browser and
 * reports console errors, uncaught exceptions, and failed network requests.
 *
 * Reading HTML/JS source is not enough to know a static page works — CORS,
 * relative-path depth, and runtime JS errors only show up when something
 * actually executes the page. This script is the fast way to do that for
 * every page at once instead of one-off manual checks.
 *
 * Usage:
 *   node check-pages.js --base http://localhost:8765 [--root .] [--screenshot-dir shots] [page1.html page2.html ...]
 *
 * - If no page paths are given, it recursively finds every *.html file under
 *   --root (default: current directory), skipping .git/node_modules/.claude.
 * - --screenshot-dir, if given, saves a full-page screenshot per page (handy
 *   for visually reviewing layout changes, not just checking for errors).
 * - Exits with code 1 if any page had a console error, page error, or a
 *   failed (non-2xx/3xx) resource request — so it's usable as a gate, not
 *   just a report.
 *
 * Requires the `playwright` package with Chromium installed:
 *   npm install -D playwright && npx playwright install chromium
 */

const fs = require('fs');
const path = require('path');

function findHtmlFiles(root) {
    const results = [];
    const skipDirs = new Set(['.git', 'node_modules', '.claude']);
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (skipDirs.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.html')) {
                results.push(path.relative(root, full).split(path.sep).join('/'));
            }
        }
    })(root);
    return results.sort();
}

function parseArgs(argv) {
    const args = { base: 'http://localhost:8765', root: '.', screenshotDir: null, pages: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--base') args.base = argv[++i];
        else if (a === '--root') args.root = argv[++i];
        else if (a === '--screenshot-dir') args.screenshotDir = argv[++i];
        else args.pages.push(a);
    }
    return args;
}

async function main() {
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (e) {
        console.error('Could not load playwright. Run: npm install -D playwright && npx playwright install chromium');
        process.exit(2);
    }

    const args = parseArgs(process.argv.slice(2));
    const pages = args.pages.length > 0 ? args.pages : findHtmlFiles(args.root);

    if (pages.length === 0) {
        console.error(`No .html files found under ${args.root}`);
        process.exit(2);
    }

    if (args.screenshotDir) fs.mkdirSync(args.screenshotDir, { recursive: true });

    const browser = await chromium.launch();
    let anyFailed = false;

    for (const relPath of pages) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        const consoleErrors = [];
        const pageErrors = [];
        const failedRequests = [];

        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => pageErrors.push(err.message));
        page.on('requestfailed', (req) => {
            failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText || 'failed'}`);
        });
        page.on('response', (res) => {
            if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
        });

        const url = `${args.base.replace(/\/$/, '')}/${relPath}`;
        let title = '';
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
            title = await page.title();
        } catch (e) {
            pageErrors.push(`navigation failed: ${e.message}`);
        }

        const failed = consoleErrors.length > 0 || pageErrors.length > 0 || failedRequests.length > 0;
        anyFailed = anyFailed || failed;

        console.log(`${failed ? 'FAIL' : 'PASS'}  ${relPath}  ${title ? `"${title}"` : ''}`);
        consoleErrors.forEach((e) => console.log(`  console error: ${e}`));
        pageErrors.forEach((e) => console.log(`  page error: ${e}`));
        failedRequests.forEach((e) => console.log(`  failed request: ${e}`));

        if (args.screenshotDir) {
            const shotPath = path.join(args.screenshotDir, relPath.replace(/\//g, '_').replace(/\.html$/, '.png'));
            await page.screenshot({ path: shotPath, fullPage: true });
        }

        await page.close();
    }

    await browser.close();
    console.log(anyFailed ? '\nOne or more pages had errors — see above.' : '\nAll pages loaded cleanly.');
    process.exit(anyFailed ? 1 : 0);
}

main();
