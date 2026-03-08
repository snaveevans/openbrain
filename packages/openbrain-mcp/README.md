# @snaveevans/openbrain-mcp

MCP server for interacting with Open Brain memories over Supabase Edge Functions.

## Run

```bash
npx -y @snaveevans/openbrain-mcp --project-id your-project-id --api-key your-api-key
```

You can also pass a full base URL instead of a project id:

```bash
npx -y @snaveevans/openbrain-mcp --base-url https://your-project.supabase.co/functions/v1 --api-key your-api-key
```

## Environment variables

- `OPENBRAIN_API_KEY`
- `OPENBRAIN_PROJECT_ID`
- `OPENBRAIN_BASE_URL`

## Tools

- `create_memory`
- `delete_memory`
- `search_memories`
