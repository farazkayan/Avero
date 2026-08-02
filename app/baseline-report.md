# SPEC B.0 Baseline Report
Generated: 2026-07-31T11:16:42.633Z
Space ID used: 5f91c881-82e0-4849-9c6e-9b67e5d23505
Memory ID used: 607e7578-98e1-4504-b9e0-c07228e4e20b

## 1. Lighthouse CI Audit
### http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505

```json
ERROR: Command failed: npx lighthouse "http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505" --output=json --quiet --chrome-flags="--headless"
Runtime error encountered: EPERM, Permission denied: \\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.44031227 '\\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.44031227'
Error: EPERM, Permission denied: \\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.44031227 '\\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.44031227'
    at rmSync (node:fs:1236:18)
    at Launcher.destroyTmp (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:367:9)
    at Launcher.kill (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:349:14)
    at Object.kill (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:39:18)
    at runLighthouse (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/run.js:217:21)
    at async file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/index.js:10:1

```
### http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505/memories/607e7578-98e1-4504-b9e0-c07228e4e20b

```json
ERROR: Command failed: npx lighthouse "http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505/memories/607e7578-98e1-4504-b9e0-c07228e4e20b" --output=json --quiet --chrome-flags="--headless"
Runtime error encountered: EPERM, Permission denied: \\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.59022495 '\\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.59022495'
Error: EPERM, Permission denied: \\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.59022495 '\\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.59022495'
    at rmSync (node:fs:1236:18)
    at Launcher.destroyTmp (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:367:9)
    at Launcher.kill (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:349:14)
    at Object.kill (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:39:18)
    at runLighthouse (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/run.js:217:21)
    at async file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/index.js:10:1

```
### http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505/stats

```json
ERROR: Command failed: npx lighthouse "http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505/stats" --output=json --quiet --chrome-flags="--headless"
Runtime error encountered: EPERM, Permission denied: \\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.39911307 '\\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.39911307'
Error: EPERM, Permission denied: \\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.39911307 '\\?\C:\Users\faraz\AppData\Local\Temp\lighthouse.39911307'
    at rmSync (node:fs:1236:18)
    at Launcher.destroyTmp (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:367:9)
    at Launcher.kill (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:349:14)
    at Object.kill (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/chrome-launcher/dist/chrome-launcher.js:39:18)
    at runLighthouse (file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/run.js:217:21)
    at async file:///C:/Users/faraz/AppData/Local/npm-cache/_npx/0f94ee7615faf582/node_modules/lighthouse/cli/index.js:10:1

```

## 2. Bundle Size Analysis

```markdown
### Files in dist/ (sorted by size)

| Size | Path |
|------|------|
| 596.1 KB | assets\index-zELzPzU9.js |
|  29.9 KB | assets\index-fqqvtgvT.css |
|   9.3 KB | favicon.svg |
|   4.9 KB | icons.svg |
|   4.2 KB | favicon.ico |
|    454 B | index.html |

### Total by extension

| Extension | Total Size |
|-----------|------------|
| .js | 596.1 KB |
| .css | 29.9 KB |
| .svg | 14.2 KB |
| .ico | 4.2 KB |
| .html | 454 B |

**Grand total: 644.8 KB (6 files)**

```

## 3. Bundle Visualizer

## 4. Network Metrics (Manual)
Record HAR files in Chrome DevTools for:
- Cold load SpaceDetailPage with 50+ memories (http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505)
- MemoryDetailPage with 10+ media items (http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505/memories/607e7578-98e1-4504-b9e0-c07228e4e20b)
- SpaceStatsPage (http://localhost:5173/spaces/5f91c881-82e0-4849-9c6e-9b67e5d23505/stats)

Paste key metrics here manually.

## 5. Database Query Baselines

```sql
ERROR: Command failed: npx supabase db shell -c "
    SELECT query, calls, total_exec_time, mean_exec_time, rows
    FROM pg_stat_statements
    WHERE query LIKE '%memories%' OR query LIKE '%media%' OR query LIKE '%reactions%'
    ORDER BY total_exec_time DESC
    LIMIT 20;
  "
npm warn exec The following package was not found and will be installed: supabase@2.111.0
DESCRIPTION
  Manage Postgres databases.

USAGE
  supabase db <subcommand> [flags]

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --completions <bash|zsh|fish|sh>                                    Print shell completion script (choices: bash, zsh, fish, sh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)
  --output-format choice                                              Output format: text (default), json, or stream-json (NDJSON) (choices: text, json, stream-json)
  --output, -o choice                                                 Output format of status variables. (choices: env, pretty, json, toml, yaml, table, csv)
  --profile string                                                    Use a specific profile for connecting to Supabase API.
  --debug                                                             Output debug logs to stderr.
  --workdir string                                                    Path to a Supabase project directory.
  --experimental                                                      Enable experimental features.
  --network-id string                                                 Use the specified Docker network instead of a generated one.
  --yes                                                               Answer yes to all prompts.
  --dns-resolver choice                                               Look up domain names using the specified resolver. (choices: native, https)
  --create-ticket                                                     Create a support ticket for any CLI error.
  --agent choice                                                      Override agent detection: yes, no, or auto (default auto). (choices: auto, yes, no)

SUBCOMMANDS
  diff        Diffs the local database for schema changes
  dump        Dumps data or schemas from the remote database
  push        Push new migrations to the remote database
  pull        Pull schema from the remote database
  reset       Resets the local database to current migrations
  lint        Checks local database for typing error
  start       Starts local Postgres database
  query       Execute a SQL query against the database
  advisors    Checks database for security and performance issues
  schema      Manage database schema
[31mUnknown subcommand "shell" for "supabase db"

Unrecognized flag: -c in command supabase db[39m
Try rerunning the command with --debug to troubleshoot the error.

```
