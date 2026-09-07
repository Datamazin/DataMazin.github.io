---
name: static-site-ship-check
description: Verification checklist and gotcha list for shipping changes to a plain static HTML/CSS/JS site with no build step and no backend templating (e.g. this DATAmazin site, hosted on GitHub Pages). Use this before saying any change to such a site is "done," whenever wiring a public third-party API into client-side JS, whenever adding or copying a page that needs to match the rest of the site's shared nav/footer/stylesheet includes, and whenever someone says the live site isn't reflecting changes that were "just pushed." Covers testing with a real headless browser instead of trusting HTML by inspection, catching CORS/domain-migration/API-parameter surprises before users hit them, relative-path depth bugs, and the commit-vs-push-vs-deployed gap on GitHub Pages.
---

# Static Site Ship Check

This came out of repeatedly building and extending a static consulting site (plain HTML/CSS/vanilla JS, no framework, no build step, deployed via GitHub Pages) and hitting the same handful of failure modes over and over — each one looked completely fine by reading the source, and each one only showed up by actually running the page or checking the remote.

The common thread: a static site has no compiler, no server-side templating, and no CI to catch these for you. Every page is a standalone artifact, and "looks right in the editor" and "works" are only loosely correlated. Treat that gap as the thing this skill exists to close.

## 1. Never call it done from reading the HTML alone

Reading source is enough to catch typos, not runtime failures. Three real bugs from this exact site were invisible in the HTML/JS and only appeared at runtime: a CORS failure caused by an API's silently-migrated domain, a reversed sign in generated narrative text (a logic bug, not a syntax one), and a stylesheet link one `../` short of correct (page loaded fine, just unstyled).

Before calling a change finished:

1. Serve the site locally: `python -m http.server 8765` from the repo root (or any static server).
2. Load every page you touched — and every page that shares an include you changed (nav, footer, a CSS class) — in a real headless browser, and check for console errors, uncaught exceptions, and failed (4xx/5xx) requests. Don't just check the one page you edited; a shared CSS or JS change can silently break others.
3. Use `scripts/check-pages.js` (bundled here) to do this across the whole site at once instead of writing this by hand — see "Bundled script" below.
4. If the change has meaningful visual layout, actually look at a full-page screenshot. Zero console errors is not the same as "looks right" — a bug can render silently (e.g., a flattened nav, a broken card grid).

## 2. Third-party APIs will bite you specifically at the browser boundary

Two failure patterns showed up wiring public APIs (MLB Stats API, Frankfurter FX API) into client-side JS:

- **Node's `fetch` does not enforce CORS.** A call that works when you sanity-check it with `node -e "fetch(...)"` can fail outright in a real browser with no useful error beyond "CORS policy blocked." Testing an integration in Node proves the API responds — it does not prove the browser can call it. Verify with the actual page in a headless browser (or curl with an `Origin` header and check for `access-control-allow-origin` in the response) before trusting it.
- **APIs migrate domains and overload parameters silently.** An old domain can 301-redirect to a new one that has different CORS behavior than the one you tested. A parameter that's "usually" unambiguous (e.g., a stat category that exists in two different groupings) can silently return the wrong dataset instead of erroring — nothing tells you it's wrong, the shape just looks plausible. Curl the endpoint directly and read the actual response before wiring it up; don't rely on remembered docs or an old integration elsewhere in the codebase.

## 3. Relative paths break silently, not loudly

A file two directories deep needs `../../`, not `../`. Get the depth wrong and the page still returns 200 — it just fails to load its stylesheet or script, which reads as "the page is a little off" rather than "there's a bug," and is easy to miss unless you check the Network tab or console for 404s. When auditing links or asset paths, count directory depth from the file's actual location, not the depth you're used to typing for a similar file elsewhere.

## 4. There's no templating — every page owns its own copies

No backend means nav, footer, stylesheet `<link>`, and shared `<script>` tags are copy-pasted into every single page. A sitewide change (add a nav item, fix a footer, add a shared script) has to be applied file-by-file, and it's easy to update most pages and miss one.

After any sitewide change, audit by counting rather than trusting memory:

```bash
# Confirm every page has exactly the include you expect
for f in $(find . -name "*.html" -not -path "./.git/*"); do
  echo "$f | current-year:$(grep -c 'current-year' "$f") | main.js:$(grep -c 'main.js' "$f")"
done
```

If a page's count is 0 where every other page has 1, that's the one you missed.

## 5. On GitHub Pages, "committed" and "deployed" are not the same thing

Legacy GitHub Pages (no Actions workflow — check for `.github/workflows/`) rebuilds automatically from the branch configured in the repo's Pages settings, but only once commits actually reach GitHub. `git commit` is entirely local. When someone says "the live site doesn't reflect my changes," check these before suspecting the code or a caching issue:

```bash
git status                     # "ahead of origin/main by N commits" means it was never pushed
git log --oneline -5           # local HEAD
git log --oneline -5 origin/main  # what GitHub actually has, after `git fetch`
```

If local is ahead, `git push` and then confirm a build actually kicked off:

```bash
gh api repos/<owner>/<repo>/pages          # confirms build_type and source branch
gh api repos/<owner>/<repo>/pages/builds/latest   # confirms status: "building" / "built", and which commit
```

Pushing code and deploying are both actions with real, visible effects — confirm with the user before pushing, per normal judgment, but don't stop at "I committed it" when diagnosing why a live site looks stale.

## Bundled script

`scripts/check-pages.js` loads every `.html` file under a directory (or a specific list) in a real headless browser against a running local server, and reports console errors, page errors, and failed network requests per page. It exits non-zero if anything failed, so it can gate a "done" claim rather than just informing one.

Requires Playwright with Chromium: `npm install -D playwright && npx playwright install chromium` (one-time per machine).

```bash
python -m http.server 8765 &
node .claude/skills/static-site-ship-check/scripts/check-pages.js --base http://localhost:8765
# or, to also eyeball layout:
node .claude/skills/static-site-ship-check/scripts/check-pages.js --base http://localhost:8765 --screenshot-dir /tmp/shots
```
