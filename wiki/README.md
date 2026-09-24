# Wiki source

User-facing guides for torob-mcp. Canonical copy lives here so PRs can review it with the code.

| Page                                     | Audience                        |
| ---------------------------------------- | ------------------------------- |
| [Home.md](Home.md)                       | Map of the wiki                 |
| [fa/Home.md](fa/Home.md)                 | Persian home                    |
| [Getting-Started.md](Getting-Started.md) | Install (Claude / Cursor / npx) |
| [Tools.md](Tools.md)                     | All fifteen tools               |
| [Recipes.md](Recipes.md)                 | Example prompts                 |
| [Deploy.md](Deploy.md)                   | Egress warning + short recipes  |
| [Privacy.md](Privacy.md)                 | What reaches Torob              |
| [Contributing.md](Contributing.md)       | Contributor quickstart          |
| [Deep-Docs.md](Deep-Docs.md)             | Links into `docs/`              |

`_Sidebar.md` and `_Footer.md` are for the [GitHub Wiki](https://github.com/siamak/torob-mcp/wiki) when published.

## Publish to GitHub Wiki

GitHub only creates `torob-mcp.wiki` after the **first page** exists in the UI:

1. Open https://github.com/siamak/torob-mcp/wiki and create any first page.
2. Run `pnpm wiki:publish` from the repo root.

Deep technical reference stays in [`docs/`](../docs/README.md) — do not duplicate it here.
