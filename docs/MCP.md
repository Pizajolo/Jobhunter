# Using your pipeline from other MCP clients

Jobhunter includes an MCP server, so Claude Desktop, Claude Code or any other MCP client can answer questions about your job search ("which applications are waiting longer than three weeks?").

It is **read-only** by default:

| Tool | What it does |
|---|---|
| `pipeline_summary` | counts per board column and status |
| `list_applications` | applications with company, title, status and score; filter by status or text |
| `get_application` | one application with match reasons, gaps, notes and the timeline |

Start it with `--allow-writes` to add `update_status` and `add_note`. Status changes follow the same rules as the app and run as the agent, so a client can, for example, dismiss a job but never mark one as applied for you.

The server reads the same database as the app, so start Jobhunter at least once first.

## Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config). Use the path to `main.js` from your installation:

```json
{
  "mcpServers": {
    "jobhunter": {
      "command": "node",
      "args": ["/path/to/jobhunter/apps/engine/dist/main.js", "mcp"]
    }
  }
}
```

From a source checkout, build first with `pnpm --filter @jobhunter/engine build`. If your data folder is not the default one, add `"env": { "JOBHUNTER_DATA_DIR": "/path/to/data" }`.

## Docker

```json
{
  "mcpServers": {
    "jobhunter": {
      "command": "docker",
      "args": ["exec", "-i", "jobhunter", "node", "dist/main.js", "mcp"]
    }
  }
}
```

## Claude Code

```bash
claude mcp add jobhunter -- node /path/to/jobhunter/apps/engine/dist/main.js mcp
```

Whatever you ask through another client is sent to that client's model provider, under that client's terms.
