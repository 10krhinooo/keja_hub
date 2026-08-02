# KejaHub — Section 11 backlog + CI pipeline with a 90% coverage gate

## Status

| Phase                                       | State                                | Landed in |
| ------------------------------------------- | ------------------------------------ | --------- |
| 0. Test harness and app/bootstrap split     | Done                                 | PR #2     |
| 1. Tests to 90%                             | Done, 93.97% lines / 84.61% branches | PR #2     |
| 2. CI pipeline with the coverage gate       | Done                                 | PR #2     |
| 3. ESLint and Prettier                      | Done                                 | PR #2     |
| 4. Drop `unsafe-inline` from the script CSP | Not started                          |           |
| 5. sql.js to better-sqlite3                 | Not started                          |           |
| 6. Object storage and image resizing        | Not started                          |           |
| 7. Remaining section 11 items               | Not started                          |           |

Phases 0 through 3 shipped together because they are mutually dependent: the CI
`lint` job cannot pass without the ESLint config, and the coverage gate is
meaningless without the tests. Phases 4 through 7 each get their own PR.

**One thing to know before adding tests:** this repo has GitGuardian enabled, and
it scans every commit in a PR's history rather than just the tip. Any password
literal in a test will fail the check even after a later commit removes it, and
the only fix at that point is rewriting the branch history. Use the generated
credentials from `tests/helpers/app.js` (`CREDENTIALS`, `newPassword()`) instead
of writing a password into a test.

## Context

`PROJECT_DOCUMENTATION.md` §11 records 13 known limitations that have accumulated
as KejaHub grew, ranked High/Medium/Low. Nothing in that list has been actioned:
the repo today has **no tests, no linter, no CI**, a CSP weakened specifically to
keep 31 inline `onclick` handlers working, uploads written to local disk at full
size, and several half-finished features (`is_verified`, partial pagination).

Two consequences drive the ordering below. First, the riskiest items — rewriting
every inline handler, moving uploads to object storage — are exactly the ones
most likely to break something silently, and there is currently no safety net to
catch that. Second, the codebase is small (~2,050 backend lines, ~600 frontend)
and mostly pure or thin, so a genuine 90% gate is reachable rather than
aspirational.

So: **build the safety net first, then do the refactors behind it.**

Decisions already made:

- Runner: Node 24's built-in `node:test` + `--experimental-test-coverage`.
- Gate: 90% lines across `backend/**` _and_ `frontend/public/js/**`, CI fails below.
- All 13 §11 items are in scope, **including the `better-sqlite3` migration** (Phase 5).
- Branch: `feature/testing-ci-and-backlog`, off `main`.

### One assumption you should know about

You picked `node:test` _and_ frontend coverage. Those combine, but not for free:
`node:test` attributes coverage to files loaded through Node's module system, and
the six frontend files are browser IIFEs with no exports. Loading them via
`window.eval()` into a JSDOM document would execute them but report **0% coverage**
against the source file.

