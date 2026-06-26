<p align="center">
  <h1 align="center">Flixpatrol Top 10 on Trakt</h1>
</p>

<p align="center">
  Scrape today's top 10 from FlixPatrol and sync them to Trakt.tv lists.<br/>
  Supports 72+ streaming platforms, 200+ countries, and is compatible with <a href="https://kometa.wiki/">Kometa</a>.
</p>

<p align="center">
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/flixpatrol-top10-on-trakt/release.yml?label=Build%20(main)&style=flat-square" alt="Build (main)"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/actions/workflows/develop.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/flixpatrol-top10-on-trakt/develop.yml?label=Build%20(develop)&style=flat-square" alt="Build (develop)"></a>
</p>

<p align="center">
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/pkgs/container/flixpatrol-top10-on-trakt"><img src="https://img.shields.io/badge/Docker-blue?style=flat-square&logo=docker&logoColor=black" alt="Docker"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/releases"><img src="https://img.shields.io/badge/Windows-blue?style=flat-square&logo=windows&logoColor=black" alt="Windows"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/releases"><img src="https://img.shields.io/badge/Linux-blue?style=flat-square&logo=linux&logoColor=black" alt="Linux"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/releases"><img src="https://img.shields.io/badge/macOS-blue?style=flat-square&logo=apple&logoColor=black" alt="macOS"></a>
  <a href="https://discord.gg/XgCBF3sMSh"><img src="https://img.shields.io/discord/1483405134003175607?style=flat-square&logo=discord&label=Discord" alt="Discord"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/stargazers"><img src="https://img.shields.io/github/stars/navino16/flixpatrol-top10-on-trakt?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/LICENSE"><img src="https://img.shields.io/github/license/navino16/flixpatrol-top10-on-trakt?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/downloads/navino16/flixpatrol-top10-on-trakt/total?style=flat-square" alt="Downloads">
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/releases"><img src="https://img.shields.io/github/v/release/navino16/flixpatrol-top10-on-trakt?style=flat-square" alt="Release"></a>
  <a href="https://github.com/navino16/flixpatrol-top10-on-trakt/tree/develop"><img src="https://img.shields.io/github/commits-since/navino16/flixpatrol-top10-on-trakt/latest/develop?label=Commits%20in%20Develop&style=flat-square" alt="Commits in Develop"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/issues"><img src="https://img.shields.io/github/issues/navino16/flixpatrol-top10-on-trakt?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10-on-trakt/pulls"><img src="https://img.shields.io/github/issues-pr/navino16/flixpatrol-top10-on-trakt?style=flat-square" alt="Pull Requests"></a>
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#supported-platforms">Supported Platforms</a> &bull;
  <a href="#scheduling">Scheduling</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a> &bull;
  <a href="#development">Development</a>
</p>

---

> **Warning**
> Running at your own risk of being IP banned from FlixPatrol.
>
> Due to FlixPatrol limitations, titles are matched on Trakt by name and release year. This may occasionally cause bad matching.

## Features

