# Contributing

Thanks for taking the time to contribute. This document covers everything you need to work on
the code: local setup, the command reference, the test suites (including the opt-in end-to-end
ones), and how pull requests are expected to look.

For anything user-facing — configuration, supported platforms, scheduling, troubleshooting — see
[README.md](README.md).

## Local setup

Node **24** is what CI runs and what the release binaries target (`pkg.targets` in
`package.json`).

```bash
git clone https://github.com/Navino16/flixpatrol-top10-on-trakt.git
cd flixpatrol-top10-on-trakt
npm install
```

When running the app by hand to verify a change, set `LIST_NAME_PREFIX='[TEST]'` so the lists it
writes stay separate from your real ones, and consider `DRY_RUN=true` to skip every write
entirely. Both are documented in the README's
[Environment Variables](README.md#environment-variables) section.

## Commands

```bash
# Run in development mode (hot reload via nodemon)
npm run start:dev

# Build TypeScript to build/
npm run build

# Run after build
npm run start

# Lint
npm run lint

# Lint and auto-fix
npm run lint-and-fix

# Type-check src/ and tests/ (see Type checking below)
npm run typecheck

# Run the unit and integration suites once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage (reports in .reports/coverage)
npm run test:coverage

# Run the opt-in end-to-end suites against real services (see below)
npm run test:e2e

# Create cross-platform binaries in bin/
npm run package
```

## Code style

ESLint is the single source of truth for style (`eslint.config.mjs`): the TypeScript recommended
rule sets plus `max-len` at **120** characters, with strings and template literals exempt.
`npm run lint` must pass before a pull request is merged, and `npm run lint-and-fix` handles most
of the mechanical work.

## Type checking

There are two TypeScript projects, and both are gates:

- `tsconfig.json` describes the **shipped build** — `rootDir: "src"`, emit to `build/`. It is what
  `npm run build` and the `Build` CI job compile, and it excludes `tests`.
- `tsconfig.test.json` extends it and covers what the build has no business compiling: `tests/`,
  `types/` and the vitest configs, with `noEmit`. `npm run typecheck` runs it, and so does the
  `Lint` CI job.

Run `npm run typecheck` before opening a pull request. Test files are where mocks cast freely and
reach into private shapes, so a test that has drifted from the signature it is meant to protect
only shows up here.

The overrides in `tsconfig.test.json` are load-bearing. `rootDir: "."` is what keeps `TS6059`
("not under rootDir") off every test file, and `target`/`module`/`moduleResolution` are set to
match how vitest actually loads tests — ESM with Vite resolution — because under the base
`commonjs`/`es2016` every top-level `await` in a test raises a `TS1378` that is a pure false
positive. Do **not** collapse the two projects by dropping `tests` from the base `exclude`: that
is the obvious-looking fix and it reintroduces 34 `TS6059` errors.

## Tests

`npm test` runs the unit and integration suites offline — no network, no credentials. Coverage
(`npm run test:coverage`, which is what CI runs) is gated at **80%** for lines, functions,
branches and statements. `src/app.ts` is deliberately excluded from coverage: it is
process-level wiring (signal handlers, `process.exit` paths), so testing it would assert on the
process lifecycle rather than on behaviour — the logic it orchestrates is covered through
`Pipeline/` and `Scheduler/`.

Shared test helpers live in `tests/helpers/`, which the vitest `include` pattern does not match, so
nothing there is collected as a suite. Reach for it when a mock needs a cast to type-check —
`mockProcessExit()` exists because `process.exit` returns `never`, which no mock implementation can
satisfy, and that cast is worth writing once rather than per file.

## End-to-end tests

`npm run test:e2e` uses a separate config (`vitest.e2e.config.ts`) and runs only
`tests/e2e/**/*.e2e.test.ts`. There is one suite per backend plus one for FlixPatrol itself, and
each talks to a **real service** — a real Floppy instance, a real Trakt account, a real mdblist
account, the live FlixPatrol site — so they are excluded from `npm test` and from the coverage
numbers.

All of them are opt-in through environment variables, and each suite **skips cleanly** when its own
variables are missing. Running `npm run test:e2e` with no environment at all skips everything and
exits green, so you only ever enable the target you actually want to exercise:

The variables can be exported inline, or written once into a git-ignored `.env.e2e` that
`vitest.e2e.config.ts` loads automatically — copy `.env.e2e.example` and fill in what you need. A
variable already present in the environment overrides the file, so one-off runs stay possible.

| Suite           | Variables                                                                  |
|-----------------|----------------------------------------------------------------------------|
| **Floppy**      | `E2E_FLOPPY_URL`, `E2E_FLOPPY_API_KEY` (both required)                      |
| **Trakt**       | `E2E_TRAKT_CLIENT_ID`, `E2E_TRAKT_CLIENT_SECRET`, `E2E_TRAKT_SAVE_FILE` (all required) |
| **mdblist**     | `E2E_MDBLIST_API_KEY`                                                       |
| **FlixPatrol**  | `E2E_FLARESOLVERR_URL`                                                      |

```bash
# Floppy only
E2E_FLOPPY_URL=http://localhost:8000 E2E_FLOPPY_API_KEY=your-token npm run test:e2e

# Trakt only — E2E_TRAKT_SAVE_FILE must point at an EXISTING token file
E2E_TRAKT_CLIENT_ID=your-id E2E_TRAKT_CLIENT_SECRET=your-secret \
  E2E_TRAKT_SAVE_FILE=./config/.trakt npm run test:e2e

# mdblist only
E2E_MDBLIST_API_KEY=your-key npm run test:e2e

# FlixPatrol markup drift — needs a reachable FlareSolverr, since the site is behind Cloudflare
E2E_FLARESOLVERR_URL=http://localhost:8191/v1 npm run test:e2e
```

### Local infrastructure

Two of the suites need something running locally: Floppy for its own suite, and FlareSolverr for the
FlixPatrol one. `docker-compose.e2e.yml` provides both. It is separate from `docker-compose.yml`,
which is user-facing, so nobody ends up starting a Floppy instance they have no use for — merge the
two files rather than duplicating FlareSolverr:

```bash
# --wait blocks until the healthchecks pass; Floppy's first boot takes about 90 seconds
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --wait

# Mint a token for the dedicated `e2e` account and put it in .env.e2e as E2E_FLOPPY_API_KEY
docker exec floppy-e2e python manage.py shell -c \
  "from users.models import User; u,_ = User.objects.get_or_create(username='e2e'); print(u.token)" \
  2>/dev/null | tail -n1

npm run test:e2e

# Tear down, discarding the Floppy database with it
docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v
```

The Floppy service deliberately persists nothing: a fresh, empty catalogue on every `up` is what
makes the cold-path bootstrap test meaningful, since against a long-lived instance it consumes one
uncatalogued title per run and eventually degrades to the warm path, testing nothing.

Note the Floppy suite does **not** start a container itself, and does not skip when the instance is
unreachable — if `E2E_FLOPPY_URL` is set, it fails. That is deliberate: configuring the URL is the
statement that you meant to test Floppy.

### The FlixPatrol drift suite

`tests/e2e/FlixPatrolXPath.e2e.test.ts` is the odd one out: it writes nothing, it only reads. Every
XPath expression in `src/Flixpatrol/parse.ts` is matched against a site nobody here controls, and
when that markup drifts the fallbacks keep the parse "working" while quietly returning the wrong
thing — which is exactly how a run of releases once stamped the same year onto every single title.

So the suite does **not** assert that parsing succeeds. It asserts that the **primary** rung of each
expression chain still matches, and treats a fallback taking over as a failure in its own right. It
also checks one invariant that holds whatever the site lists today: several unrelated titles must
not all report the same release year. It never asserts today's content — only shapes, counts and
which rung matched.

It covers one page per XPath family (Top 10 world, Top 10 regional, Top 10 Kids, Popular, Most
watched including the `original: true` variant, Most hours including its language tabs), and derives
its detail-page URLs at runtime from those listings rather than hardcoding `/title/...` links, which
would rot as the site prunes pages. Each page is fetched exactly once and shared by every assertion.

Every backend suite checks the end state by querying the service directly, never through the
adapter, and cleans up after itself: each names the objects it creates with a per-run unique
suffix, and deletes them in an `afterAll` that runs even when a test failed.

Trakt authenticates through an OAuth **device flow** — a human opens a URL and types a code —
which cannot happen inside a test. The Trakt suite therefore consumes an **already-obtained**
token: run the application once to authorise, then point `E2E_TRAKT_SAVE_FILE` at the token file
it wrote. The suite creates a single `private` list (a free Trakt account is capped at five
personal lists) and never touches a list it did not create.

### What runs in CI, and what does not

- **Floppy runs automatically in CI**, as the `E2E - Floppy` job of
  `.github/workflows/ci.yml`, on every pull request to `main`/`develop` — the same trigger as
  `lint`, `build` and `test`. It stands up its own throwaway containers (Redis + the upstream
  Floppy image) and mints its API token inside them, so it needs **no repository secret**. That
  makes it safe even for pull requests from forks, and it is a first-class gate rather than an
  opt-in extra.
- **Trakt and mdblist are deliberately local-only.** They write to **real third-party accounts**,
  so the owner wants to decide, run by run, which credentials are used. They are not part of any
  workflow and depend on no repository secret — there is nothing to leak and nothing that can
  quietly burn a metered quota (mdblist's free tier is capped at 1000 requests/day and a handful
  of lists) or churn a real Trakt profile. Run them by hand, with the commands above.
- **The FlixPatrol drift suite runs weekly**, as `.github/workflows/flixpatrol-drift.yml`
  (`schedule` + `workflow_dispatch`). The job stands up its own FlareSolverr container, so it needs
  no secret either. It is deliberately **not** wired to `pull_request`: as the README warns, using
  the project carries a risk of being IP banned from FlixPatrol, and GitHub runners share a small
  set of published address ranges — scraping the site on every pull request would be both hostile
  to a third party and a good way to get those ranges blocked. Drift is a slow-moving failure, so
  weekly is enough to shorten the time to notice from months to days. A failure fails the job
  loudly and, when a `DISCORD_WEBHOOK` repository secret exists, posts which assertions drifted;
  without the secret the notification step skips and the run simply stays red.

## Pull requests

Branch off `develop` and open the pull request against `develop`.

Fill in [the pull request template](.github/PULL_REQUEST_TEMPLATE.md) — description, type of
change, the checklist (local testing, tests added or updated, coverage maintained,
`npm run lint`, `npm run typecheck` and `npm test` passing) and any related issues.

Add the labels that apply:

| Label              | Use for                                     |
|--------------------|---------------------------------------------|
| `enhancement`      | New features                                |
| `bug`              | Bug fixes                                   |
| `breaking change`  | Changes requiring user action               |
| `documentation`    | Documentation updates                       |
| `dependencies`     | Dependency updates                          |

## License

By contributing you agree that your work is licensed under the project's
[GNU General Public License v3.0](LICENSE).
