import { expect, test } from "@playwright/test";

/*
 * Rendering-pipeline journeys (IMPL-0002 Phases 2–4) against the MSW
 * preview build. The DESIGN-0777 fixture is served by a browser-worker
 * override behind the docz:e2e:rendering-doc flag (see
 * src/mocks/browser.ts) — it carries an alert, a captioned go fence,
 * and two mermaid diagrams whose node labels are hostile <img>
 * payloads, the second of which also tries to disable the protection
 * through its own front matter, so this is also where the REAL mermaid
 * strict-mode render gets its security assertion.
 */

/*
 * Chunks that must only ever load for a document containing a diagram.
 * ELK is matched separately because mermaid 12 ships it as its own ESM
 * chunk whose filename contains no "mermaid" — a pattern looking only
 * for that word would sail straight past an eagerly imported layout
 * engine, which is the single mistake these assertions exist to catch.
 */
const ELK_CHUNK = /\belk\b/i;
const DIAGRAM_CHUNK = /mermaid|\belk\b/i;

test("alerts, code chrome, and mermaid render on one doc", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("docz:e2e:rendering-doc", "1");
  });
  const diagramRequests: string[] = [];
  page.on("request", (request) => {
    if (DIAGRAM_CHUNK.test(request.url())) {
      diagramRequests.push(request.url());
    }
  });
  let dialogFired = false;
  page.on("dialog", (dialog) => {
    dialogFired = true;
    void dialog.dismiss();
  });

  await page.goto("/donaldgifford/docz-site/design/DESIGN-0777");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Rendering pipeline e2e fixture",
    }),
  ).toBeVisible();

  // Admonition with label, no leaked marker.
  await expect(page.locator(".admonition.warning .adm-label")).toHaveText(
    "Warning",
  );
  await expect(page.locator(".doc-prose")).not.toContainText("[!WARNING]");

  // Codeblock chrome: badge + caption.
  await expect(page.locator(".codeblock-header .lang")).toHaveText("go");
  await expect(page.locator(".codeblock-header .caption")).toHaveText(
    "internal/ingest/parse.go",
  );

  // Mermaid: the lazy chunk loads and both diagrams land as SVG.
  await expect(page.locator("figure.mermaid-figure svg")).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(page.locator("figure.mermaid-figure figcaption")).toHaveText([
    "fig 1 - order flow",
    "fig 2 - hostile front matter",
  ]);
  expect(diagramRequests.length).toBeGreaterThan(0);
  // ELK is the configured layout, so its chunk must actually be fetched
  // — which also keeps the diagram-free assertion below honest by
  // proving this pattern matches something real.
  expect(diagramRequests.filter((url) => ELK_CHUNK.test(url))).not.toHaveLength(
    0,
  );

  // strict + htmlLabels:false — the hostile node label stays literal
  // SVG text: no element (not even a purified <img src>) materializes
  // from document text, no foreignObject HTML islands, nothing runs.
  // Figure 2 additionally carries front matter trying to set
  // htmlLabels/securityLevel itself; `secure` keeps it inert, so these
  // same counts cover it.
  expect(await page.locator(".doc-prose img").count()).toBe(0);
  expect(await page.locator(".doc-prose foreignObject").count()).toBe(0);
  expect(await page.locator(".doc-prose script").count()).toBe(0);
  expect(dialogFired).toBe(false);
});

test("the diagram chunks stay off diagram-free docs", async ({ page }) => {
  const diagramRequests: string[] = [];
  page.on("request", (request) => {
    if (DIAGRAM_CHUNK.test(request.url())) {
      diagramRequests.push(request.url());
    }
  });

  await page.goto("/donaldgifford/docz-site/design/DESIGN-0001");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The reader (and Shiki) are fully loaded; mermaid and ELK never were.
  await expect(page.locator(".doc-prose pre").first()).toBeVisible();
  expect(diagramRequests).toHaveLength(0);
});
