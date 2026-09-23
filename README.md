<p align="center">
  <h1 align="center">FlixPatrol Top 10</h1>
</p>

<p align="center">
  Scrape today's top 10 from FlixPatrol and sync them to Floppy and mdblist lists.<br/>
  Supports 74 streaming platforms, 199 countries/regions, and is compatible with <a href="https://kometa.wiki/">Kometa</a>.
</p>

<p align="center">
  <a href="https://github.com/Navino16/flixpatrol-top10/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/flixpatrol-top10/ci.yml?label=CI&style=flat-square" alt="CI"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/flixpatrol-top10/release.yml?branch=develop&label=Docker%20Image&style=flat-square" alt="Docker Image"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/actions/workflows/flixpatrol-drift.yml"><img src="https://img.shields.io/github/actions/workflow/status/Navino16/flixpatrol-top10/flixpatrol-drift.yml?label=FlixPatrol%20markup&style=flat-square" alt="FlixPatrol markup"></a>
</p>

<p align="center">
  <a href="https://github.com/Navino16/flixpatrol-top10/pkgs/container/flixpatrol-top10"><img src="https://img.shields.io/badge/Docker-blue?style=flat-square&logo=docker&logoColor=black" alt="Docker"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/releases"><img src="https://img.shields.io/badge/Windows-blue?style=flat-square&logo=windows&logoColor=black" alt="Windows"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/releases"><img src="https://img.shields.io/badge/Linux-blue?style=flat-square&logo=linux&logoColor=black" alt="Linux"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/releases"><img src="https://img.shields.io/badge/macOS-blue?style=flat-square&logo=apple&logoColor=black" alt="macOS"></a>
  <a href="https://discord.gg/XgCBF3sMSh"><img src="https://img.shields.io/discord/1483405134003175607?style=flat-square&logo=discord&label=Discord" alt="Discord"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/stargazers"><img src="https://img.shields.io/github/stars/navino16/flixpatrol-top10?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/blob/main/LICENSE"><img src="https://img.shields.io/github/license/navino16/flixpatrol-top10?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/downloads/navino16/flixpatrol-top10/total?style=flat-square" alt="Downloads">
  <a href="https://github.com/Navino16/flixpatrol-top10/releases"><img src="https://img.shields.io/github/v/release/navino16/flixpatrol-top10?style=flat-square" alt="Release"></a>
  <a href="https://github.com/navino16/flixpatrol-top10/tree/develop"><img src="https://img.shields.io/github/commits-since/navino16/flixpatrol-top10/latest/develop?label=Commits%20in%20Develop&style=flat-square" alt="Commits in Develop"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/issues"><img src="https://img.shields.io/github/issues/navino16/flixpatrol-top10?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/Navino16/flixpatrol-top10/pulls"><img src="https://img.shields.io/github/issues-pr/navino16/flixpatrol-top10?style=flat-square" alt="Pull Requests"></a>
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#choosing-your-platform">Choosing Your Platform</a> &bull;
  <a href="#migrating-to-400">Migrating to 4.0.0</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#supported-platforms">Supported Platforms</a> &bull;
  <a href="#scheduling">Scheduling</a> &bull;
  <a href="#daemon-mode-built-in-scheduling">Daemon Mode</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a> &bull;
  <a href="#development">Development</a>
</p>

---

> **Warning**
> Running at your own risk of being IP banned from FlixPatrol.
>
> Due to FlixPatrol limitations, titles are matched on the target backend by name and release year. This may occasionally cause bad matching.
>
> When a FlixPatrol detail page exposes no usable premiere date, the year is reported as unknown
> and the match falls back to the title alone. That is deliberate: a missing year degrades the
> match, whereas a guessed one would silently select the wrong title.

## Features

