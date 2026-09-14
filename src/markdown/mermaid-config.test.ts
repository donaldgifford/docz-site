/* eslint-disable @typescript-eslint/no-deprecated --
   `mermaidAPI` is mermaid's only handle on the MERGED config, and the
   merged config is precisely what this audit has to observe; `parse`
   and `render` expose neither the site config nor the result of
   applying a diagram's own directives. `flowchart.htmlLabels` is
   likewise deprecated in favour of the global flag, but the deprecated
   path is the one an attacker would reach for, so it is the one worth
   asserting on. Neither appears in shipped code. */
import { beforeAll, describe, expect, it } from "vitest";

import type { Mermaid } from "mermaid";

import {
  MERMAID_SECURE_KEYS,
  mermaidInitConfig,
} from "@/markdown/mermaid-block";

/*
 * IMPL-0006 Phase 4, OQ-11: the `secure`-list audit, kept as a test.
 *
 * `securityLevel: "strict"` alone does not stop an <img src> from
 * materializing inside a foreignObject label — `htmlLabels: false` is
 * what closes that — and mermaid lets a diagram's own YAML front matter
 * override config. Mermaid's default `secure` list guards
 * `securityLevel` but not `htmlLabels`, so without the entry in
 * MERMAID_SECURE_KEYS a document can turn off the protection that
 * neutralizes it. Verified on 11.16.0: with mermaid's defaults alone
 * the front matter below yields htmlLabels true at BOTH paths.
 *
 * This runs the REAL mermaid (the sibling MermaidBlock suite mocks it)
 * through `parse`, the same `processAndSetConfigs` path `render` takes:
 * front matter is extracted, sanitized, pushed as a directive, and
 * merged over the site config. Asserting on the merged config rather
 * than on rendered SVG keeps it runnable in jsdom, which cannot measure
 * SVG; the rendered-output half of the guarantee is the
 * hostile-front-matter figure in e2e/rendering.spec.ts.
 */

const HOSTILE = [
  "---",
  "config:",
  "  htmlLabels: true",
  "  securityLevel: loose",
  "  flowchart:",
  "    htmlLabels: true",
  // Not a secure key: proves the front-matter channel really does reach
  // the merge, so the assertions above it are not vacuous.
  "    curve: linear",
  "---",
  "flowchart TD",
  '  A["<img src=x onerror=alert(1)>"] --> B[Sink]',
].join("\n");

let mermaid: Mermaid;
let upstreamSecure: string[];
let effectiveSecure: string[];

beforeAll(async () => {
  mermaid = (await import("mermaid")).default;
  // Before initialize, the site config IS mermaid's default.
  upstreamSecure = [...(mermaid.mermaidAPI.getSiteConfig().secure ?? [])];
  mermaid.initialize(mermaidInitConfig());
  effectiveSecure = [...(mermaid.mermaidAPI.getSiteConfig().secure ?? [])];
  await mermaid.parse(HOSTILE);
});

describe("the mermaid secure list", () => {
  it("protects everything upstream protects", () => {
    // Fails if a future mermaid adds a key our literal omits — under
    // union semantics via the effective list, under clobber semantics
    // via both.
    expect(upstreamSecure.length).toBeGreaterThan(0);
    expect(effectiveSecure).toEqual(expect.arrayContaining(upstreamSecure));
    expect([...MERMAID_SECURE_KEYS]).toEqual(
      expect.arrayContaining(upstreamSecure),
    );
  });

  it("adds htmlLabels, which upstream does not protect", () => {
    expect(upstreamSecure).not.toContain("htmlLabels");
    expect(effectiveSecure).toContain("htmlLabels");
  });
});

describe("hostile diagram front matter", () => {
  it("cannot turn html labels back on", () => {
    expect(mermaid.mermaidAPI.getConfig().htmlLabels).toBe(false);
  });

  it("cannot turn them on through the nested flowchart path either", () => {
    // One top-level `secure` entry covers this: mermaid's directive
    // sanitizer recurses into nested config objects.
    expect(mermaid.mermaidAPI.getConfig().flowchart?.htmlLabels).toBe(false);
  });

  it("cannot lower the security level", () => {
    expect(mermaid.mermaidAPI.getConfig().securityLevel).toBe("strict");
  });

  it("still applies keys that are not secure", () => {
    expect(mermaid.mermaidAPI.getConfig().flowchart?.curve).toBe("linear");
  });
});