The fix is a footer on each frontend file:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = { togglePwd, ... };
```

The IIFE and browser behaviour are unchanged; the file just becomes `require()`-able
so tests can pull real functions out and coverage can attribute lines. This is
a small, honest refactor and it overlaps with the CSP work in Phase 4 anyway — those
files are being restructured regardless. Proceeding on that basis.

---

## Branching, commits, PRs

Branch `feature/testing-ci-and-backlog` off `main` (not off the current
`feature/landlord-photo-management`). Each phase below becomes its own PR against
`main`, stacked in order, so the CSP rewrite and the database migration stay
separately reviewable.

Conventions, to be applied to every commit and PR here:

- Conventional Commits: `feat:`, `fix:`, `test:`, `ci:`, `refactor:`, `chore:`,
  `docs:`. Imperative subject, under 72 characters.
- **No trailers.** No `Claude-Session`, no `Co-Authored-By`, nothing appended to the
  message body or PR description.
- **No em dashes** anywhere in commit messages or PR text.
- **No test plan section** in PR descriptions. Describe what changed and why, then stop.

Expected commit sequence: `chore: add test harness and dev tooling` → `test: cover
utils and middleware` → `test: cover controllers via supertest` → `ci: add GitHub
Actions pipeline with 90% coverage gate` → `chore: add eslint and prettier` →
`refactor: replace inline handlers with addEventListener` → `refactor: migrate from
sql.js to better-sqlite3` → `feat: add pluggable upload storage and image resizing`.

I will save these conventions to memory at the start of implementation, since plan
mode restricts edits to this file.

---

## Phase 0 — Test harness

**`package.json`** — add devDependencies `supertest`, `jsdom`, `eslint`,
`@eslint/js`, `prettier`, `eslint-config-prettier`. Add scripts:

```json
"test":          "node --test --experimental-test-coverage tests/",
"test:watch":    "node --test --watch tests/",
"test:coverage": "node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=coverage/lcov.info --test-reporter=spec --test-reporter-destination=stdout tests/",
"lint":          "eslint .",
"format":        "prettier --write ."
```

**Split the app from its bootstrap.** `backend/index.js:133-150` calls
`initDB().then(() => app.listen(...))` at module load, so `require`-ing it starts a
server and binds a port. Extract:

- `backend/app.js` — everything currently in `index.js:1-131` (middleware, routes,
  error handler), ending in `module.exports = app`. No `listen`, no `initDB`.
- `backend/index.js` — shrinks to the bootstrap: `require('./app')`, `initDB()`,
  `listen`, and the existing SIGTERM/SIGINT `shutdown` handler.
- `package.json` `main`/`start` keep pointing at `backend/index.js`. Nothing about
  production startup changes.

**`tests/helpers/app.js`** — per-test-file harness: sets `DB_PATH` to a unique
path under `os.tmpdir()`, `NODE_ENV=test`, a fixed `SESSION_SECRET` and
`ADMIN_PASSWORD`, calls `initDB()`, returns the app plus a cleanup that deletes the
temp DB and the temp uploads dir. Reuses `initDB`/`getDB`/`saveDB` from
`backend/database.js:439` as-is.

**`tests/helpers/agent.js`** — wraps `supertest.agent(app)` to persist the session
cookie, plus `login(email, password)` and `csrf(path)` (GETs a page, scrapes the
`_csrf` hidden input from `res.text`). Every mutating test needs this because
`csrfProtection` (`backend/middleware/csrf.js:3`) rejects tokenless POSTs with 403.

**`tests/helpers/dom.js`** — builds a JSDOM instance, assigns
`window`/`document`/`sessionStorage` onto `globalThis`, and returns a teardown. Used
by the frontend tests.

**Mailer stub.** `backend/utils/mailer.js` sends real SMTP. Tests set
`NODE_ENV=test` and the harness injects a no-op transport (or `mailer.js` gains a
`__setTransport` seam) so password-reset tests assert on the captured message
instead of the network.

---

## Phase 1 — Tests to 90%

Coverage is dominated by the controllers (1,546 of ~2,050 backend lines), so unit
tests alone cannot reach 90%. The split is roughly: unit tests for the pure
modules, supertest integration tests for everything routed.

**Unit — `tests/unit/`**

| File under test                  | What to cover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/utils/houseImages.js`   | `resolveUploadPath` path-traversal guard (`../` escapes, the seeded `/images/background.jpg` case, null) · `applyImageOrder` (foreign ids dropped, duplicates ignored, omitted ids appended at the end, non-array/empty early return) · `normalizePrimary` (preferred id wins, falls back to existing primary, then first; exactly one primary always) · `nextSortOrder` on an empty table → 0 · `countHouseImages` vs `MAX_IMAGES_PER_HOUSE` · `deleteImageFiles`/`deleteUploadedFiles` swallow unlink errors |
| `backend/utils/validateHouse.js` | Every branch of `validateHouseInput` — each min/max boundary, `location_select === '__new__'`, amenity filtering against `AMENITY_OPTIONS`, `clampInt` fallbacks and NaN                                                                                                                                                                                                                                                                                                                                       |
| `backend/middleware/csrf.js`     | Token minting, match/mismatch/missing, the `multipart/form-data` skip, `x-csrf-token` header path, `csrfVerify`                                                                                                                                                                                                                                                                                                                                                                                                |
| `backend/middleware/auth.js`     | Redirect when logged out, role mismatch, deactivated user → session destroyed                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `backend/database.js`            | `resolveUploadPath` peers: `getDistinctLocations`, `rowsToObjects`, `firstRow`, migration idempotency (call `initDB` twice), `saveDB` tmp-file rename                                                                                                                                                                                                                                                                                                                                                          |

The DB-touching helpers take `db` as their first argument, so they test against a
real in-memory sql.js database from the harness — no mocking needed.

**Integration — `tests/integration/`**, one file per controller:

- `auth.test.js` — register (validation failures, duplicate email), login/logout,
  forgot-password token issue + expiry + single-use, reset-password.