- Sync **Top 10 lists** from 72 streaming platforms (Netflix, Disney+, HBO Max, Amazon Prime, etc.)
- Sync **Top 10 Kids lists** from Netflix (country-specific)
- Sync **Popular lists** from 2 sources (Wikipedia and Youtube)
- Sync **Netflix Most Watched** annual rankings
- Sync **Netflix Most Hours** rankings (total, first week, first month)
- Support for **200+ countries/regions**
- Intelligent **caching** to reduce API calls (7-day TTL by default)
- Automatic Trakt list management (create, update, sync)
- **Dry-run mode** for safe testing
- Compatible with [Kometa](https://kometa.wiki/) (formerly Plex Meta Manager)

## Getting Started

### Docker

```bash
docker run --rm -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
```

Edit `./config/default.json`, then schedule periodic runs with cron.

### Linux / macOS

1. Download the [latest release](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases/latest) for your platform
2. Make the binary executable and run it:
    ```bash
    chmod +x flixpatrol-top10-linux-x64
    ./flixpatrol-top10-linux-x64
    ```
3. Edit `./config/default.json` and run again

### Windows

1. Download the [latest release](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases/latest) for Windows
2. Run the binary from the command line (double-clicking will close the window automatically)
3. Edit `./config/default.json` and run again

## Configuration

### Environment Variables

| Name             | Description                                                  | Values                          | Default |
|------------------|--------------------------------------------------------------|---------------------------------|---------|
| LOG_LEVEL        | How verbose the log will be                                  | error, warn, info, debug, silly | info    |
| DRY_RUN          | Run without making changes to Trakt                          | true, false                     | false   |
| LIST_NAME_PREFIX | String prepended to every list name (useful for dev/testing) | Any string, e.g. `[TEST]`       | (none)  |

#### Dry-Run Mode

Run the tool without modifying Trakt lists. Useful for testing your configuration:

```bash
# Linux/macOS
DRY_RUN=true ./flixpatrol-top10-linux-x64

# Docker
docker run --rm -e DRY_RUN=true -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
```

In dry-run mode:
- FlixPatrol scraping runs normally
- Trakt search for ID conversion runs normally
- OAuth authentication runs normally
- List creation, item addition/removal, and updates are **logged but not executed**

#### List Name Prefix

Prepend a fixed string to every list name. Useful when running the tool against your real Trakt account during development or testing — the prefixed lists stay separate from your real lists and can be deleted in bulk afterwards.

```bash
# Linux/macOS — produces lists like "[TEST]netflix-world-top10-without-fallback"
LIST_NAME_PREFIX='[TEST]' ./flixpatrol-top10-linux-x64

# Docker
docker run --rm -e LIST_NAME_PREFIX='[TEST]' -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
```

The prefix is applied verbatim, **after** the normalization step (so brackets, spaces, and special characters in the prefix are preserved as-is). When active, a warning is emitted at startup so you don't forget it is set.

#### Notifications

Send a notification at the start of a run, at the end (with a summary), and on terminal errors. The block is optional — omit it entirely to disable notifications.

```json
{
  "Notifications": {
    "run_start": [
      { "type": "webhook", "url": "https://discord.com/api/webhooks/..." }
    ],
    "run_end": [
      { "type": "webhook", "url": "https://discord.com/api/webhooks/..." },
      { "type": "apprise", "url": "http://apprise:8000", "key": "flixpatrol" }
    ],
    "error": [
      { "type": "gotify", "url": "https://gotify.example.com", "token": "AbCdEf123" },
      { "type": "ntfy", "url": "https://ntfy.sh", "topic": "flixpatrol-alerts" }
    ]
  }
}
```

Each event takes a list of destinations. A destination has a `type` and the fields required by that type:

| Type      | Fields                | Notes                                                                                |
|-----------|-----------------------|--------------------------------------------------------------------------------------|
| `webhook` | `url`                 | Sends generic JSON. If `url` matches `discord.com/api/webhooks/...` a Discord-shaped payload is sent automatically. |
| `gotify`  | `url`, `token`        | POSTs to `{url}/message` with the token sent via the `X-Gotify-Key` header (never in the query string, so it cannot leak into reverse-proxy access logs). |
| `ntfy`    | `url`, `topic`        | POSTs JSON to `{url}` with the topic in the body. Use `https://ntfy.sh` for the public service. |
| `apprise` | `url`, `key`          | POSTs to `{url}/notify/{key}` against an Apprise API sidecar (see below).            |

Notifications are best-effort: a failing destination is logged at `warn` level but never blocks the main sync. Each adapter has a 5-second HTTP timeout and the manager caps total wait at 6 seconds. Failure logs include the adapter name and the destination's host (e.g. `WebhookAdapter[discord.com]: HTTP 401`) — never the full URL or any path / query secrets, so webhook tokens (Discord bearer tokens in the path, Apprise routing keys, etc.) cannot leak into log files or container stdout.

Every `url` field is validated as a full URL with scheme at config-load time — typos like `discord.com/...` (missing `https://`) are rejected at startup with a clear error rather than silently failing at runtime.

`DRY_RUN=true` does **not** suppress notifications (useful for testing the setup). Title and body are both prefixed with `[DRY-RUN]` so they cannot be mistaken for a real run, and the `run_end` body says items "would be added" rather than "added".

##### Apprise sidecar (optional)

The `apprise` destination talks to an [Apprise API](https://github.com/caronc/apprise-api) instance you host yourself. Once it is running, you configure your downstream services (Discord, Telegram, Email, etc.) inside Apprise — flixpatrol-top10 only needs to know the Apprise URL and a config key.

```yaml
# docker-compose.yml excerpt
services:
  flixpatrol:
    image: ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
    volumes:
      - ./config:/app/config
    depends_on:
      - apprise

  apprise:
    image: caronc/apprise:latest
    ports:
      - "8000:8000"
    volumes:
      - ./apprise-config:/config
```

In the Apprise web UI (default `http://localhost:8000`), create a configuration key (for example `flixpatrol`) and add your downstream Apprise URLs (`discord://...`, `tgram://...`, `mailto://...`, etc.) under that key. Then reference it from `config/default.json`:

```json
{ "type": "apprise", "url": "http://apprise:8000", "key": "flixpatrol" }
```

### Configuration File

The configuration file is stored at `./config/default.json` (auto-generated on first run).

If there is any configuration error, the tool will exit with information about the error.

<details>
<summary><strong>FlixPatrolTop10</strong> — Top 10 list configuration</summary>

| Name            | Description                                                                                | Mandatory | Values                                                                                                                                          | Default                                    |
|-----------------|--------------------------------------------------------------------------------------------|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|
| platform        | Which platform to get from Flixpatrol                                                      | Yes       | Any Flixpatrol platform ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L48))          |                                            |
| location        | Which location to get from Flixpatrol                                                      | Yes       | Any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L22))          |                                            |
| fallback        | Fallback to another location if no results?                                                | Yes       | False or any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L22)) | false                                      |
| privacy         | The privacy of the generated Trakt list                                                    | Yes       | private, link, friends, public                                                                                                                  | private                                    |
| limit           | How many movie/show to get                                                                 | Yes       | Number >= 1                                                                                                                                     | 10                                         |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both                                                                                                                             | both                                       |
| name            | Optional custom list name                                                                  | No        | Any valid string                                                                                                                                | A generated name based on the top10 config |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                                                                                                                                     | true                                       |
| kids            | Get Kids Top 10 (Netflix only, requires specific country)                                  | No        | true, false                                                                                                                                     | false                                      |

