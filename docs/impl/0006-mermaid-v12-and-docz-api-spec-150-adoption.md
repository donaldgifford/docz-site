---
id: IMPL-0006
title: "Mermaid v12 and docz-api spec 1.5.0 adoption"
status: Draft
author: Donald Gifford
created: 2026-09-14
---

<!-- markdownlint-disable-file MD025 MD041 -->

# IMPL-0006: Mermaid v12 and docz-api spec 1.5.0 adoption

<!--toc:start-->
- [Objective](#objective)
- [Scope](#scope)
  - [In Scope](#in-scope)
  - [Out of Scope](#out-of-scope)
- [Implementation Phases](#implementation-phases)
  - [Phase 1: Vendor the 1.5.0 contract](#phase-1-vendor-the-150-contract)
    - [Tasks](#tasks)
    - [Success Criteria](#success-criteria)
  - [Phase 2: Light up the timestamps](#phase-2-light-up-the-timestamps)
    - [Tasks](#tasks-1)
    - [Success Criteria](#success-criteria-1)
  - [Phase 3: Order and filter the directory](#phase-3-order-and-filter-the-directory)
    - [Tasks](#tasks-2)
    - [Success Criteria](#success-criteria-2)
  - [Phase 4: Mermaid v12](#phase-4-mermaid-v12)
    - [Tasks](#tasks-3)
    - [Success Criteria](#success-criteria-3)
  - [Phase 5: Guards, docs, release](#phase-5-guards-docs-release)
    - [Tasks](#tasks-4)
    - [Success Criteria](#success-criteria-4)
- [File Changes](#file-changes)
- [Testing Plan](#testing-plan)
- [Dependencies](#dependencies)
- [Open Questions](#open-questions)
  - [OQ-1](#oq-1)
  - [OQ-2](#oq-2)
  - [OQ-3](#oq-3)
  - [OQ-4](#oq-4)
  - [OQ-5](#oq-5)
  - [OQ-6](#oq-6)
  - [OQ-7](#oq-7)
  - [OQ-8](#oq-8)
  - [OQ-9](#oq-9)
  - [OQ-10](#oq-10)
- [References](#references)
<!--toc:end-->

## Objective

Adopt two upstream changes that landed independently and both touch
surfaces this repo owns.

1. **docz-api spec 1.5.0** ([#29]) adds `created` and `updated_at` to
   `SearchHit`, a `sort` parameter, and a `source` filter. The directory's
   updated column has been rendering an em dash since IMPL-0005 because
   the field did not exist; it now does.
2. **mermaid 12.0.0** ([#30]) is a breaking major: ELK replaces dagre as
   the default layout, appearance defaults change, and the browser floor
   rises to ES2024 / Safari 17.4.

**Implements:** no RFC or DESIGN of its own. The mermaid layout and
appearance decisions amend DESIGN-0005's diagram policy (see [OQ-8](#oq-8));
the search changes complete asks recorded in DESIGN-0001 and DESIGN-0004.

Neither change is forced. Every 1.5.0 change is additive, and the
existing defensive read in `src/lib/updatedAt.ts` already lights the
column up on deploy with no code change here. Mermaid 11 keeps working.
This is deliberate adoption, not a forced migration, which is why the
phases below are ordered so each is independently revertable.

## Scope

### In Scope

- Re-vendoring `api/openapi.yaml` at 1.5.0 and regenerating the orval
  client.
- Consuming `SearchHit.updated_at` and `SearchHit.created` as typed
  fields, replacing the defensive read.
- Sending `sort` from the directory, and handling the new `400`.
- Sending `source`, replacing client-side doc/page separation.
- Teaching the MSW fixtures to honor `sort` and `source` so `dev:msw`
  and e2e reflect real ordering.
- Upgrading mermaid to 12.x, with explicit `layout` and appearance
  configuration, and re-verifying the two settings that make
  `MermaidBlock` the only sanctioned `innerHTML` in the codebase.
- Widening the e2e chunk assertion so an eagerly-imported ELK cannot
  pass a test written to catch exactly that.
- Updating `CLAUDE.md`, DESIGN-0005, and the fixture/premise comments
  that 1.5.0 falsifies.

### Out of Scope

- **Any change in docz-api.** Both upstream changes are merged there.
- **Multi-value facet filters.** `searchDocs` still accepts one value
  per facet; `toSearchDocsParams` still sends the first of each array.
  Unchanged by 1.5.0.
- **Re-ranking the palette.** The palette wants relevance, not recency.
  It sends no `sort`.
- **Chart or deployment changes.** No new runtime configuration.
- **A diagram-authoring guide.** If ELK changes how authors should write
  flowcharts, that is a follow-up doc, not this one.

## Implementation Phases

Each phase builds on the previous one. A phase is complete when all its
tasks are checked off and its success criteria are met.

Phases 1–3 are the API work and Phase 4 is the mermaid work; they share
no files. Phase 4 can be lifted into its own PR at any point without
disturbing 1–3 (see [OQ-9](#oq-9)).

---

### Phase 1: Vendor the 1.5.0 contract

Bring the spec and the generated client up to 1.5.0 with **no behavior
change**. This phase should be reviewable as "types got wider, nothing
moved".

#### Tasks

- [ ] Copy `api/openapi.yaml` from docz-api main (currently 1.4.1 here,
      1.5.0 upstream). The diff is: `source` and `sort` query params on
      `searchDocs`, a `400` response on that operation, a new
      `BadRequest` response component, `created` and `updated_at` added
      to `SearchHit` and both listed `required`, plus description-only
      edits to `Document.updated_at` and `Session.groups`.
- [ ] Run `bun run gen-api` and confirm the generated client gains the
      two `SearchHit` properties and union types for `sort` and
      `source`.
- [ ] Run `just gen-api-check` — the drift gate must be clean against
      the freshly vendored spec.
- [ ] Confirm `bunx tsc -b --force` still passes with no source change.
      `SearchHit` gaining required properties is a widening for readers;
      the only expected breakage is in code that *constructs* a
      `SearchHit`, which is the fixtures and two test helpers.
- [ ] Fix construction sites revealed by the typecheck by adding
      `created` and `updated_at`: `src/mocks/fixtures.ts`,
      `src/lib/updatedAt.test.ts`, `src/routes/directory.test.tsx`.
      Use placeholder values here; Phase 2 makes them meaningful.
- [ ] Confirm no runtime behavior changed: full `bun run test` green
      with no test edits beyond the construction sites.

#### Success Criteria

- `api/openapi.yaml` reports `info.version: 1.5.0`.
- `just gen-api-check` is clean.
- `bunx tsc -b --force`, `bun run lint`, `bun run format:check` all
  pass.
- All existing tests pass with no assertion changes — only `SearchHit`
  literals gained fields.
- The OpenAPI Spec Drift workflow reports no drift on the PR.

---

### Phase 2: Light up the timestamps

Replace the defensive read with the typed field, correct the premise
the old comments encode, and make the fixtures carry real dates.

#### Tasks

- [ ] Rewrite `src/lib/updatedAt.ts`:
  - [ ] Drop the `as { updated_at?: unknown }` cast in `hitUpdatedAt`;
        the property is typed. Decide whether the function survives at
        all as a one-line accessor or is inlined (see [OQ-7](#oq-7)).
  - [ ] Rewrite the module comment. It currently describes the field as
        absent from the schema and explains the upstream ask — all of
        which is now false and actively misleading.
  - [ ] Keep `formatUpdatedStamp` and its en-US/timeZone contract
        unchanged. It is already correct for an RFC3339 UTC input.
- [ ] Correct the "pages have no timestamp" premise, which 1.5.0
      falsifies. It appears in at least three places: the
      `src/lib/updatedAt.ts` module comment, the `UpdatedCell` comment
      in `src/routes/directory.tsx`, and the fixture comment in
      `src/mocks/fixtures.ts`. `created` is the field that is empty on
      page hits, not `updated_at`.
- [ ] Give fixture page records a timestamp. `Page` has no `updated_at`
      in the spec (verified — the schema is `repo`, `path`, `title`,
      `raw_md`, `git_sha`), so `FixturePageInput` needs its own
      `updatedAt` used when building search hits.
- [ ] Give fixture doc hits a `created` from the document's frontmatter
      date, and page hits `created: ""`.
- [ ] Remove the `SearchHit & { updated_at: string }` intersection type
      in `src/mocks/fixtures.ts` — the plain generated type now
      suffices.
- [ ] Update `src/lib/updatedAt.test.ts`: the "returns '' for the hits
      today's API actually sends" case describes a world that no longer
      exists. Replace with coverage of the real shapes, including `""`.
- [ ] Update `src/routes/directory.test.tsx`: page rows now render a
      stamp rather than an em dash. The current assertion
      (`getAllByText("—").length > 0`) will fail, and should — replace
      it with an assertion that both kinds render a date.
- [ ] Decide and implement whether `created` surfaces anywhere
      ([OQ-6](#oq-6)).

#### Success Criteria

- No file in `src/` casts, probes, or otherwise second-guesses the
  presence of `updated_at`.
- No comment in `src/` claims pages have no timestamp.
- Under `bun run dev:msw`, every directory row — doc and page — renders
  a real date and time.
- `bun run test` green; the tests that change do so because the
  contract changed, not because assertions were loosened.

---

### Phase 3: Order and filter the directory

Send `sort` and `source`. This is the first phase with user-visible
behavior change, and the first that can regress search quality.

#### Tasks

- [ ] Extend `DirectorySearchState` in `src/lib/searchParams.ts` with
      the chosen sort and source representation, keeping the module's
      rule intact: the URL is the only source of filter truth.
- [ ] Parse and serialize the new keys, omitting defaults so shared
      URLs stay clean (the existing convention).
- [ ] Map them in `toSearchDocsParams`, using the generated union types
      rather than string literals.
- [ ] Apply the default ordering decided in [OQ-3](#oq-3).
- [ ] Confirm the grow-the-window pagination still holds. The directory
      sends `offset: 0` with `limit: state.offset + PAGE_SIZE`, so rows
      0..N are refetched on every "load more". A total-order sort makes
      this *more* stable than relevance ranking did, but assert it:
      loading more must never reshuffle rows already on screen.
- [ ] Teach the fixture `searchDocs` resolver to honor `sort`,
      including the documented quirk that **records with no value for
      the sort key sort last in both directions** — so `created:*` puts
      page hits after every document either way. A fixture that ignores
      this makes `dev:msw` and e2e lie about ordering.
- [ ] Teach the fixture resolver to honor `source`, and to return
      `400 {"error":"invalid sort"}` for an unrecognized `sort` so the
      error path is reachable in tests.
- [ ] Handle the new `400`. `searchDocs` had no 4xx before this; a
      malformed `sort` is now the first. Implement per [OQ-5](#oq-5).
- [ ] Replace client-side doc/page separation with `source` where the
      UI already distinguishes them. Keep the directory count line's
      "· X docs · Y pages" behavior byte-identical for deployments that
      publish no pages.
- [ ] Add `src/lib/searchParams.test.ts` cases for the new keys: parse,
      serialize, round-trip, default omission, and rejection of a value
      outside the enum.
- [ ] Add a directory route test that a filter change pushes history
      (the existing rule) and that the new controls, if any, follow it.

#### Success Criteria

- The directory's default listing order matches the [OQ-3](#oq-3)
  decision, verified in `dev:msw` against fixture dates.
- A deep link carrying the new params reproduces the same rows in the
  same order.
- "Load more" never reorders rows already rendered.
- An unrecognized `sort` surfaces as a handled error, not an unhandled
  rejection or a retry storm.
- `bun run test` and `just e2e` green.

---

### Phase 4: Mermaid v12

Independent of Phases 1–3; shares no files with them.

The security posture is the part of this phase that cannot be rushed.
The v12 release notes say **nothing** about `securityLevel` or
`htmlLabels`. Silence is not evidence. `strict` alone is known to be
insufficient — purified-but-real elements still materialize inside
`foreignObject` labels, which is why `htmlLabels: false` is set both
globally and per-flowchart.

#### Tasks

- [ ] Bump `mermaid` to `^12.0.0` in `package.json` and update the
      lockfile.
- [ ] Set `layout` explicitly in `getMermaid()`
      (`src/markdown/mermaid-block.tsx`) per the [OQ-1](#oq-1)
      decision. Not setting it is itself a decision, and a silent one:
      every flowchart, state, class, ER, and requirement diagram
      re-lays out.
- [ ] Keep `nodeBorder` in `mermaidThemeFromTokens()`. The new `neo`
      look paints node strokes with a gradient when the theme sets
      `useGradient`, which `base` does, and a custom `nodeBorder` is
      what turns that off. Removing it would grow gradients silently
      and break the monochrome policy.
- [ ] Re-validate every key in `mermaidThemeFromTokens()` against the
      v12 theme schema. The map is commented as the "minimal documented
      v11 set", and an unknown variable breaks `mermaid.render`
      *silently* — the failure mode is a blank figure, not an error.
- [ ] Verify `securityLevel: "strict"` and `htmlLabels: false` still
      exist, are still honored, and still have the same meaning in 12.x.
      Read the v12 config schema; do not infer it from the absence of a
      release note.
- [ ] Run the XSS suite (`src/markdown/processor.xss.test.tsx`) and the
      e2e hostile-label row in `e2e/rendering.spec.ts`, which renders a
      node label carrying an `<img>` payload. Confirm no element
      materializes from document text.
- [ ] Note that DOMPurify moves `^3.3.3` → `^3.4.12` transitively;
      confirm no advisory applies to the resolved version.
- [ ] Widen the chunk assertion in `e2e/rendering.spec.ts` from
      `/mermaid/i` to also match ELK. ELK ships as its own ESM chunk
      whose filename will not contain "mermaid", so an eagerly-imported
      ELK would pass the test written to prevent exactly that.
- [ ] Re-check the jsdom mermaid mock in `src/a11y/axe.test.tsx` still
      matches the v12 module shape (it mocks the default export and
      forces the rejecting path).
- [ ] Confirm all three specimen fences still render, including
      Figure 2's per-node `classDef` colors. Mermaid scopes a diagram's
      own `classDef` by render id, which is why it outranks the
      stylesheet; confirm that is still true in v12.
- [ ] Run `just bundle-budget`. The eager budget should be untouched
      (mermaid is behind a dynamic import), but record the new
      diagram-page chunk cost — ELK is roughly 500 KB gzipped in the
      inlined build.
- [ ] Confirm `import("mermaid")` still resolves to the package
      specifier. Upstream notes that `dist/mermaid.esm.min.mjs` now
      contains syntax `es-module-lexer` (which Vite uses) rejects; we
      are unaffected only because we import the bare specifier. Do not
      deep-path into `dist`.
- [ ] Address the ES2024 / Safari 17.4 floor per [OQ-4](#oq-4).

#### Success Criteria

- `mermaid` resolves to 12.x in the lockfile.
- All three specimen diagrams render, monochrome, with Figure 2's
  `classDef` colors intact.
- The XSS suite and the e2e hostile-label row are green, and the
  rendered SVG contains no element originating in document text.
- `just e2e` green, including the widened chunk assertion.
- `just bundle-budget` green; the eager total is unchanged from 122.2 KB
  except for noise.
- A visual diff of the specimen page before and after is attached to
  the PR. This is the only check that answers "do the diagrams still
  look right", so it is recorded rather than automated.

---

### Phase 5: Guards, docs, release

#### Tasks

- [ ] Update `CLAUDE.md`: the mermaid paragraph (layout, any moved
      invariant), the directory paragraph (ordering and the source
      filter), and the updated-column paragraph, which currently
      documents the field as absent and the upstream ask as open.
- [ ] Amend DESIGN-0005 per [OQ-8](#oq-8) with the diagram layout and
      appearance decision.
- [ ] Add a specimen section if v12 introduces a construct worth
      rendering — the standing rule is that a pipeline feature lands
      with a specimen section in the same commit. Use-case diagrams are
      new in v12.
- [ ] Close [#29] and [#30] with a pointer to the merge commit.
- [ ] Regenerate `CHANGELOG.md` with `git fetch --tags` first, commit as
      `chore(changelog): Auto-sync`, and make it the **last** commit on
      the branch.
- [ ] Apply exactly one release label per [OQ-2](#oq-2).
- [ ] Flip this document's status to Completed and tick every box.

#### Success Criteria

- `just ci` passes end to end.
- No comment or document in the repo still describes
  `SearchHit.updated_at` as missing or the sort/source asks as open.
- Both issues closed, changelog clean, exactly one release label
  applied.

---

## File Changes

| File | Action | Description |
| ---- | ------ | ----------- |
| `api/openapi.yaml` | Modify | Re-vendor at 1.5.0 |
| `src/api/__generated__/` | Regenerate | orval output; gitignored, never hand-edited |
| `src/lib/updatedAt.ts` | Modify | Drop the defensive cast; rewrite the now-false module comment |
| `src/lib/updatedAt.test.ts` | Modify | Replace the "field is absent" cases |
| `src/lib/searchParams.ts` | Modify | `sort` and `source` in URL state and query params |
| `src/lib/searchParams.test.ts` | Modify | Parse/serialize/round-trip for the new keys |
| `src/routes/directory.tsx` | Modify | Default ordering, source filter, 400 handling, comment fixes |
| `src/routes/directory.test.tsx` | Modify | Page rows now dated; ordering and history assertions |
| `src/mocks/fixtures.ts` | Modify | `created`, page timestamps, honor `sort`/`source`, emit 400 |
| `src/markdown/mermaid-block.tsx` | Modify | Explicit `layout`; theme variables re-validated for v12 |
| `src/a11y/axe.test.tsx` | Modify | Confirm the mermaid mock matches the v12 module shape |
| `e2e/rendering.spec.ts` | Modify | Widen the chunk assertion to cover ELK |
| `package.json`, `bun.lock` | Modify | `mermaid ^12.0.0` |
| `vite.config.ts` | Modify | Only if [OQ-4](#oq-4) chooses an explicit build target |
| `docs/design/0005-*.md` | Modify | Amendment recording the diagram layout decision |
| `CLAUDE.md` | Modify | Mermaid, directory ordering, updated-column paragraphs |
| `docs/guides/markdown-specimen.md` | Modify | Only if a v12 construct is worth rendering |

## Testing Plan

- [ ] `src/lib/searchParams.test.ts` — table-driven cases for `sort` and
      `source`: parse, serialize, round-trip, default omission, and a
      value outside the enum.
- [ ] `src/lib/updatedAt.test.ts` — real 1.5.0 shapes, including `""`
      for an unset stamp and `created: ""` on page hits.
- [ ] `src/routes/directory.test.tsx` — default order matches the
      OQ-3 decision; both record kinds render a date; "load more" does
      not reshuffle; a filter change pushes history.
- [ ] Fixture-level test that the MSW resolver honors `sort` including
      the sorts-last-in-both-directions quirk. Without this the fixture
      silently diverges from the real API and every downstream test
      inherits the lie.
- [ ] `src/markdown/processor.xss.test.tsx` — unchanged assertions, run
      against mermaid 12 to confirm the sanitizer contract holds.
- [ ] `e2e/rendering.spec.ts` — hostile-label row green under v12;
      widened chunk assertion; all three specimen fences render.
- [ ] `e2e/a11y.spec.ts` — full-rule axe over the specimen with real
      v12 diagrams, contrast included.
- [ ] `just bundle-budget` — eager total unchanged.
- [ ] Manual: `bun run dev:msw`, confirm ordering and dates on the
      directory and diagrams on the specimen. Screenshots to the PR.

## Dependencies

- **docz-api has not cut a release containing 1.5.0.** The spec change
  merged as `0e9d06d` on main, but the newest tag is `v0.9.0` from
  2026-09-02, which predates it. A deployment running a tagged docz-api
  image will ignore `sort` and `source` as unknown query parameters and
  omit `created`/`updated_at` from hits — while the generated types
  declare both `required`. See [OQ-10](#oq-10); this is the one item
  that can turn a green PR into a broken deployment.
- `mermaid@12.0.0` (published 2026-09-10) and its bundled ELK.
- No other repo, chart, or infrastructure change is required.

## Open Questions

Answer format: **a** is the recommendation, **b** onward are the
alternatives, and *other* is free text.

### OQ-1

**Mermaid layout: keep dagre or adopt ELK?** v12 makes ELK the default,
so doing nothing silently re-lays out every diagram.

- **a.** Pin `layout: "dagre"` in `getMermaid()` as part of the upgrade,
  and evaluate ELK separately. *Recommended:* it keeps a dependency
  upgrade from also being an unreviewed visual change, and makes the
  diff honest about what it does. ELK is then a deliberate follow-up
  with its own before/after review.
- **b.** Adopt ELK now and re-review all three specimen diagrams in the
  same PR.
- **c.** Adopt ELK *and* the new `look`/appearance defaults, treating
  v12 as a full restyle.
- **d.** Pin dagre permanently and record it as policy.

### OQ-2

**Release label for this work.** The repo requires exactly one of
`major` / `minor` / `patch` / `dont-release`.

- **a.** `minor` (v0.8.0). *Recommended:* the directory gains a new
  default ordering and dated rows — user-visible behavior, not a fix.
- **b.** `patch`, treating it as dependency upkeep.
- **c.** `dont-release`, folding it into the next feature release.

### OQ-3

**Default directory ordering.** [#29] says to pass
`sort=updated_at:desc` as the default. Worth deciding deliberately,
because the spec is explicit that `sort` is a **total order over the
matches, not a tie-break within relevance** — so sorting while the user
is searching ranks a recently-ingested irrelevant document above the
best text match.

- **a.** Sort by `updated_at:desc` only when the query is empty; send no
  `sort` once the user types, falling back to relevance. *Recommended:*
  the empty directory is a browse surface where recency is the right
  order, and a search box is a relevance surface. This gets both without
  a control.
- **b.** Always `updated_at:desc`, as [#29] literally asks.
- **c.** Never sort; keep relevance ordering everywhere.
- **d.** Expose it as a user-controlled URL parameter and let the
  default be whichever of the above you pick.

### OQ-4

**ES2024 / Safari 17.4 floor.** `vite.config.ts` sets no explicit
`build.target`, so today the Vite default decides.

- **a.** Set an explicit `build.target` matching mermaid's floor and
  record the supported-browser statement in `README.md`.
  *Recommended:* the floor now exists whether or not it is written down,
  and an unstated floor becomes a bug report from an old iPad.
- **b.** Leave the default and say nothing; accept that diagram pages
  may break on older Safari while the rest of the site works.
- **c.** Transpile mermaid down at build time to preserve the current
  floor, accepting the bundle and complexity cost.

### OQ-5

**Handling the new `400`.** `searchDocs` gains its first 4xx. Our
fetcher maps 401, 404, and 503 to named classes and everything else to
`ApiError`, and `query-client.ts` skips retries only for 401 and 404.

- **a.** Add a `BadRequestError` class beside the others and add it to
  the no-retry list. *Recommended:* it matches the established pattern,
  and a 400 is a stable answer — retrying twice is pure waste.
- **b.** Leave it as a generic `ApiError`; it retries twice and then
  surfaces in the existing error panel.
- **c.** No new class, but broaden the retry predicate to skip every
  4xx.

Note that with the generated union types, we can only send a valid
`sort`, so this path is reachable in practice only via a hand-edited
URL — which is exactly why it should fail cheaply rather than loudly.

### OQ-6

**Surface `created` on the directory card?** The card was just
redesigned and deliberately has exactly two lines per outer column.

- **a.** No. Keep `updated_at` only, and hold `created` in reserve.
  *Recommended:* the card's balance came from a dial-in round; a third
  date is the kind of addition that quietly undoes it.
- **b.** Show `created` instead of `updated_at` on doc rows, since it is
  the authored date and `updated_at` is ingest-observed.
- **c.** Show both, `created` over `updated_at`.
- **d.** Show `created` in the reader's metadata table rather than the
  directory.

### OQ-7

**Does `hitUpdatedAt` survive?** Once the property is typed, the
function is `hit.updated_at`.

- **a.** Delete it; read the property directly and keep
  `formatUpdatedStamp` as the module's only export alongside
  `formatRelativeTime`. *Recommended:* the wrapper existed solely to
  hide an untyped probe. Keeping it preserves the shape of a problem
  that no longer exists.
- **b.** Keep it as a one-line accessor for symmetry with
  `apiConfig`/`changelogConfig`.
- **c.** Keep it but narrow it to normalizing `""` into `undefined`.

### OQ-8

**Where does the diagram layout decision get recorded?**

- **a.** A ninth amendment to DESIGN-0005, which already owns the
  monochrome diagram policy and the `classDef` precedence rule.
  *Recommended:* it is the same subject, and that doc is already the
  place people look.
- **b.** A new DESIGN doc for diagram rendering, splitting it out of the
  typography design.
- **c.** Record it in `CLAUDE.md` only.

### OQ-9

**One PR or two?** The branch covers both issues, which share no files.

- **a.** One PR, phases in order, mermaid last so it can be dropped by
  reverting one commit range if it turns problematic. *Recommended:*
  matches the branch you asked for and keeps one changelog entry per
  concern.
- **b.** Two stacked PRs, API first. Note the stacked-merge hazard
  recorded in `CLAUDE.md`: merge bottom-up, one at a time.
- **c.** Land the API work now and defer mermaid entirely until the
  ELK question has its own review.

### OQ-10

**Shipping ahead of a docz-api release.** 1.5.0 is on docz-api main but
not in any tag; the newest is `v0.9.0` from 2026-09-02. A deployment
pinned to a released image will omit `created` and `updated_at` even
though the generated types mark them `required`, and will ignore `sort`
and `source`.

- **a.** Build the consuming code to tolerate their absence — treat a
  missing stamp exactly as `""` — and say so in a comment naming this
  as the reason. *Recommended:* it is the same hazard as `arr()` and the
  nil-slice bug, it costs almost nothing, and it makes the deploy order
  irrelevant.
- **b.** Gate the merge on docz-api cutting a release, and pin the chart
  to it.
- **c.** Ship as-is and accept that rows render undated until the API
  catches up, since that is the current behavior anyway.

## References

- [#29] — docz-api spec 1.5.0: dated, sortable, source-filterable search
  hits
- [#30] — Upgrade mermaid to v12
- donaldgifford/docz-api#34 — the original ask, closed by
  donaldgifford/docz-api#37
- docz-api `docs/design/0005-timestamped-and-sortable-search-hits.md`
- [mermaid 12.0.0 release](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0)
- [mermaid#8155](https://github.com/mermaid-js/mermaid/pull/8155) —
  ELK bundled and made the default layout
- [mermaid#8213](https://github.com/mermaid-js/mermaid/pull/8213) —
  ES2024, Safari 17.4+, Node 22.12+
- DESIGN-0005 — reader typography, monochrome diagram policy, `classDef`
  precedence
- IMPL-0005 — published pages, where the em-dash updated column
  originated

[#29]: https://github.com/donaldgifford/docz-site/issues/29
[#30]: https://github.com/donaldgifford/docz-site/issues/30