- `landlord.test.js` — the biggest coverage win. Add house with photos (multipart
  via `.attach()`), the 10-photo cap rejection, edit reordering + cover selection,
  the ownership check on another landlord's house, delete cleaning up rows and
  files, status staying `approved` on edit (the §10.4 regression), profile and
  password change.
- `student.test.js` — search filters and pagination, house detail, booking create,
  reviews.
- `admin.test.js` — approve/reject, user deactivate/reactivate, listings/bookings/
  reports pagination, analytics.
- `middleware.test.js` — 404 handler, the multer error branch at
  `backend/index.js:120-128` (oversized file → `?error=file_too_large`, wrong mime
  → `upload_type_error`), rate limiting.

**Frontend — `tests/frontend/`**, after the Phase 0 export footers land: `toast.js`
(`TOAST_MESSAGES` lookup + the generic fallback for unknown keys, per §10.6),
`validation.js` (each rule, submit gating), `photo-manager.js` (preview add/remove,
reorder, cover selection, cap enforcement), `lightbox.js`, `dates.js`, `skeleton.js`.

**Reaching the number.** Run `npm run test:coverage`, read the per-file table, and
fill the lowest files first. Expect the last stretch to be error branches — DB
failures, malformed params — reachable by temporarily pointing `DB_PATH` at an
unwritable path or posting garbage. Do **not** add `--test-coverage-exclude`
entries to manufacture the number; the only legitimate exclusions are `tests/**`
itself and `backend/index.js`'s bootstrap lines.

---

## Phase 2 — CI pipeline

**`.github/workflows/ci.yml`**, triggered on push to `main` and on PRs. Remote is
already `github.com:10krhinooo/kejahub`.

- `lint` job — `npm ci`, `npm run lint`, `npx prettier --check .`
- `test` job — matrix on Node 20 and 24, `npm ci`, then
  `node --test --experimental-test-coverage --test-coverage-lines=90 --test-coverage-branches=75 --test-coverage-exclude='tests/**' tests/`.
  Node exits non-zero when a threshold is missed, which is the gate — no extra
  tooling. Upload `coverage/lcov.info` as an artifact.
- `audit` job — `npm audit --audit-level=high`.
- Concurrency group keyed on ref with `cancel-in-progress: true`.

Node 20 is in the matrix because `package.json` declares `"node": ">=18"`; if the
coverage flags prove unstable there, tighten `engines` to `>=22` rather than
dropping the gate.

Add a branch-protection note to `PROJECT_DOCUMENTATION.md` §9 — the gate only bites
if `main` requires the check.

---

## Phase 3 — Linter and formatter (§11 Low)

`eslint.config.js` (flat config): `@eslint/js` recommended, `sourceType: commonjs`,
Node globals for `backend/**`, browser globals for `frontend/public/js/**`, and
`eslint-config-prettier` last. `.prettierrc` — single quotes, 2-space indent, 100
print width, matching what the code already does. `.prettierignore` covering
`node_modules`, `uploads`, `coverage`, `*.db`.

Run `npm run format` as one isolated commit so the diff stays reviewable, then fix
lint errors in a second commit. Also delete `firstRow`/`rowsToObjects` from
`backend/database.js:418-427` if the Phase 1 coverage report confirms nothing calls
them (§11 Low).

---

## Phase 4 — Drop `unsafe-inline` from the CSP (§11 High)

31 inline handlers across 12 templates, plus ~30 inline `<script>` blocks. They are
highly repetitive, so three extractions clear most of it:

1. **`frontend/public/js/password-toggle.js`** — `togglePwd` plus its two SVG
   constants are copy-pasted verbatim into 6 templates. One file with
   `document.querySelectorAll('[data-toggle-password]')` removes 6 inline `<script>`
   blocks and 12 `onclick="togglePwd(this)"` attributes in a single move. Note
   `auth/reset-password.ejs:100` names its constants `EYE_ON` vs `EYE_OFF` elsewhere —
   unify on one.
2. **`frontend/public/js/confirm.js`** — replaces the 6 `onclick="return confirm(...)"`
   and `onsubmit="return confirm(...)"` handlers with `data-confirm="message"`, scanned
   at `DOMContentLoaded`. Same submit-interception idiom as `validation.js:166`.
3. **`frontend/public/js/toast-init.js`** — the 18 one-liner
   `Toast.success(Toast.msg('<%= query.success %>'))` bootstraps become
   `<body data-toast-success="..." data-toast-error="...">` read by `toast.js`. The three
   dashboards that interpolate `<%- JSON.stringify(user.name) %>` pass the name as a
   separate `data-user-name` attribute.