</details>

<details>
<summary><strong>FlixPatrolPopular</strong> — Popular list configuration</summary>

| Name            | Description                                                                                | Mandatory | Values                                                                                                                                         | Default                                      |
|-----------------|--------------------------------------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| platform        | Which popular source to get from Flixpatrol                                                | Yes       | Any Flixpatrol popular platform ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L53)) |                                              |
| privacy         | The privacy of the generated Trakt list                                                    | Yes       | private, link, friends, public                                                                                                                 | private                                      |
| limit           | How many movie/show to get                                                                 | Yes       | Number between 1 and 100                                                                                                                       | 100                                          |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both                                                                                                                            | both                                         |
| name            | Optional custom list name                                                                  | No        | Any valid string                                                                                                                               | A generated name based on the popular config |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                                                                                                                                    | true                                         |

</details>

<details>
<summary><strong>FlixPatrolMostWatched</strong> — Netflix Most Watched configuration</summary>

| Name            | Description                                                                                | Mandatory | Values                                                                                                                                 | Default      |
|-----------------|--------------------------------------------------------------------------------------------|-----------|----------------------------------------------------------------------------------------------------------------------------------------|--------------|
| enabled         | Enable this most watched list?                                                             | Yes       | true, false                                                                                                                            | true         |
| privacy         | The privacy of the generated Trakt list                                                    | Yes       | private, link, friends, public                                                                                                         | private      |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both                                                                                                                    | both         |
| limit           | How many movie/show to get                                                                 | Yes       | Number between 1 and 50                                                                                                                | 50           |
| year            | Year of the most watched list                                                              | Yes       | Number between 2023 and current year                                                                                                   | current year |
| name            | Optional custom list name                                                                  | No        | Any valid string                                                                                                                       | most-watched |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                                                                                                                            | true         |
| premiere        | Filter by premiere year                                                                    | No        | Year between 1980 and current year                                                                                                     | All          |
| country         | Filter by release country                                                                  | No        | Any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L22)) | All          |
| original        | Netflix originals only?                                                                    | No        | true, false                                                                                                                            | false        |
| orderByViews    | Order by views instead of hours?                                                           | No        | true, false                                                                                                                            | false        |

