# Getting started

Needs **Node 22+**.

## Claude Code

```bash
claude mcp add torob -- npx -y torob-mcp
```

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "torob": {
      "command": "npx",
      "args": ["-y", "torob-mcp"]
    }
  }
}
```

## Cursor

`.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` globally — same JSON as above.

## Try without installing

```bash
npx -y torob-mcp --help
npx -y @modelcontextprotocol/inspector npx -y torob-mcp
```

## First questions to try

- «قیمت گوشی سامسونگ A55 چنده؟»
- "Best wireless headphones under 2 million Toman"
- "Is 113 million Toman a good price for a used iPhone 13 Pro right now?"

More: [Recipes](Recipes). Tool reference: [Tools](Tools).

## Remote / HTTP mode

```bash
torob-mcp --http                      # 127.0.0.1:3000
torob-mcp --http --host 0.0.0.0       # requires TOROB_AUTH_TOKEN
```

Non-loopback binds need a bearer token (16+ chars) unless you pass `--insecure`. See [Deploy](Deploy).

## Configuration

All optional. Full table in the [README](https://github.com/siamak/torob-mcp/blob/main/README.md#configuration) and [`.env.example`](https://github.com/siamak/torob-mcp/blob/main/.env.example).
