# torob-mcp wiki

Unofficial MCP server for [torob.com](https://torob.com) — ask an assistant what something costs in Iran, who sells it cheapest, and whether the shop can be trusted.

> **Unofficial.** Not affiliated with Torob. Prices come from Torob and are reported as-is.

[فارسی](fa/Home) · [Repository](https://github.com/siamak/torob-mcp) · [npm](https://www.npmjs.com/package/torob-mcp)

## Start here

| I want to… | Page |
| --- | --- |
| Install it | [Getting started](Getting-Started) |
| See every tool | [Tools](Tools) |
| Copy example prompts | [Recipes](Recipes) |
| Deploy remotely | [Deploy](Deploy) — **read the egress warning first** |
| Know what Torob receives | [Privacy](Privacy) |
| Contribute | [Contributing](Contributing) |
| Dig into internals | [Deep docs](Deep-Docs) |

## One-liner install

```bash
claude mcp add torob -- npx -y torob-mcp
```

Needs **Node 22+**. Full client configs (Claude Desktop, Cursor): [Getting started](Getting-Started).

## Remember

Torob blocks many cloud egress IPs. Local use is fine; remote hosts often are not. Details: [Deploy](Deploy).