Remaining one-offs: `switchTab` (`admin/users.ejs:135`), `toggleReject`
(`admin/listings.ejs:126`, the only handler with an interpolated EJS argument — move
the id to `data-house-id`), `toggleReason` (`admin/reports.ejs:90`), `selectRole`
(`auth/register.ejs`), the three duplicated nav-active-link IIFEs (one shared
`nav.js`), and the near-identical location-select IIFEs at
`landlord/add-house.ejs:113` and `edit-house.ejs:146` — those already use
`addEventListener` and only need relocating to a shared `location-select.js`.

`student/dashboard.ejs:33`'s `onmouseover`/`onmouseout` background swap is styling,
not behaviour — delete it and add a CSS `:hover` rule.

Then in `backend/app.js`: delete `scriptSrcAttr` entirely (helmet defaults it to
`'none'`) and drop `'unsafe-inline'` from `scriptSrc`. Leave `'unsafe-inline'` in
`styleSrc` for now — that is gated on the inline-style cleanup below.

**Verify with the browser, not by eye.** Load every affected page with the devtools
console open and confirm zero CSP violation reports. The Phase 1 frontend tests
cover the extracted logic; they do not prove the templates wire it up.

---

## Phase 5 — sql.js → better-sqlite3 (§11 High)

This lands **after** Phase 1, deliberately: the integration tests drive real HTTP
requests and assert on rendered output, so they are API-agnostic and become the
safety net for exactly this refactor. Doing it first would mean rewriting the query
layer with nothing verifying the result.

**Cost to the existing tests:** the integration suite needs no changes. The unit
tests that pass a `db` handle directly into `houseImages.js` helpers do — that is a
mechanical `stmt.bind/step/getAsObject/free` → `stmt.all()/get()` update in the test
setup, not a redesign.

**`backend/database.js`** is the bulk of the work:

- `initDB` becomes synchronous — `new Database(DB_PATH)` instead of
  `await initSqlJs()` + `readFileSync`. Keep the `async` signature so
  `backend/index.js`'s `initDB().then(...)` bootstrap is untouched.
- Set `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` at open.
- **`saveDB` disappears entirely.** better-sqlite3 writes through to the file, so the
  periodic save timer, the `.tmp`-file rename at `database.js:404-415`, and the
  SIGTERM/SIGINT flush in `backend/index.js:138-149` all go. Keep the signal handlers
  for a clean `server.close()` + `db.close()`, but they no longer race an 8-second
  timeout to persist data.
- `rowsToObjects`/`firstRow` become redundant — `stmt.all()` and `stmt.get()` already
  return plain objects. Delete them (this also closes the §11 Low item).

**Call-site rewrite.** Every `db.prepare(...).bind(...)` / `while (stmt.step())` /
`getAsObject()` / `free()` sequence collapses to one line. In
`backend/utils/houseImages.js` alone this removes ~25 lines across
`getHouseImagePaths`, `getHouseImages`, `nextSortOrder`, and `countHouseImages`:

```js
// before (sql.js)
const stmt = db.prepare(
  `SELECT * FROM house_images WHERE house_id = ? ORDER BY sort_order ASC, id ASC`
);
stmt.bind([houseId]);
const images = [];
while (stmt.step()) images.push(stmt.getAsObject());
stmt.free();
return images;

// after (better-sqlite3)
return db
  .prepare(`SELECT * FROM house_images WHERE house_id = ? ORDER BY sort_order ASC, id ASC`)
  .all(houseId);
```

Same pattern in `backend/middleware/auth.js:6-9` and throughout the four controllers.
`db.run(sql, [params])` becomes `db.prepare(sql).run(...params)`.

**Two doc'd bugs this closes for free:**

- §10.8 "no transactions" — wrap the multi-table writes (add/edit/delete house, which
  touch `houses` + `house_images`) in `db.transaction(fn)`. A throw mid-write now rolls
  back instead of leaving partial state.
- §10.7 "foreign keys do not cascade" — with `foreign_keys = ON`, add
  `ON DELETE CASCADE` to the `house_images`, `bookings`, and `reviews` foreign keys via
  a migration, so the two hand-written delete handlers stop being the only thing
  preventing orphan rows. File cleanup via `deleteImageFiles` still has to run
  explicitly — the database cannot unlink files.

**Native module.** `better-sqlite3` compiles on install. Verify it builds on both Node
20 and 24 in the Phase 2 CI matrix, and add `npm rebuild better-sqlite3` guidance to
`PROJECT_DOCUMENTATION.md` §12 for local Node version switches. Since this removes the
"single-process ceiling" caveat, rewrite §2's "The sql.js decision" section rather than
leaving it describing a stack that no longer exists.