- Sync **Top 10 lists** from 74 streaming platforms (Netflix, Disney+, HBO Max, Amazon Prime, etc.)
- Sync **Top 10 Kids lists** from Netflix (country-specific)
- Sync **Popular lists** from 2 sources (Wikipedia and Youtube)
- Sync **Netflix Most Watched** annual rankings
- Sync **Netflix Most Hours** rankings (total, first week, first month)
- Support for **199 countries/regions**
- Two-level **caching** to reduce scraping and API calls (7-day TTL by default)
- Automatic list management (create, update, sync) on **Floppy** and **mdblist**
- Write every list to **several targets** in one run — mix backends, or use two accounts of the same one
- **Dry-run mode** for safe testing
- Compatible with [Kometa](https://kometa.wiki/) (formerly Plex Meta Manager)

## Getting Started

The first run writes a template `./config/default.json` and exits. Get that far with your platform
below, then follow the [next steps](#next-steps-all-platforms) — they are the same for all three.

### Docker

```bash
docker run --rm -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10:latest
```

> **Note**
> The image was renamed to `ghcr.io/navino16/flixpatrol-top10` in 4.0.0. The old
> `flixpatrol-top10-on-trakt` image is still published for now, but will stop receiving
> updates — point your compose file at the new name.

### Linux / macOS

1. Download the [latest release](https://github.com/Navino16/flixpatrol-top10/releases/latest) for your platform
2. Make the binary executable and run it:
    ```bash
    chmod +x flixpatrol-top10-linux-x64
    ./flixpatrol-top10-linux-x64
    ```

### Windows

1. Download the [latest release](https://github.com/Navino16/flixpatrol-top10/releases/latest) for Windows
2. Run the binary from the command line (double-clicking will close the window automatically)

### Next steps (all platforms)

1. **Choose where your lists are written and fill in the `Targets` array** in
   `./config/default.json`. `Targets` is **mandatory**: each entry names one backend and carries
   its credentials — the app refuses to start while an entry still holds the template
   placeholder. See [Choosing Your Platform](#choosing-your-platform) to pick between Floppy and
   mdblist, then [Floppy Setup](#floppy-setup) or [mdblist Setup](#mdblist-setup) to obtain the
   credentials.
2. Edit the list blocks (`FlixPatrolTop10`, `FlixPatrolPopular`, …) to the lists you actually
   want — see [Configuration](#configuration).
3. Run again. Then schedule periodic runs, either with an
   [external scheduler](#scheduling) or with the built-in
   [daemon mode](#daemon-mode-built-in-scheduling).

## Choosing Your Platform

The lists this tool builds can be written to two backends, Floppy and mdblist — or to several at
once. Each entry of the `Targets` array names one backend and carries its credentials; everything
else in the configuration stays the same.

> **Warning**
> 4.0.0 removes Trakt and replaces the singular `Target` block with the `Targets` array. See
> [Migrating to 4.0.0](#migrating-to-400) — the app detects every older format at startup and
> prints the block to write.

|                    | mdblist free             | mdblist 1–3 €/month | Floppy                                |
|--------------------|--------------------------|---------------------|---------------------------------------|
| Lists              | 4 static                 | 20 to 80            | unlimited                             |
| Items per list     | 10 000                   | 30 000+             | unlimited                             |
| Hosting            | none                     | none                | you provide it                        |
| Authentication     | API key                  | API key             | API key                               |
| `privacy` honoured | yes                      | yes                 | ignored, set it by hand in the web UI |
| Update date        | native `last_updated_at` | same                | native `latest_update`                |

### Targets

`Targets` is an array of at least one entry. Every list is scraped from FlixPatrol once, then
written to each target in turn, in array order:

```json
{
  "Targets": [
    {
      "id": "home",
      "type": "floppy",
      "url": "http://localhost:8000",
      "apiKey": "your-floppy-token"
    },
    {
      "id": "main",
      "type": "mdblist",
      "apiKey": "your-mdblist-api-key"
    },
    {
      "id": "family",
      "type": "mdblist",
      "apiKey": "your-other-mdblist-api-key"
    }
  ]
}
```

- **`id` is mandatory and unique** across the array: 1 to 32 characters, lowercase letters,
  digits, `-` and `_`, starting with a letter or a digit (`^[a-z0-9][a-z0-9_-]*$`). It names the
  target in the logs and in the `run_end` summary.
- **The same `type` may appear several times** — two mdblist accounts, or two Floppy instances,
  as above.
- **The `id` namespaces the target's resolution cache** (`<Cache.savePath>/resolution-<type>-<id>/`),
  so two entries never share identifiers. Renaming an `id` therefore starts that target from an
  empty cache: the next run costs one backend search per title on it. The lists themselves are
  found by name, so nothing else is lost.
- **A failing target does not stop the others.** A target that fails — unreachable, rejected API
  key, rate limit — is dropped from the rest of the run while the others carry on writing. The
  `run_end` notification reports each target's outcome, an `error` notification is sent only when
  every target was dropped, and a one-shot run exits 1. In daemon mode the dropped target is
  retried on the next tick. A FlixPatrol failure, on the other hand, stops the run for every
  target.

### Floppy

```json
{
  "Targets": [
    {
      "id": "main",
      "type": "floppy",
      "url": "http://localhost:8000",
      "apiKey": "your-floppy-token"
    }
  ]
}
```

### mdblist

```json
{
  "Targets": [
    {
      "id": "main",
      "type": "mdblist",
      "apiKey": "your-mdblist-api-key"
    }
  ]
}
```

### Privacy levels per backend

`privacy` on a list entry takes `private` or `public`. mdblist honours both. Floppy cannot: its
API exposes no way to set a list's visibility, so every list is created private and a warning
says so once per Floppy target at startup. With a Floppy and an mdblist target, a `public` entry
is therefore public on mdblist and private on Floppy.

## Migrating to 4.0.0

4.0.0 removes Trakt and turns the singular `Target` block into a mandatory `Targets` array. The
app detects every older shape at startup — a 2.x root-level `Trakt` block, a 3.x `Target`, a
`Targets` written as a single object, a `trakt` entry inside `Targets` — prints the block to
write, and exits without touching your file: the config directory is frequently a read-only
mount, and the file is usually version-controlled, so nothing is rewritten on your behalf.

The printed block never carries your credentials, since the message is also sent to every
`error` notification destination: your values appear as placeholders such as
`<keep your current apiKey>` or `<keep your current url>`. Copy the structure, then put your own
values back in.

### From 3.x on Floppy or mdblist

Wrap your `Target` block in `"Targets": [ … ]` and add an `id`:

```jsonc
// before (3.x)
"Target": {
  "type": "mdblist",
  "apiKey": "your-mdblist-api-key"
}

// after (4.0.0)
"Targets": [
  {
    "id": "main",
    "type": "mdblist",
    "apiKey": "your-mdblist-api-key"
  }
]
```

Floppy is the same, with `url` next to `apiKey`. Any `id` that follows the
[rules above](#targets) works; the startup message suggests `main`. Leaving the old `Target`
block behind is harmless: once `Targets` is valid the app starts normally and only logs a
warning naming it.

Expect the first run to re-resolve every title — see the cache point
[below](#other-breaking-changes).

### From Trakt

Trakt support is removed, whether it was configured by a 2.x root-level `Trakt` block or by a
3.x `Target` with `"type": "trakt"`. Trakt has closed its API to third-party services — MDBList,
SIMKL and WeTrakr were all blocked without notice — and repeatedly broke authentication for
integrations like this one.

Pick [Floppy](#floppy-setup) or [mdblist](#mdblist-setup) and write a `Targets` entry for it;
the startup message prints both shapes to choose from. Your lists are rebuilt from FlixPatrol on
the first run, so there is nothing to carry over. The token file `./config/.trakt` is no longer
read and can be deleted, and a leftover root-level `Trakt` block only produces a warning once
`Targets` is valid.

### Other breaking changes

- **`link` and `friends` are removed.** They were Trakt-only privacy levels: `privacy` now takes
  `private` or `public`, and any other value fails validation at startup.
- **The `run_end` summary changed shape.** Its top-level `listsProcessed`, `moviesAdded` and
  `showsAdded` are replaced by a `targets` array with one entry per target — see
  [Notifications](#notifications). Anything parsing the webhook payload must be updated. The
  message body of every destination now reads one line per target too.
- **The first run re-resolves every title.** The resolution cache is now namespaced per target
  (`resolution-<backend>-<id>/` instead of `resolution-<backend>/`), so nothing cached by 3.x is
  reused: that run costs one backend search per title. On mdblist this consumes daily API
  quota; if it runs out, the `429` drops that target from the run and it is retried on the next
  run or tick — titles already resolved stay cached, so the retry picks up where it stopped. The
  old directories are named in a startup warning and never deleted: remove them whenever you
  like.
- **The Docker image is renamed** to `ghcr.io/navino16/flixpatrol-top10` — see the
  [note under Docker](#docker).

## Configuration

### Environment Variables

| Name             | Description                                                  | Values                          | Default |
|------------------|--------------------------------------------------------------|---------------------------------|---------|
| LOG_LEVEL        | How verbose the log will be                                  | error, warn, info, debug, silly | info    |
| DRY_RUN          | Run without making changes to the target backend             | true, false                     | false   |
| LIST_NAME_PREFIX | String prepended to every list name (useful for dev/testing) | Any string, e.g. `[TEST]`       | (none)  |

#### Dry-Run Mode

Run the tool without modifying any list on the configured backends. Useful for testing your configuration:

```bash
# Linux/macOS
DRY_RUN=true ./flixpatrol-top10-linux-x64

# Docker
docker run --rm -e DRY_RUN=true -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10:latest
```

In dry-run mode:
- FlixPatrol scraping runs normally
- The backend search that converts titles to identifiers runs normally, on every target — so a
  rejected API key still shows up
- List creation, item addition/removal, and updates are **logged but not executed**
- Notifications are **not** suppressed, so you can test that setup too — see [Notifications](#notifications)

#### List Name Prefix

Prepend a fixed string to every list name. Useful when running the tool against your real backend account during development or testing — the prefixed lists stay separate from your real lists and can be deleted in bulk afterwards.

```bash
# Linux/macOS — produces lists like "[TEST]netflix-world-top10-without-fallback"
LIST_NAME_PREFIX='[TEST]' ./flixpatrol-top10-linux-x64

# Docker
docker run --rm -e LIST_NAME_PREFIX='[TEST]' -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10:latest
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

`DRY_RUN=true` does **not** suppress notifications (useful for testing the setup). Title and body are both prefixed with `[DRY-RUN]` so they cannot be mistaken for a real run.

The `run_end` body has one line per target — lists written, movies and shows added, or why the target was aborted — then any dead FlixPatrol path and the run duration. A generic `webhook` also receives it as a `summary` object:

```json
{
  "event": "run_end",
  "title": "flixpatrol-top10 run finished",
  "body": "main (mdblist): 4 lists, 25 movies, 15 shows\nhome (floppy): aborted — FloppyError: ...\nDuration: 42s",
  "timestamp": "2026-09-23T06:00:42.000Z",
  "summary": {
    "targets": [
      { "id": "main", "backend": "mdblist", "status": "ok", "listsProcessed": 4, "moviesAdded": 25, "showsAdded": 15 },
      { "id": "home", "backend": "floppy", "status": "aborted", "listsProcessed": 0, "moviesAdded": 0, "showsAdded": 0, "error": "FloppyError: ..." }
    ],
    "durationMs": 42000,
    "deadPaths": []
  }
}
```

`error` is present only on an aborted target. When every target is aborted, an `error` event is dispatched as well, carrying the same `summary`.

##### Apprise sidecar (optional)

The `apprise` destination talks to an [Apprise API](https://github.com/caronc/apprise-api) instance you host yourself. Once it is running, you configure your downstream services (Discord, Telegram, Email, etc.) inside Apprise — flixpatrol-top10 only needs to know the Apprise URL and a config key.

```yaml
# docker-compose.yml excerpt
services:
  flixpatrol:
    image: ghcr.io/navino16/flixpatrol-top10:latest
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
| platform        | Which platform to get from Flixpatrol                                                      | Yes       | Any Flixpatrol platform ([see this](https://github.com/Navino16/flixpatrol-top10/blob/main/src/types/Config.types.ts))          |                                            |
| location        | Which location to get from Flixpatrol                                                      | Yes       | Any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10/blob/main/src/types/Config.types.ts))          |                                            |
| fallback        | Fallback to another location if no results?                                                | Yes       | False or any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10/blob/main/src/types/Config.types.ts)) | false                                      |
| privacy         | Privacy of the generated list ([backend support varies](#privacy-levels-per-backend))      | Yes       | private, public                                                                                                                                 | private                                    |
| limit           | How many movie/show to get                                                                 | Yes       | Number >= 1                                                                                                                                     | 10                                         |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both                                                                                                                             | both                                       |
| name            | Optional custom list name                                                                  | No        | Any valid string                                                                                                                                | A generated name based on the top10 config |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                                                                                                                                     | true                                       |
| kids            | Get Kids Top 10 (Netflix only, requires specific country)                                  | No        | true, false                                                                                                                                     | false                                      |

**Note on `fallback`:** The fallback is tried only when the configured location exists but has no rankings (empty chart). If the location does not exist for that platform (e.g. Hulu for Russia), the entry is skipped, the list stays unchanged, and the run reports a dead path — `fallback` cannot fix that, as it would silently fill the list with the wrong location's content.

</details>

<details>
<summary><strong>FlixPatrolPopular</strong> — Popular list configuration</summary>

| Name            | Description                                                                                | Mandatory | Values                                                                                                                                         | Default                                      |
|-----------------|--------------------------------------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| platform        | Which popular source to get from Flixpatrol                                                | Yes       | Any Flixpatrol popular platform ([see this](https://github.com/Navino16/flixpatrol-top10/blob/main/src/types/Config.types.ts)) |                                              |
| privacy         | Privacy of the generated list ([backend support varies](#privacy-levels-per-backend))      | Yes       | private, public                                                                                                                                | private                                      |
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
| privacy         | Privacy of the generated list ([backend support varies](#privacy-levels-per-backend))      | Yes       | private, public                                                                                                                        | private      |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both                                                                                                                    | both         |
| limit           | How many movie/show to get                                                                 | Yes       | Number between 1 and 50                                                                                                                | 50           |
| year            | Year of the most watched list                                                              | Yes       | Number between 2023 and current year                                                                                                   | current year |
| name            | Optional custom list name                                                                  | No        | Any valid string                                                                                                                       | most-watched |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                                                                                                                            | true         |
| premiere        | Filter by premiere year                                                                    | No        | Year between 1980 and current year                                                                                                     | All          |
| country         | Filter by release country                                                                  | No        | 93 values, see below                                                                                                                   | All          |
| original        | Netflix originals only?                                                                    | No        | true, false                                                                                                                            | false        |
| genre           | Filter by genre. 30 values, see below. Must exist for every requested type.                | No        | See below                                                                                                                              | All          |

**`genre`** — common to both types: `action`, `adventure`, `animation`, `biography`,
`comedy`, `crime`, `documentary`, `drama`, `family`, `fantasy`, `history`, `horror`,
`romance`, `science-fiction`, `superhero`, `thriller`, `war`, `western`.
Movies only: `concerts`, `fairy-tale`, `musical`, `record`, `sports`.
Shows only: `broadcast`, `game-show`, `music`, `news`, `reality-show`, `sport`,
`talk-show`.
With `type: "both"`, only the 18 common genres are accepted. Note `sports` for movies
and `sport` for shows: this is FlixPatrol's own spelling.

**`country`** — 93 values, copied from `flixpatrolMostWatchedCountry`. This is **not**
the same list as `FlixPatrolTop10` locations: `china`, `russia` and `monaco` for
example are not in it.

`argentina`, `australia`, `austria`, `bahamas`, `bahrain`, `bangladesh`, `belgium`, `bolivia`,
`brazil`, `bulgaria`, `canada`, `chile`, `colombia`, `costa-rica`, `croatia`, `cyprus`,
`czech-republic`, `denmark`, `dominican-republic`, `ecuador`, `egypt`, `estonia`, `finland`,
`france`, `germany`, `greece`, `guadeloupe`, `guatemala`, `honduras`, `hong-kong`, `hungary`,
`iceland`, `india`, `indonesia`, `ireland`, `israel`, `italy`, `jamaica`, `japan`, `jordan`,
`kenya`, `kuwait`, `latvia`, `lebanon`, `lithuania`, `luxembourg`, `malaysia`, `maldives`,
`malta`, `martinique`, `mauritius`, `mexico`, `morocco`, `netherlands`, `new-caledonia`,
`new-zealand`, `nicaragua`, `nigeria`, `norway`, `oman`, `pakistan`, `panama`, `paraguay`,
`peru`, `philippines`, `poland`, `portugal`, `qatar`, `reunion`, `romania`, `salvador`,
`saudi-arabia`, `serbia`, `singapore`, `slovakia`, `slovenia`, `south-africa`, `south-korea`,
`spain`, `sri-lanka`, `sweden`, `switzerland`, `taiwan`, `thailand`, `trinidad-and-tobago`,
`turkey`, `ukraine`, `united-arab-emirates`, `united-kingdom`, `united-states`, `uruguay`,
`venezuela`, `vietnam`.

Shows are always grouped by title, never listed season by season.

</details>

<details>
<summary><strong>FlixPatrolMostHours</strong> — Netflix Most Hours configuration</summary>

| Name            | Description                                                                                | Mandatory | Values                          | Default                     |
|-----------------|--------------------------------------------------------------------------------------------|-----------|---------------------------------|-----------------------------|
| enabled         | Enable this most hours list?                                                               | Yes       | true, false                     | true                        |
| privacy         | Privacy of the generated list ([backend support varies](#privacy-levels-per-backend))      | Yes       | private, public                 | private                     |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both             | both                        |
| limit           | How many movie/show to get                                                                 | Yes       | Number between 1 and 100        | 50                          |
| period          | Which ranking period                                                                       | Yes       | total, first-week, first-month  | total                       |
| language        | Filter by language (first-week and first-month only)                                       | No        | all, english, non-english       | all                         |
| name            | Optional custom list name                                                                  | No        | Any valid string                | netflix-most-hours-{period} |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                     | true                        |

</details>

<details>
<summary><strong>FlixPatrolWeekly</strong> — weekly /hours/ rankings (Netflix, Amazon Prime)</summary>

| Name            | Description                                                                                | Mandatory | Values                                                                     | Default   |
|-----------------|--------------------------------------------------------------------------------------------|-----------|----------------------------------------------------------------------------|-----------|
| enabled         | Enable this weekly list?                                                                   | Yes       | true, false                                                                | true      |
| privacy         | Privacy of the generated list ([backend support varies](#privacy-levels-per-backend))      | Yes       | private, public                                                            | private   |
| type            | Movies, shows or both?                                                                     | Yes       | movies, shows, both                                                        | both      |
| limit           | How many movie/show to get                                                                 | Yes       | Number between 1 and 20                                                    |           |
| platform        | Which platform's weekly chart                                                              | Yes       | netflix, amazon-prime                                                      |           |
| location        | Worldwide chart, or a per-country chart (Netflix only)                                     | No        | world, or one of the 93 countries listed under FlixPatrolMostWatched above | world     |
| language        | Filter the worldwide chart by language                                                     | No        | all, english, non-english                                                  | all       |
| name            | Optional custom list name                                                                  | No        | Any valid string                                                           | see below |
| normalizeName   | Normalize the list name to kebab-case?                                                     | No        | true, false                                                                | true      |

`limit` only reaches 20 with `language: "all"`: the worldwide chart then concatenates two
sections of 10 (English first). Every other combination — a specific language, or any
per-country `location` — tops out at 10, because that is all FlixPatrol publishes for a single
section.

A `location` other than `world` is **Netflix-only**: Amazon Prime publishes no per-country
weekly page. That pairing (`platform: "amazon-prime"` with a country) only warns at config
validation — the entry is skipped, never a hard error. Netflix's per-country page carries the
platform's own official ranking, which carries no language split: a `language` set there also
only warns, but the entry is **not** skipped — `language` is ignored and the list is still
produced.

Default list name: `{platform}-weekly-{language}` worldwide (the `-{language}` suffix is
dropped for `all`), `{platform}-weekly-{location}` for a country entry.

</details>

<details>
<summary><strong>Targets</strong> — Where the lists are written, and each backend's credentials</summary>

`Targets` is a mandatory array of at least one entry. Each entry is a discriminated union on
`type`: it carries the backend name **and** exactly the credentials that backend needs. Every
list is written to every entry — see [Targets](#targets).

| Name   | Description                                                                    | Mandatory           | Values                                                            | Default |
|--------|--------------------------------------------------------------------------------|---------------------|-------------------------------------------------------------------|---------|
| id     | Unique name of the target, used in logs, notifications and its cache directory | Yes                 | 1-32 chars: `a-z`, `0-9`, `-`, `_`, starting with a letter or digit |         |
| type   | Which backend receives the generated lists                                     | Yes                 | floppy, mdblist                                                   |         |
| url    | Base URL of your Floppy instance                                               | If `type: "floppy"` | Any valid URL                                                     |         |
| apiKey | Floppy API token (Settings → Advanced), or mdblist API key (preferences page)  | Yes                 | A non-empty string                                                |         |

It replaces the singular `Target` block of 3.x and the root-level `Trakt` block of 2.17.0 and
earlier — see [Migrating to 4.0.0](#migrating-to-400). See
[Choosing Your Platform](#choosing-your-platform) for the trade-offs between the two backends.

</details>

<details>
<summary><strong>Cache</strong> — Caching</summary>

| Name              | Description                                | Mandatory | Values         | Default          |
|-------------------|--------------------------------------------|-----------|----------------|------------------|
| Cache.enabled     | Enable caching? (recommended)              | Yes       | true, false    | true             |
| Cache.savePath    | Where to save the cache files              | Yes       | Any valid path | ./config/.cache  |
| Cache.ttl         | Cache validity duration in seconds         | Yes       | Number > 0     | 604800 (7 days)  |

The cache has two levels under `savePath`: `details/` for the scraped FlixPatrol detail
pages, and one `resolution-<backend>-<id>/` per target for its title-to-identifier mapping.
Older `movies/`, `tv-shows/`, `resolution-trakt/`, `resolution-floppy/` and
`resolution-mdblist/` directories are leftovers and can be deleted; a startup warning names them
if they are still there, and the app never deletes them itself.

</details>

<details>
<summary><strong>Schedule</strong> — Daemon mode / built-in scheduling configuration</summary>

| Name       | Description                                                              | Mandatory | Values                                | Default |
|------------|---------------------------------------------------------------------------|-----------|----------------------------------------|---------|
| enabled    | Enable the built-in scheduler (daemon mode)?                             | No        | true, false                           | false   |
| crons      | Cron expression(s) the app runs on, 5-field format (`min hour day month weekday`) | Yes, when `enabled: true` | Array of valid cron strings, e.g. `["0 6 * * *"]` | []      |
| runOnStart | Also run immediately at startup, in addition to the schedule?            | No        | true, false                           | false   |

The whole `Schedule` block is optional — omit it entirely (or leave `enabled: false`) to keep the classic one-shot behaviour: the app runs once and exits, exactly like today. See [Daemon Mode](#daemon-mode-built-in-scheduling) below for details.

</details>

<details>
<summary><strong>FlareSolverr</strong> — Cloudflare challenge bypass (optional)</summary>

FlixPatrol is behind a Cloudflare managed challenge that returns HTTP 403 to
non-browser clients. [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
solves that challenge and proxies the request.

This block is **entirely optional**. If it is absent, or `enabled` is `false`, the
tool behaves exactly as before and never contacts FlareSolverr.

| Name       | Description                                    | Mandatory        | Values                    | Default |
|------------|------------------------------------------------|------------------|---------------------------|---------|
| enabled      | Route FlixPatrol requests through FlareSolverr | No               | true, false               | false   |
| url          | FlareSolverr v1 API endpoint                   | If enabled       | Any valid URL             |         |
| maxTimeout   | Challenge solving timeout in milliseconds      | No               | Number                    | 60000   |
| disableMedia | Skip images, CSS and fonts while scraping      | No               | true, false               | false   |

When enabled, a browser session is created once at the start of each run and
destroyed at the end. The first request solves the challenge (around 12s); later
requests reuse the session and take 1-3s each.

`disableMedia` makes the solver's browser skip images, stylesheets and fonts, which
the scraper never looks at — it only reads HTML. Measured over 80 requests, it takes
about **15% off those later requests** and leaves the initial challenge solve
unchanged, since the challenge is what dominates and it still runs its JavaScript
normally. Two things temper it: most of the saving lands on **cold-cache runs**,
because detail pages are cached for `Cache.ttl` and never reach FlareSolverr twice;
and a browser that fetches no stylesheet at all is a slightly unusual traffic shape,
which Cloudflare could in principle score. Zero solve failures were observed either
way, but the default stays `false` so nothing changes for existing setups. It also
lowers the container's memory and CPU use, which the FlareSolverr docs warn about.

Run FlareSolverr alongside the tool:

```yaml
# docker-compose.yml
services:
  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: flaresolverr
    # Published on loopback only: FlareSolverr has no authentication and must not
    # be reachable from the network.
    ports:
      - "127.0.0.1:8191:8191"
    environment:
      - LOG_LEVEL=info
    restart: unless-stopped
```

If the tool itself runs in Docker on the same Compose network, use the service name
instead of localhost: `"url": "http://flaresolverr:8191/v1"`.

</details>

<details>
<summary><strong>Example configuration</strong></summary>

> **Note**
> This example defines 11 lists — more than a free mdblist account (4 static lists) allows. It
> exists to show the available options, not as a ready-to-use file: trim it to your backend's
> capacity. See [Choosing Your Platform](#choosing-your-platform).

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
  "FlixPatrolWeekly": [
    {
      "enabled": true,
      "privacy": "public",
      "limit": 20,
      "type": "both",
      "platform": "netflix"
    },
    {
      "enabled": true,
      "privacy": "public",
      "limit": 10,
      "type": "both",
      "platform": "netflix",
      "location": "france"
    }
  ],
  "Targets": [
    {
      "id": "main",
      "type": "mdblist",
      "apiKey": "your-mdblist-api-key"
    }
  ],
  "Cache": {
    "enabled": true,
    "savePath": "./config/.cache",
    "ttl": 604800
  },
  "Notifications": {
    "run_start": [],
    "run_end": [],
    "error": []
  },
  "Schedule": {
    "enabled": false,
    "crons": ["0 6 * * *"],
    "runOnStart": false
  },
  "FlareSolverr": {
    "enabled": false,
    "url": "http://localhost:8191/v1",
    "maxTimeout": 60000,
    "disableMedia": false
  }
}
```

The `Notifications` block is fully optional — leave the arrays empty (or omit the block entirely) to disable notifications. See [Notifications](#notifications) above for the supported destination types and a worked example.

The `Schedule` block is fully optional and disabled by default — omit it (or leave `enabled: false`) to keep the classic one-shot behaviour. See [Daemon Mode](#daemon-mode-built-in-scheduling) below.

The `FlareSolverr` block is fully optional and disabled by default — omit it (or leave `enabled: false`) to keep the classic behaviour of talking directly to FlixPatrol.

</details>

### Floppy Setup

[Floppy](https://github.com/dannyvfilms/Floppy) is a self-hosted media tracker. Point the
tool at your instance and it will create and refresh lists there.

1. Create a **dedicated account** on your instance for this tool. Do not reuse your
   personal one: adding a title Floppy has never seen goes through a catalogue bootstrap
   that briefly creates a `Planning` tracking row, which the tool deletes right after. If
   the process is killed in that narrow window, the stray row stays behind — on a
   dedicated account it is harmless noise, on your own account it pollutes your watchlist.
2. Log in as that account and copy its token from **Settings → Advanced**.
3. Add a `floppy` entry to `Targets` with that token in `apiKey` and your instance URL in `url`.

```json
{
  "Targets": [
    {
      "id": "main",
      "type": "floppy",
      "url": "http://localhost:8000",
      "apiKey": "your-floppy-token"
    }
  ]
}
```

> **Note**
> The Floppy API exposes no way to set a list's visibility, so the `privacy` field of your
> list entries is ignored and every list the tool creates stays private — a warning says so
> once per Floppy target at startup. If you want to share one, flip it by hand in the web UI.
> This blocks nothing in practice: **Kometa reads private lists with the same token**, so a
> private list is fully usable.

When wiring the result into [Kometa](https://kometa.wiki/), prefer the `floppy_list`
builder over `floppy_list_details`: the latter overwrites your Plex collection summary
with the list description, and the tool never writes one on this backend — it relies on
Floppy's native `latest_update` field instead of a "Last Updated" description.

### mdblist Setup

[mdblist](https://mdblist.com/) is a hosted list service authenticated by a single API key.

1. Create an account and copy your API key from your
   [preferences page](https://mdblist.com/preferences/).
2. Put it in the `apiKey` of an `mdblist` entry of `Targets` — this is the entry the shipped
   template already carries.

```json
{
  "Targets": [
    {
      "id": "main",
      "type": "mdblist",
      "apiKey": "your-mdblist-api-key"
    }
  ]
}
```

> **Warning**
> A free mdblist account is capped at **4 static lists**. Configure more entries than that
> and list creation will start failing — trim your configuration or take a paid plan.

> **Note**
> The mdblist search endpoint rejects titles containing characters beyond Latin-1 with
> `400 Invalid search query`. Accented latin letters are fine (`Amélie` resolves), but
> curly quotes, dashes and ellipses are not — the tool folds those back to ASCII, so
> `Let’s Marry Harry` is found anyway. A title in a non-latin script cannot be folded and
> would stay unresolvable here; in practice that does not happen, because FlixPatrol
> publishes titles in English or romaji even for a platform like Crunchyroll. Should one
> ever appear, it logs a warning and is skipped, and the rest of the list is written
> normally.

The API budget is **1 000 requests per day**, billed **one unit per HTTP call**. Two things
keep a run cheap:

- **Writes scale per list, not per item.** mdblist accepts bulk add and remove, and both
  media types are written in a single call, so a list of 100 items costs the same as a list
  of 3 — about four calls, plus one shared index lookup per run.
- **Resolution is cached** (see `Cache.ttl`). Only titles the tool has never resolved before
  consume a search call, so the first run carries the cost and later runs do not.

In practice a 10-entry configuration costs a few hundred units on its first run and a few
dozen afterwards — comfortably inside the free tier, whose real ceiling is the 4-list cap
above rather than the request budget. The remaining budget is logged after every list write,
and any API response reports it in `x-ratelimit-remaining`. Should it run out mid-run, the
`429` drops that target from the run — the other targets carry on — and it is retried on the
next run.

## Supported Platforms

### Top 10 Platforms (74)

`9now`, `abema`, `amazon`, `amazon-channels`, `amazon-prime`, `amc-plus`, `antenna-tv`, `apple-tv`, `bbc`, `canal`, `catchplay`, `cda`, `chili`, `claro-video`, `coupang-play`, `crunchyroll`, `discovery-plus`, `disney`, `francetv`, `friday`, `globoplay`, `go3`, `google`, `hami-video`, `hayu`, `hbo-max`, `hrti`, `hulu`, `hulu-nippon`, `itunes`, `jiocinema`, `jiohotstar`, `joyn`, `lemino`, `m6plus`, `mgm-plus`, `myvideo`, `neon-tv`, `netflix`, `now`, `oneplay`, `osn`, `paramount-plus`, `peacock`, `player`, `pluto-tv`, `raiplay`, `rakuten-tv`, `rtl-plus`, `sbs`, `shahid`, `skyshowtime`, `stan`, `starz`, `streamz`, `telasa`, `tf1`, `tod`, `trueid`, `tubi`, `tv-2-norge`, `u-next`, `viaplay`, `videoland`, `vidio`, `viki`, `viu`, `vix`, `voyo`, `vudu`, `watchit`, `wavve`, `wow`, `zee5`

### Popular Sources (2)

`wikipedia`, `youtube`

### Locations (199)

`world`, `united-states`, `france`, `united-kingdom`, `germany`, `canada`, `australia`, `japan`, and 191 more countries...

For the complete list, see the source code: [Config.types.ts](https://github.com/Navino16/flixpatrol-top10/blob/main/src/types/Config.types.ts)

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
0 6 * * * docker run --rm -v "/path/to/config:/app/config" ghcr.io/navino16/flixpatrol-top10:latest
```

### Windows Task Scheduler

1. Open Task Scheduler
2. Create a new task
3. Set the trigger (e.g., daily at 6 AM)
4. Set the action to run the executable

## Daemon Mode (built-in scheduling)

Instead of relying on an external scheduler (cron, Task Scheduler, `docker run` on a timer), the app can run as a long-lived
process with its own built-in scheduler. Add a `Schedule` block to `config/default.json` and set `enabled: true`:

```json
{
  "Schedule": {
    "enabled": true,
    "crons": ["0 6 * * *"],
    "runOnStart": false
  }
}
```

| Field        | Description                                                                 |
|--------------|------------------------------------------------------------------------------|
| `enabled`    | Turns daemon mode on. When `false` or omitted, the app runs once and exits — the current behaviour is completely unchanged. |
| `crons`      | One or more cron expressions, standard 5-field format (`min hour day month weekday`), e.g. `"0 6 * * *"` for daily at 6 AM. Must contain at least one entry when `enabled` is `true`. |
| `runOnStart` | When `true`, triggers an immediate run at startup, then continues to follow the configured schedule. |

### Backward compatibility

The `Schedule` block is entirely optional. If it is absent, or `enabled` is `false`, the app behaves exactly as before:
it runs once and exits with the appropriate code. Your existing external cron job or `docker run` on a timer keeps
working without any change.

### Timezone

The scheduler follows the system clock. There is no timezone field in the config — set the `TZ` environment variable
(e.g. `TZ=Europe/Paris`) on the host or container so cron expressions are evaluated in the timezone you expect.

### Behaviour while running

- If a scheduled trigger fires while a run is still in progress, it is skipped (logged as a warning) rather than
  queued or run concurrently.
- A failed run is logged and sent through the [Notifications](#notifications) system (the `error` event), but it does
  **not** stop the daemon — the scheduler keeps waiting for the next trigger.
- On `SIGTERM` (e.g. `docker stop`) or `SIGINT` (Ctrl-C), the app performs a graceful shutdown: it stops accepting new
  triggers and waits for the current run to finish its backend write before exiting, so lists are never left half-updated.
  Because each list is written in a single call, the stop point always falls between two lists — never between the
  movies and the shows of the same list.

### Docker Compose example

Run the container as a long-lived daemon instead of a one-shot job:

```yaml
# docker-compose.yml
services:
  flixpatrol:
    image: ghcr.io/navino16/flixpatrol-top10:latest
    restart: unless-stopped
    environment:
      - TZ=Europe/Paris
    volumes:
      - ./config:/app/config
```

With `Schedule.enabled: true` in `config/default.json`, this container stays up, runs on the configured cron
schedule(s), and survives restarts (`restart: unless-stopped`). This replaces the external-cron pattern shown above
(`docker run` triggered by a host cron entry) — you no longer need a cron job on the host, since the schedule now
lives inside the app itself.

## Troubleshooting

Roughly ordered by how often each one comes up.

**Startup fails with `Configuration format changed in 4.0.0` or `Trakt support was removed in 4.0.0.`**
Your configuration predates 4.0.0: a singular `Target` block, a root-level `Trakt` block, or a
`trakt` entry. The message prints the `Targets` block or entry to write, with placeholders such as
`<keep your current apiKey>` where your own values go — it never echoes a credential. Copy it into
`config/default.json` in place of the old block. Your file is never rewritten for you: the config
directory is frequently a read-only mount and usually version-controlled. See
[Migrating to 4.0.0](#migrating-to-400).

**Startup fails saying a `Targets` field still holds a placeholder value.**
The `config/default.json` the app generated on first run was never edited. A fresh install ships
an mdblist entry whose `apiKey` is a placeholder — replace it with your real key from your
[preferences page](https://mdblist.com/preferences/). The message names the entry by its `id`.

**Warning about an obsolete `Target` or root-level `Trakt` block.**
Nothing is broken: the run proceeds normally. Credentials now live inside the `Targets` entries,
so the old block is no longer read. Delete it whenever you like to silence the warning.

**`Unable to get FlixPatrol ... page` with `HTTP 403 (cf-mitigated: challenge)`.**
Cloudflare is challenging the request. Enable the optional
[`FlareSolverr`](#configuration-file) block and point it at a FlareSolverr instance.

**Warning naming leftover cache directories under your cache path.**
`movies/` and `tv-shows/` are the 2.x cache layout; `resolution-trakt/`, `resolution-floppy/` and
`resolution-mdblist/` the 3.x one. The cache is now split into `details/` and one
`resolution-<backend>-<id>/` per target, so nothing reads them any more. Delete them yourself — the
app never removes your files.

**A target is reported `aborted` in the `run_end` summary.**
That target failed and was dropped from the rest of the run; the other targets were still
written. The summary carries the error. A `401` or `403` means its `apiKey` is wrong, a
`fetch failed` on Floppy that its `url` is unreachable; a `429` on mdblist means the daily request budget ran out — typically on the first run after
an upgrade or an `id` rename, which re-resolves every title. The target is retried on the next run,
and titles it had already resolved stay cached.

**One list stopped updating, on a market that charts only one media type.**
This is the correct behaviour, not a regression. When FlixPatrol publishes no chart for a media
type, that half of the list is left exactly as it was rather than being filled with the other
type's rows — which is what earlier versions could do. The other half still updates normally.

**A `kids: true` entry produced nothing.**
Kids is the last section of the day FlixPatrol publishes, so an early run finds the tables absent
and leaves the list unchanged rather than writing the wrong content. Run later in the day. Also
check the entry is on `netflix` with a specific `location`: kids charts do not exist for other
platforms or for `world`, and the app skips the entry with a warning.

**Titles in the list are wrong or missing.**
FlixPatrol exposes only a name and a release year, so titles are matched on the backend by those
two fields and can occasionally mismatch. When a detail page exposes no usable premiere date the
year is reported as unknown and the match falls back to the title alone. If nothing at all
resolves, a warning says so and the list is left unchanged instead of being emptied.

**No items found for a platform/location combination.**
Verify the combination actually exists on [FlixPatrol](https://flixpatrol.com) — not every platform
charts in every country. Set `fallback` to another location if you want an empty result to fall back
rather than produce nothing.

**Creating a list fails once you have a few of them.**
A free mdblist account is capped at **4 static lists**. Beyond that, list creation starts failing
and that target is dropped from the run. Trim your configuration or take a paid mdblist plan.
Floppy has no such cap.

**On Floppy, every list is created private and `privacy` is ignored.**
The Floppy API exposes no way to set visibility, so the setting cannot be honoured; a warning says
so once per Floppy target at startup. Flip the ones you want to share by hand in the Floppy web UI.
This blocks nothing for [Kometa](https://kometa.wiki/), which reads private lists with the same
token. See [Privacy levels per backend](#privacy-levels-per-backend).

**`Permission denied` on the config folder (Docker).**
The image runs as a non-root user (`flixpatrol`, UID 1000). Fix ownership of the mounted directory:
`sudo chown -R 1000:1000 /path/to/config`.

**Rate limit exceeded.**
Increase the time between runs. Keeping `Cache.enabled: true` reduces both scraping and backend API
calls substantially, since resolved titles are not looked up again until the TTL expires.

## Development

Local setup, the full command reference (build, lint, unit tests, coverage), the code style and
the pull request conventions live in [CONTRIBUTING.md](CONTRIBUTING.md).

`npm run test:e2e` runs the opt-in end-to-end suites against real services — a real Floppy
instance, a real mdblist account, the live FlixPatrol site. Each suite is
enabled by its own environment variables and **skips cleanly** when they are missing, so running
it with no environment at all skips everything and exits green. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the variables, the local infrastructure and what runs in CI.

## License

[GNU General Public License v3.0](LICENSE)