</details>

<details>
<summary><strong>FlixPatrolMostHours</strong> — Netflix Most Hours configuration</summary>

| Name            | Description                                                                                | Mandatory | Values                          | Default                     |
|-----------------|--------------------------------------------------------------------------------------------|-----------|---------------------------------|-----------------------------|
| enabled         | Enable this most hours list?                                                               | Yes       | true, false                     | true                        |
| privacy         | The privacy of the generated Trakt list                                                    | Yes       | private, link, friends, public  | private                     |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both             | both                        |
| limit           | How many movie/show to get                                                                 | Yes       | Number between 1 and 100        | 50                          |
| period          | Which ranking period                                                                       | Yes       | total, first-week, first-month  | total                       |
| language        | Filter by language (first-week and first-month only)                                       | No        | all, english, non-english       | all                         |
| name            | Optional custom list name                                                                  | No        | Any valid string                | netflix-most-hours-{period} |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                     | true                        |

</details>

<details>
<summary><strong>Trakt & Cache</strong> — Authentication and caching</summary>

| Name              | Description                                                                                          | Mandatory | Values         | Default          |
|-------------------|------------------------------------------------------------------------------------------------------|-----------|----------------|------------------|
| Trakt.saveFile    | Where to save the Trakt session file                                                                 | Yes       | Any valid path | ./config/.trakt  |
| Trakt.clientId    | Your clientId from Trakt ([get one here](https://trakt.tv/oauth/applications/new))                   | Yes       | A valid string |                  |
| Trakt.clientSecret| Your clientSecret from Trakt ([get one here](https://trakt.tv/oauth/applications/new))               | Yes       | A valid string |                  |
| Cache.enabled     | Enable caching? (recommended)                                                                        | Yes       | true, false    | true             |
| Cache.savePath    | Where to save the cache files                                                                        | Yes       | Any valid path | ./config/.cache  |
| Cache.ttl         | Cache validity duration in seconds                                                                   | Yes       | Number > 0     | 604800 (7 days)  |

</details>

<details>
<summary><strong>Example configuration</strong></summary>

```json
{
  "FlixPatrolTop10": [
    {
      "platform": "netflix",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Netflix Top 10 Movies",
      "type": "movies"
    },
    {
      "platform": "disney",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Disney Plus Top 10 Shows",
      "type": "shows"
    },
    {
      "platform": "amazon-prime",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Amazon Prime Top 10",
      "type": "both"
    },
    {
      "platform": "netflix",
      "location": "united-states",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Netflix Top 10 Kids",
      "type": "both",
      "kids": true
    }
  ],
  "FlixPatrolPopular": [
    {
      "platform": "wikipedia",
      "privacy": "private",
      "limit": 100,
      "type": "both"
    }
  ],
  "FlixPatrolMostWatched": [
    {
      "enabled": true,
      "privacy": "public",
      "year": 2023,
      "limit": 50,
      "type": "both"
    }
  ],
  "FlixPatrolMostHours": [
    {
      "enabled": true,
      "privacy": "public",
      "limit": 50,
      "type": "both",
      "period": "total"
    },
    {
      "enabled": true,
      "privacy": "public",
      "limit": 50,
      "type": "both",
      "period": "first-week"
    },
    {
      "enabled": true,
      "privacy": "public",
      "limit": 50,
      "type": "movies",
      "period": "first-month",
      "language": "english"
    }
  ],
  "Trakt": {
    "saveFile": "./config/.trakt",
    "clientId": "You need to replace this client ID",
    "clientSecret": "You need to replace this client secret"
  },
  "Cache": {
    "enabled": true,
    "savePath": "./config/.cache",
    "ttl": 604800
  }
}
```

</details>

### Trakt Setup

To run this application you need a Trakt account and a Client ID / Client Secret.

> **Warning**
> Trakt free accounts are limited to 5 lists. If you configure more, the tool will fail. Remove some or upgrade to Trakt VIP.

1. [Create an account](https://trakt.tv/auth/join) or [login](https://trakt.tv/login)
2. [Create a new application](https://trakt.tv/oauth/applications/new) with:
   - **Redirect uri:** `urn:ietf:wg:oauth:2.0:oob`
   - Other fields are optional
3. Set the Client ID / Client Secret in `./config/default.json`
4. Run the app and follow the on-screen instructions

## Supported Platforms

### Top 10 Platforms (72)

`9now`, `abema`, `amazon`, `amazon-channels`, `amazon-prime`, `amc-plus`, `antenna-tv`, `apple-tv`, `bbc`, `canal`, `catchplay`, `cda`, `chili`, `claro-video`, `coupang-play`, `crunchyroll`, `discovery-plus`, `disney`, `francetv`, `friday`, `globoplay`, `go3`, `google`, `hami-video`, `hayu`, `hbo-max`, `hrti`, `hulu`, `hulu-nippon`, `itunes`, `jiocinema`, `jiohotstar`, `joyn`, `lemino`, `m6plus`, `mgm-plus`, `myvideo`, `neon-tv`, `netflix`, `now`, `oneplay`, `osn`, `paramount-plus`, `peacock`, `player`, `pluto-tv`, `raiplay`, `rakuten-tv`, `rtl-plus`, `sbs`, `shahid`, `skyshowtime`, `stan`, `starz`, `streamz`, `telasa`, `tf1`, `tod`, `trueid`, `tubi`, `tv-2-norge`, `u-next`, `viaplay`, `videoland`, `vidio`, `viki`, `viu`, `vix`, `voyo`, `vudu`, `watchit`, `wavve`, `wow`, `zee5`

### Popular Sources (12)

`wikipedia`, `youtube`

### Locations (199)

`world`, `united-states`, `france`, `united-kingdom`, `germany`, `canada`, `australia`, `japan`, and 191 more countries...

For the complete list, see the source code: [Config.types.ts](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/types/Config.types.ts)

## Scheduling

### Linux (cron)

```bash
# Run daily at 6 AM
0 6 * * * /path/to/flixpatrol-top10-linux-x64

# Run every 12 hours
0 */12 * * * /path/to/flixpatrol-top10-linux-x64
```

### Docker with cron

```bash
# Run daily at 6 AM
0 6 * * * docker run --rm -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
```

### Windows Task Scheduler

1. Open Task Scheduler
2. Create a new task
3. Set the trigger (e.g., daily at 6 AM)
4. Set the action to run the executable

## Troubleshooting

| Problem                 | Solution                                                                                 |
|-------------------------|------------------------------------------------------------------------------------------|
| "Rate limit exceeded"   | Increase time between runs. The cache helps reduce API calls.                            |
| "List limit reached"    | Trakt free accounts are limited to 5 lists. Upgrade to VIP or reduce configured lists.   |
| "No items found"        | Verify the platform/location combination exists on [FlixPatrol](https://flixpatrol.com). |
| "Bad matching"          | This is a FlixPatrol/Trakt limitation. Titles are matched by name and year.              |
| "Authentication failed" | Delete `./config/.trakt` and re-authenticate.                                            |
| "Permission denied" on config folder (Docker) | The Docker image runs as a non-root user (`flixpatrol`, UID 1000). Fix permissions with: `sudo chown -R 1000:1000 /path/to/config` |

## Development

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run start:dev

# Build
npm run build

# Run after build
npm run start

# Lint
npm run lint

# Lint and auto-fix
npm run lint-and-fix

# Create cross-platform binaries
npm run package
```

## License

[MIT License](LICENSE)