Node 24 also ships a built-in `node:sqlite` with a near-identical synchronous API and
no native build step. Not proposing it — you asked for `better-sqlite3`, and it works on
Node 20 — but it is the fallback if the native build proves painful in CI.

---

## Phase 6 — Uploads: object storage + resizing (§11 High/Medium)

**Storage adapter.** Every filesystem touch for uploads is already funnelled through
`backend/utils/houseImages.js` (`deleteImageFiles`, `deleteUploadedFiles`,
`resolveUploadPath`) and `backend/middleware/upload.js`. Introduce
`backend/storage/index.js` exporting `put(file) -> url`, `remove(url)`, and
`urlFor(key)`, selected by `STORAGE_DRIVER`:

- `local` (default) — current behaviour, so nothing changes for development.
- `s3` — `@aws-sdk/client-s3` with `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`
  (S3-compatible: R2, Spaces, MinIO), `S3_PUBLIC_URL`.

`multer.diskStorage` stays — files land in a temp dir, the handler uploads them, then
deletes the local copy. `house_images.image_path` keeps storing a relative path for the
local driver and a full URL for s3; `urlFor` normalises what templates render, and
`resolveUploadPath`'s traversal guard stays the authority for the local driver.

**Resizing.** Add `sharp`. On upload: strip EXIF, cap the long edge at 1600px, re-encode
to WebP at quality 80, and generate a 400px thumbnail for cards and search results. A
5 MB phone photo becomes ~150 KB. `sharp` is a native module — pin it and confirm it
builds on the CI runner in Phase 2's matrix before relying on it.

Cover this with integration tests that assert the stored dimensions and that the
temp file is gone, and add a local↔s3 parity test using a fake S3 driver.

---

## Phase 7 — Remaining §11 items

- **Pagination** (Medium) — admin users, admin reports, the landlord dashboard, and
  per-house review lists still return every row. Reuse the existing pattern from the
  paginated admin listings query in `backend/controllers/adminController.js`.
- **Email verification on registration + booking notification emails** (Medium) —
  extends the existing token table and `backend/utils/mailer.js`; the password-reset
  flow is the template to follow.
- **Landlord `is_verified`** (Medium) — column exists and is never read. Either surface
  it (admin toggle + a badge on listings) or drop the column. Recommend surfacing.
- **Structured logging** (Medium) — a small `backend/utils/logger.js` emitting JSON
  with a request id, replacing bare `console.log`. Defer error tracking until there is
  somewhere to send it.
- **Inline styles** (Low) — 359 occurrences over 26 files; ~72% are cosmetic
  (color/font/spacing) and collapse into utility classes in `style.css`. Do it
  page-by-page starting with `student/house-detail.ejs` (52) and
  `admin/house-detail.ejs` (44), which are 27% of the total. Only after this can
  `'unsafe-inline'` leave `styleSrc`.
- **Versioned migrations** (Low) — a `schema_migrations` table and numbered up-scripts,
  replacing the current run-everything-idempotently approach in `database.js`.

Update `PROJECT_DOCUMENTATION.md` §11 as items land, and correct the stale
"~29 inline handlers" comment in the CSP block (the real count is 31).

---

## Verification

```bash
npm ci
npm run lint
npm test                       # full suite
npm run test:coverage          # per-file table; confirm >= 90% lines
```

End-to-end against a throwaway database, per §12:

```bash
DB_PATH=/tmp/kejahub-verify.db PORT=3100 ADMIN_PASSWORD=admin123 npm start
```

Then walk the §12 manual checklist — it targets exactly the flows Phases 4 and 5
put at risk:

1. Upload several photos at once; confirm previews, and that removing one before
   submit does not shift the others.
2. Reorder photos by drag and by keyboard; set a different cover; save; confirm the
   order survives a reload.
3. Edit an **approved** listing's photos and confirm it stays `approved` and remains
   visible in student search (§10.4).
4. Delete a listing; confirm both the DB rows and the files are gone, and that a
   seeded listing pointing at `/images/background.jpg` is left untouched.
5. Every page that had inline handlers: devtools console must show **zero** CSP
   violations, and password toggles, delete confirmations, tab switches, and toasts
   must all still work.

CI is verified by opening a PR and confirming the `test` job fails when coverage is
dropped below 90% (temporarily delete a test file to prove the gate bites), then
passes when restored.
