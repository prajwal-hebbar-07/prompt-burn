# docs/

Prompt Burn is a local-only dashboard for OMP and Cursor token usage, priced as estimated
pay-as-you-go cost. It lives in two shells — a Tauri desktop app and a VS Code editor tab — and
never sends data anywhere.

Product decisions live in [product.md](product.md). That is an **input document**: it describes
what to build, not what exists. What exists is documented by the numbered pairs below.

[release.md](release.md) is the second input document: how a version is bumped and how the
desktop `.dmg` and the VS Code `.vsix` reach a GitHub Release.

## Areas

Every numbered area is documented twice — one technical reading, one plain-English reading.
Same number, same subject.

| #   | Area                                            | Architecture                                                  | Plain English                                                  |
| --- | ----------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 01  | Repo scaffold and workspace tooling             | [01-repo-scaffold.md](architecture/01-repo-scaffold.md)       | [01-the-workshop.md](plain-english/01-the-workshop.md)         |
| 02  | Product plan and locked decisions               | [02-product-plan.md](architecture/02-product-plan.md)         | [02-the-blueprint.md](plain-english/02-the-blueprint.md)       |
| 03  | Data-shape spike (OMP and Cursor)               | [03-data-shape-spike.md](architecture/03-data-shape-spike.md) | [03-the-probe.md](plain-english/03-the-probe.md)               |
| 04  | Core domain (types, period filter, aggregation) | [04-core-domain.md](architecture/04-core-domain.md)           | [04-the-ledger.md](plain-english/04-the-ledger.md)             |
| 05  | The database (packages/db)                      | [05-database.md](architecture/05-database.md)                 | [05-the-file-cabinet.md](plain-english/05-the-file-cabinet.md) |
| 06  | OMP collector (packages/collectors)             | [06-omp-collector.md](architecture/06-omp-collector.md)       | [06-the-harvester.md](plain-english/06-the-harvester.md)       |
| 07  | Desktop shell (Tauri v2 + Node sidecar)         | [07-desktop-shell.md](architecture/07-desktop-shell.md)       | [07-the-front-door.md](plain-english/07-the-front-door.md)     |
| 08  | UI components (packages/ui)                     | [08-ui-components.md](architecture/08-ui-components.md)       | [08-the-showroom.md](plain-english/08-the-showroom.md)         |
| 09  | Usage reader (packages/reader)                  | [09-usage-reader.md](architecture/09-usage-reader.md)         | [09-the-switchboard.md](plain-english/09-the-switchboard.md)   |
| 10  | VS Code extension (apps/vscode)                 | [10-vscode-extension.md](architecture/10-vscode-extension.md) | [10-the-workbench.md](plain-english/10-the-workbench.md)       |

Numbers are append-only. Areas 01–10 cover the entire workspace: core domain, database,
collectors, desktop shell, shared UI components, usage reader orchestrator, and VS Code extension.

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

- Baseline: `0201ec9` — 2026-09-12 (`test(db): remove undefined db.close call in settings reopen test`),
  swept 2026-09-12 (pairs 04–10 refreshed; pair 03 untouched).

<!-- docs-baseline: 0201ec9b991678363240e118bc64423de2cdf3e2 -->
<!-- parent-owned: area table, blurbs, baseline. Pair docs live in architecture/ and
plain-english/. -->
