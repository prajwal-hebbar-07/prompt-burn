# docs/

Prompt Burn is a local-only dashboard for OMP and Cursor token usage, priced as estimated
pay-as-you-go cost. It lives in two shells — a Tauri desktop app and a VS Code editor tab — and
never sends data anywhere.

Product decisions live in [product.md](product.md); the build sequence is
[implementation-plan.md](implementation-plan.md). Those two are **input documents**: they describe
what to build, not what exists. What exists is documented by the numbered pairs below.

## Areas

Every numbered area is documented twice — one technical reading, one plain-English reading.
Same number, same subject.

| # | Area | Architecture | Plain English |
|---|------|--------------|---------------|
| 01 | Repo scaffold and workspace tooling | [01-repo-scaffold.md](architecture/01-repo-scaffold.md) | [01-the-workshop.md](plain-english/01-the-workshop.md) |
| 02 | Product plan and locked decisions | [02-product-plan.md](architecture/02-product-plan.md) | [02-the-blueprint.md](plain-english/02-the-blueprint.md) |
| 03 | Data-shape spike (OMP and Cursor) | [03-data-shape-spike.md](architecture/03-data-shape-spike.md) | [03-the-probe.md](plain-english/03-the-probe.md) |

Numbers are append-only. Future areas (`packages/core`, `packages/db`, `packages/collectors`,
`packages/ui`, `apps/desktop`, `apps/vscode`) take 04+ when their first real commit lands — the
implementation plan forbids scaffolding empty packages, so no pair exists before its code does.

## Architecture docs

`docs/architecture/NN-<slug>.md` — for engineers working on the repo. Exact, cited, and blunt
about debt: inventory, public surface, flows, contracts, configuration, tests, and a deliberate
list of traps. Ten fixed sections so knowing one document is knowing all of them.

## Plain-English docs

`docs/plain-english/NN-<slug>.md` — the same subjects in everyday words, one metaphor per area,
for anyone who does not write code. They keep the honest parts: mocked transports, untested
areas, and contradicted decisions appear here too.

## Freshness

The pairs are read against a stored baseline; anything committed after it may not be documented
yet. Advance it only after a docs sweep re-read every pair the diff touched.

- Baseline: `836d6c3` — 2026-09-02 (`feat: add data-shape spike for OMP and Cursor usage`),
  bootstrapped 2026-09-03.

<!-- parent-owned: area table, blurbs, baseline. Pair docs live in architecture/ and
plain-english/. -->