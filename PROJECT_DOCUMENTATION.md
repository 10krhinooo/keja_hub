# KejaHub Project Documentation

Internal reference covering architecture, data model, request flows, security
posture, and known risks. `README.md` is the public-facing document.

Last updated: 2026-08-03

---

## 1. What this is

KejaHub is a student housing marketplace for the Kenyan market. It connects
university students looking for accommodation with landlords listing rental
properties near campus.

Three roles, each with a separate area of the app:

| Role         | Can do                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------- |
| **Student**  | Browse and search approved listings, request viewings or bookings, leave reviews, report listings  |
| **Landlord** | Create and edit listings, manage listing photos, accept or decline booking requests                |
| **Admin**    | Approve, reject, or delete listings; activate or deactivate users; resolve reports; view analytics |

A listing is reviewed by an admin exactly once, when it is created. After
approval, the landlord can edit it freely and changes go live immediately.

---

## 2. Stack and why

| Layer     | Choice                                      | Notes                                              |
| --------- | ------------------------------------------- | -------------------------------------------------- |
| Runtime   | Node.js 18+                                 | `engines` field in `package.json`                  |
| Framework | Express 5                                   | Note the breaking changes listed in section 10     |
| Views     | EJS, server-rendered                        | No SPA, no build step, no bundler                  |
| Client JS | Vanilla, plain `<script>` tags              | No framework, no transpilation                     |
| Database  | SQLite via `better-sqlite3`                 | Synchronous native binding, writes through to disk |
| Sessions  | `session-file-store`                        | File-backed, survives restarts                     |
| Auth      | `express-session` + `bcryptjs`              | Cookie sessions, no JWT                            |
| Uploads   | `multer`, disk storage                      | Files under `uploads/houses/`                      |
| Email     | `nodemailer` over Gmail SMTP                | Password reset only                                |
| Security  | `helmet`, `express-rate-limit`, custom CSRF | See section 7                                      |
| Logging   | `backend/utils/logger.js`, structured JSON  | See section 9                                      |

node:test + supertest + jsdom, eslint + prettier, and a three-job GitHub
Actions CI (lint, test matrix, `npm audit`). See "Testing, linting, CI" below.

### The better-sqlite3 decision

The app previously ran on `sql.js` (SQLite compiled to WebAssembly), which held
the entire database in process memory and periodically exported the whole file
to disk. That had three real costs: the app could only ever run as a single
process, every save rewrote the whole file rather than just changed pages, and
there were no real transactions, so a throw partway through a multi-table write
(listing delete, listing edit) could leave partial state.

`better-sqlite3` is a synchronous native binding to SQLite. It writes through to
disk on every statement (`saveDB()` no longer exists; there is nothing to
flush), supports `db.transaction(fn)` for real rollback, and is the reference
synchronous SQLite driver for Node. `initDB()` opens the file with
`journal_mode = WAL` and `foreign_keys = ON`.

The multi-table writes in `landlordController.js` (add/edit house) and both
delete handlers (`landlordController.js`, `adminController.js`) are wrapped in
`db.transaction(...)`, so a failure partway through no longer leaves a listing
with, say, its row updated but its amenities half-written.

Because writes still land in a single SQLite file, the app should still run as
**one process** — that has not changed. Postgres is the step to take if this
needs to be genuinely clustered or scaled beyond one node.

If you switch Node versions locally and hit a native-binding load error,
rebuild the module for the active Node version:

```bash
npm rebuild better-sqlite3
```

### Testing, linting, CI

```bash
npm test              # node --test --experimental-test-coverage
npm run lint           # eslint
npm run format:check   # prettier --check
```

`.github/workflows/ci.yml` runs three jobs on every push/PR against `main`:
`lint` (eslint + prettier --check), `test` (matrix on Node 22 and 24, gated at
`--test-coverage-lines=90 --test-coverage-branches=75`), and `audit` (`npm
audit --audit-level=high`). `package.json` requires Node >= 22.

Each test file runs in its own isolated process (Node's default `--test-isolation=process`),
so state set at module scope in one file (e.g. `tests/helpers/app.js` setting
`process.env.NODE_ENV = 'test'`) is **not** visible to a test file that never
requires it. A test asserting on `NODE_ENV`-gated behaviour must set that env
var itself rather than assume another file already did — this bit
`tests/unit/logger.test.js` once (fixed 2026-08-03).

---

## 3. Directory layout

```text
kejahub/
  backend/
    index.js               App bootstrap: middleware order, error handling, shutdown
    database.js             Base schema, indexes, seed data; calls migrations/runMigrations
    migrations/             Versioned schema migrations, tracked in schema_migrations
    controllers/
      authController.js    Register, login, logout, password reset, email verification
      studentController.js Dashboard, search, house detail, bookings, reviews, reports
      landlordController.js Listing CRUD, photo management, booking responses
      adminController.js   Moderation, user management, landlord verification, reports, analytics
    middleware/
      auth.js              requireLogin, requireRole, requireVerified
      csrf.js              csrfProtection (global), csrfVerify (multipart routes)
      upload.js            Multer config
      noCache.js           no-store headers for authenticated areas
    routes/                One router per role, plus authRoutes
    utils/
      validateHouse.js     Server-side listing validation, amenity whitelist
      houseImages.js       Photo order, cover, cap, safe file deletion
      mailer.js            Gmail SMTP transport: reset, verification, booking emails
      logger.js            Structured JSON logging, request-id middleware, quiet-under-test gate
  frontend/
    public/css/style.css   Single stylesheet, design tokens at the top
    public/js/             toast.js, validation.js, photo-manager.js, lightbox.js,
                           skeleton.js, dates.js
    views/                 EJS templates grouped by role, plus partials
  uploads/houses/          Runtime, gitignored
  .sessions/               Runtime, gitignored
```

---

## 4. Data model

All tables live in `backend/database.js`. There is no ORM; every query is
hand-written SQL executed through `db.prepare()` / `db.run()` / `db.exec()`.

```text
users
  id, name, email (UNIQUE), password (bcrypt), role, is_active, created_at,
  email_verified (added by migration 005, default 0)
  role is one of: student | landlord | admin

student_profiles     user_id (UNIQUE) -> users.id, phone, university, course, profile_photo
landlord_profiles    user_id (UNIQUE) -> users.id, phone, id_number, profile_photo, is_verified

houses
  id, landlord_id -> users.id, title, description, rent, location, estate,
  bedrooms, bathrooms, status, is_available, created_at, rejection_reason
  status is one of: pending | approved | rejected

house_images         id, house_id -> houses.id, image_path, is_primary, sort_order, thumbnail_path
amenities            id, house_id -> houses.id, name
bookings             id, house_id, student_id, type, status, message, visit_date, created_at
                     type: viewing | booking     status: pending | accepted | declined
reviews              id, house_id, student_id, rating (1 to 5), comment, created_at
reports              id, house_id, reported_by, reason, status (open | resolved), created_at
password_resets      id (uuid), user_id, token (sha256 hex, UNIQUE), expires_at (epoch ms)
email_verifications  id, user_id, token, expires_at — same shape as password_resets
schema_migrations    version (PRIMARY KEY), applied_at — tracks the migration runner, see Migrations below
```

`landlord_profiles.is_verified` is toggled by an admin at
`POST /admin/users/:id/verify` (`adminController.toggleVerified`) and shown on
the admin users list and the student house-detail page (a "✓ Verified" badge
next to the landlord's name). It is purely informational — it does not gate
any action.

### Indexes

```text
idx_house_images_house   house_images(house_id)
idx_amenities_house      amenities(house_id)
idx_bookings_house       bookings(house_id)
idx_bookings_student     bookings(student_id)
idx_reviews_house        reviews(house_id)
idx_reports_house        reports(house_id)
idx_houses_landlord      houses(landlord_id)
idx_houses_status        houses(status, is_available)
```

### Foreign keys have no ON DELETE behaviour

`PRAGMA foreign_keys = ON` is set, but no constraint declares `ON DELETE
CASCADE`. Every delete handler must therefore clean up child rows manually.
Both delete paths (`landlordController.deleteHouse` and
`adminController.deleteHouse`) remove bookings, reviews, reports, amenities,
and images before deleting the house. **If you add a table referencing
`houses`, you must update both handlers.**

### Migrations

`backend/migrations/` holds one file per version — `001_initial_schema.js`
through `005_email_verification.js` — each exporting `{ version, up(db) }`.
`backend/migrations/index.js` exports `runMigrations(db)`, called from
`initDB()` in `database.js`:

1. Creates `schema_migrations(version INTEGER PRIMARY KEY, applied_at)` if
   missing.
2. Reads which versions are already recorded.
3. Runs every unapplied migration's `up(db)` in ascending version order, each
   wrapped in `db.transaction(...)`, then records the version.

`001` uses `CREATE TABLE/INDEX IF NOT EXISTS` so it can both bootstrap a fresh
database and no-op on an existing one. `002`–`005` still wrap their `ALTER
TABLE` in try/catch as a second safety net for databases that predate the
runner itself. There is **no `down()`** — only forward migrations. Add a new
migration by creating `00N_description.js` and adding it to the array in
`migrations/index.js`; do not edit a migration that has already shipped.

---

## 5. Request lifecycle

Middleware order in `backend/index.js` is load-bearing. From top to bottom:

1. **Production guards.** If `NODE_ENV=production`, `trust proxy` is enabled and
   startup throws unless `APP_URL`, `SMTP_USER`, and `SMTP_PASS` are set.
2. **helmet.** CSP and security headers.
3. **`logger.requestId`.** Attaches `req.id` (a uuid) before anything else runs,
   so every log line from a request — including the error handler's — can be
   correlated. Not exposed to the client; there is no `X-Request-Id` response
   header.
4. **Static files.** `frontend/public` at `/`, `uploads/` at `/uploads`.
5. **Body parsers.** `express.json`, `express.urlencoded`. Note: these do _not_
   parse multipart, which is why CSRF needs special handling.
6. **Session.** File-backed store, `httpOnly`, `sameSite=lax`, `secure` in
   production.
7. **`res.locals.user`.** Makes the session user available to every template.
8. **Rate limiter.** Applies to POSTs on the four auth routes. Deliberately
   placed _before_ CSRF so a flood of bogus-token requests is also throttled.
9. **CSRF.** See section 7.
10. **`/healthz`.**
11. **Routers.** authRoutes at `/`, then student, landlord, admin — student and
    landlord additionally gated behind `requireVerified` — each wrapped in
    `noCache`.
12. **404 handler**, then the **error handler**, which logs via
    `logger.error('Unhandled error', { req, err })`.

### Authorization

`requireRole('landlord')` is applied once at the top of each role router, so
every route beneath it is protected by default. `requireLogin` additionally
re-reads `is_active` from the database on **every** request, so deactivating a
user takes effect immediately rather than when their session expires.

Student and landlord routers additionally apply `requireVerified` right after
`requireRole`. It redirects to `/verify-email/pending` if `email_verified` is
falsy. Login itself also redirects an unverified user straight to that page
rather than their dashboard, so the gate is enforced at both entry points, not
just route access. Admin routes have no such gate.

### Ownership checks

There is no `isOwner` middleware. Ownership is enforced inline by scoping every
query:

```js
SELECT * FROM houses WHERE id = ? AND landlord_id = ?
```

**Any new landlord route must repeat this pattern.** Omitting it produces an
IDOR where one landlord can act on another's listing by guessing an id.

---

## 6. Listing photos

This is the most intricate part of the codebase. Read this before changing it.

### Model

- `house_images.sort_order` controls display order.
- `house_images.is_primary` flags the cover photo.
- The two are independent: setting a cover does not move the photo.

Every place a cover is selected uses:

```sql
ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1
```

This is **self-healing**. If the flagged primary is deleted, the query falls
back to the first photo by sort order, so a listing can never lose its
thumbnail. Before this, deleting the cover left listings with a permanently
blank image across search, dashboards, and bookings.

### One endpoint, not many

All photo operations happen in a single multipart POST to
`/landlord/house/:id/edit`. There are deliberately **no** granular image
endpoints. Reasons:

- Every new route is a new place to forget the `AND landlord_id = ?` guard.
- Multipart requests bypass the global CSRF check (see section 7), so each new
  multipart route is a new place to forget `csrfVerify`.

Form fields:

| Field           | Type       | Meaning                              |
| --------------- | ---------- | ------------------------------------ |
| `images`        | file[]     | New uploads                          |
| `delete_images` | checkbox[] | Image ids to remove                  |
| `primary_image` | radio      | Image id to make cover               |
| `image_order`   | hidden     | Comma-separated ids in display order |

### Order of operations in `editHouse`

The sequence matters. Changing it will introduce bugs.

1. Parse and validate the house id, then load the house scoped by `landlord_id`.
2. Validate listing fields via `validateHouseInput`.
3. Filter `delete_images` down to ids that actually belong to this house.
4. Compute `finalCount = existing - deleted + uploaded` and reject if it exceeds
   `MAX_IMAGES_PER_HOUSE`.
5. On any validation failure: **delete the uploaded files** and re-render.
6. Update the house row. Status only changes if it was `rejected`.
7. Replace amenities (delete all, reinsert).
8. Delete removed images: read paths first, delete rows, then unlink files.
9. Insert new images with `sort_order` continuing past the current max.
10. Apply `image_order`, filtered to owned ids, excluding just-deleted ones.
11. Call `normalizePrimary` to guarantee exactly one cover.
12. `saveDB()` and redirect.

### Multer writes before the handler runs

This is the single easiest thing to get wrong. By the time `editHouse` or
`addHouse` executes, multer has **already written the uploaded files to disk**.
Every early return therefore leaks files unless it calls
`deleteUploadedFiles(req.files)` first. All current exit paths do.

### Path traversal guard

`houseImages.resolveUploadPath` resolves an `image_path` and returns `null`
unless the result is inside `uploads/`. This matters because seeded listings
point at `/images/background.jpg`, a static asset that must never be unlinked,
and because `image_path` is data rather than a literal.

### Client behaviour

`frontend/public/js/photo-manager.js` handles the browser side:

- Dropzone with drag-and-drop plus click-to-browse.
- Per-file removal before submit. A `FileList` is read-only, so removal works by
  rebuilding a `DataTransfer` and reassigning `input.files`.
- Client-side type and size rejection so users learn about problems before a
  round trip. This is a convenience, not a control: the server re-checks.
- Reordering by drag, **and** by left/right buttons. Drag-and-drop alone is
  unusable by keyboard and unreliable on touch.
- Deleting a photo disables its cover radio and moves the cover elsewhere.

---

## 7. Security

### CSRF, and the multipart trap

`middleware/csrf.js` issues a per-session token and validates it on POST, PUT,
PATCH, and DELETE. **Multipart requests are skipped entirely**, because the body
is not parsed yet when the global middleware runs.

Multipart routes must therefore be wired in this exact order:

```js
router.post('/house/:id/edit', upload.array('images', 10), csrfVerify, editHouse);
```

If `csrfVerify` is omitted, that route silently has **no CSRF protection at
all**. This is the most dangerous footgun in the codebase.

### Password reset

- Tokens are 32 random bytes, delivered only in the emailed link.
- The database stores **sha256(token)**, so a database leak cannot be replayed.
- Single use: the row is deleted when the password is changed.
- One hour expiry, plus opportunistic cleanup of expired rows.
- The response is identical whether or not the address exists, so the form
  cannot be used to enumerate accounts.
- The reset link is built from `APP_URL`, never from the `Host` header. Trusting
  `Host` would let an attacker send `Host: evil.com` and receive a working reset
  link for someone else's account. `APP_URL` is mandatory in production and the
  app refuses to start without it.
- If email delivery fails in production, the token is **not** shown in the page.
  The dev fallback that surfaces the link is gated on `NODE_ENV !== 'production'`.

### Other controls

- **Rate limiting.** 20 POSTs per 15 minutes per IP across the auth routes,
  successful requests not counted. bcrypt is intentionally expensive, so
  unthrottled login POSTs are both a credential-stuffing surface and a cheap
  CPU exhaustion vector.
- **Email normalisation.** Addresses are lowercased and trimmed on register,
  login, and reset. SQLite comparison is case-sensitive, so without this
  `Bob@x.com` and `bob@x.com` become separate accounts.
- **Generic auth errors.** Unknown email and wrong password return the same
  message.
- **Server-side validation.** `validateHouse.js` re-checks everything the client
  checks. The client rules in `validation.js` are HTML attributes and are
  trivially bypassed by a direct POST.
- **Seed gating.** Demo accounts share one password, set via `SEED_PASSWORD` (a
  random one is generated and printed if unset). They are never seeded when
  `NODE_ENV=production` unless `SEED=true` is set explicitly.
- **Upload restrictions.** 5 MB per file, `jpeg`/`png`/`webp` only, checked by
  both extension and mimetype.

### CSP caveat

Every inline `<script>` block and inline event handler has been moved to
`frontend/public/js/*.js`, wired up through `data-*` attributes rather than
`onclick`/`onsubmit`. `scriptSrc` no longer allows `'unsafe-inline'` and
`scriptSrcAttr` is at helmet's default of `'none'`.

`styleSrc` still allows `'unsafe-inline'`, for the inline `style="..."`
attributes used throughout the views (see §11 Low). That is the remaining
hardening step.

---

## 8. Email

`backend/utils/mailer.js` wraps nodemailer with a Gmail SMTP transport and
exports four send functions:

| Function                  | Sent to             | Triggered by                              |
| ------------------------- | ------------------- | ----------------------------------------- |
| `sendPasswordResetEmail`  | The requesting user | Forgot-password flow                      |
| `sendVerificationEmail`   | The new registrant  | Registration, and the resend endpoint     |
| `sendBookingRequestEmail` | The landlord        | Student submits a viewing/booking request |
| `sendBookingStatusEmail`  | The student         | Landlord accepts or declines a request    |

Setup requires 2-Step Verification on the sending Google account and a
16-character App Password from <https://myaccount.google.com/apppasswords>. A
normal account password is rejected by Gmail. The spaced `abcd efgh ijkl mnop`
format Google displays is accepted as-is.

With `SMTP_PASS` unset, `sendMail` logs the message to the console and returns
`{ delivered: false }`. That keeps local development working without
credentials, and is the only situation where a reset or verification link is
shown in the UI.

The templates are intentionally old-fashioned HTML: table-based layout,
inlined hex colours, no CSS variables, no flexbox or grid. Mail clients strip
`<style>` blocks and Outlook does not support modern layout. Colours mirror the
tokens in `style.css` (`--forest #1B4332`, `--cream #FFFDF5`, `--leaf #52B788`).

All interpolated values pass through `escapeHtml`.

---

## 9. Operations

| Concern      | Behaviour                                                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health check | `GET /healthz` returns `{"status":"ok","uptime":N}`                                                                                                                                                                                            |
| Persistence  | Writes through to disk on every statement via `better-sqlite3`; nothing to flush                                                                                                                                                               |
| Shutdown     | `SIGTERM` and `SIGINT` stop the listener, close the database handle, then exit. 8 second hard timeout                                                                                                                                          |
| Logging      | Structured JSON via `backend/utils/logger.js` (`info`/`warn`/`error`), correlated by per-request `req.id`. Silent under `NODE_ENV=test`. `resolveSeedPassword`'s one-time local dev credential print in `database.js` deliberately bypasses it |
| Sessions     | Files under `.sessions/`, 7 day TTL                                                                                                                                                                                                            |

### Deployment requirements

`uploads/`, `.sessions/`, and the `.db` file all need **persistent storage**. On
an ephemeral host (Heroku, Render, Fly) they are wiped on every deploy, which
means every listing photo silently disappears. Either mount a volume or move
uploads to S3 or Cloudinary.

The app writes to a single SQLite file on disk, so still run **exactly one
instance**.

---

## 10. Traps and gotchas

Things that have already caused bugs, or will.

1. **`res.redirect('back')` does not work.** Express 5 removed the `'back'`
   magic string. It now redirects to a literal relative path called `back`.
   Use `req.get('Referer')` with a fallback.
2. **Multipart bypasses global CSRF.** Every multipart route needs an explicit
   `csrfVerify` after multer.
3. **Multer writes files before your handler runs.** Clean up on every early
   return.
4. **Editing a listing used to reset it to `pending`.** Since students only see
   `approved` listings, any photo change made the listing vanish from search
   entirely. Admin review now happens once at creation; only a `rejected`
   listing returns to `pending` on edit.
5. **The admin password is only applied at database creation.** Changing
   `ADMIN_PASSWORD` in `.env` afterwards has no effect on an existing
   `kejahub.db`.
6. **`Toast.msg(key)` used to fall back to the raw key**, so a typo displayed
   `listing_not_found` to a user. It now falls back to a generic message. Add
   new keys to `TOAST_MESSAGES` in `frontend/public/js/toast.js`.
7. **Foreign keys do not cascade.** Adding a table that references `houses`
   means updating both delete handlers.
8. ~~**No transactions.**~~ Fixed by the `better-sqlite3` migration: the
   multi-table writes in `addHouse`/`editHouse` and both `deleteHouse` handlers
   are wrapped in `db.transaction(...)`, so a throw partway through rolls back
   instead of leaving partial state.
9. **Two listeners can bind the same port** on IPv4 and IPv6 separately. If an
   unrelated service holds `0.0.0.0:3000`, Node may bind `[::]:3000` and appear
   to start correctly while requests reach the other process. Test with an
   explicit `127.0.0.1:PORT`.
10. **A test can't assume another test file already set `process.env`.** Each
    file under `node --test` runs in its own process; module-scope side
    effects like `tests/helpers/app.js` setting `NODE_ENV=test` only apply to
    files that require it. See "Testing, linting, CI" in section 2.
11. **Editing a shipped migration is a no-op for existing databases.** Once a
    version is recorded in `schema_migrations`, `runMigrations` never runs it
    again. Ship a new migration file instead of changing an old one.

---

## 11. Known limitations and backlog

Ordered roughly by value.

### High

- ~~Inline event handlers force a permissive CSP.~~ Done: every handler moved
  to `addEventListener` in `frontend/public/js/*.js`. `styleSrc` still allows
  inline styles (see Low).
- ~~No automated tests at all.~~ Done: 417 tests, ~95% line coverage, gated
  in CI at 90% lines / 75% branches.
- ~~Single-process sql.js ceiling.~~ Done: migrated to `better-sqlite3`. See
  section 2. Still a single-instance app (one SQLite file), which is
  unchanged and separate from the sql.js-specific limitations this closed.
- ~~Uploads on local disk.~~ Done: `backend/storage/` picks local or S3-compatible
  storage via `STORAGE_DRIVER`; the app itself defaults to local, so an
  ephemeral host still needs `STORAGE_DRIVER=s3` set explicitly.

### Medium

- ~~No structured logging, no error tracking, no metrics.~~ Structured JSON
  logging done (see section 8/9). No error tracking or metrics still.
- Partial pagination. Student search (12/page), admin users (15/page), admin
  listings, admin bookings (20/page), and house reviews (10/page) are
  paginated. Admin reports and the landlord dashboard still return every row.
- ~~No email verification on registration, and no booking notification
  emails.~~ Done: registration gates on `email_verified` via `requireVerified`;
  booking requests notify the landlord, accept/decline notifies the student.
- ~~No image resizing or compression.~~ Done: `backend/utils/imageProcessing.js`
  re-encodes every upload to webp (long edge capped, quality 80) plus a 400px
  thumbnail, via `sharp`.
- ~~Landlord `is_verified` exists in the schema but is never surfaced or
  used.~~ Done: admin can toggle it, shown as a badge on the student
  house-detail page. Still purely informational, gates nothing.

### Low

- ~~No linter or formatter, so style drifts between files.~~ Done: eslint +
  prettier, enforced in CI.
- Inline styles are heavily used in templates alongside the stylesheet.
  `student/house-detail.ejs` was converted to utility classes; most other
  views, including `admin/house-detail.ejs`, were not.
- ~~`firstRow` and `rowsToObjects` in `database.js` are partially unused.~~
  Removed: `better-sqlite3`'s `.get()`/`.all()` already return plain objects,
  so the helpers were redundant.
- ~~No versioned migrations or down-migrations.~~ Versioned migrations done
  (see section 4/2). Still no down-migrations.

---

## 12. Local development

```bash
npm install
cp .env.example .env      # then fill in SESSION_SECRET and ADMIN_PASSWORD
npm run dev               # auto-restart, or npm start
```

Demo accounts (development only, never seeded in production):

| Role     | Email                | Password                                 |
| -------- | -------------------- | ---------------------------------------- |
| Student  | `brian@student.com`  | `password123`                            |
| Landlord | `james@landlord.com` | `password123`                            |
| Admin    | `admin@kejahub.com`  | value of `ADMIN_PASSWORD` at DB creation |

### Working with a throwaway database

Point `DB_PATH` somewhere temporary to avoid touching your working data:

```bash
DB_PATH=/tmp/test.db PORT=3100 ADMIN_PASSWORD=admin123 npm start
```

This is the recommended way to test admin flows, seeding behaviour, and
migrations.

### Manual verification checklist

The flows most likely to regress:

1. Upload several photos at once; confirm previews and that removing one before
   submitting actually excludes it.
2. Reorder photos and set a different cover; reload and confirm both persisted.
3. As a student, view an approved listing. As its landlord, change the photos.
   Reload as the student: the listing must **still be visible** with the new
   photos.
4. Delete the cover photo without choosing a new one; confirm a thumbnail still
   appears everywhere.
5. Exceed 10 photos; confirm a clear error and that `uploads/houses/` gained no
   files.
6. POST directly with `rent=-5` and a 2-character title; confirm rejection.
7. As landlord A, submit image ids belonging to landlord B; confirm they are
   ignored and B's photos are untouched.
8. Delete a listing as admin; confirm its files leave `uploads/houses/`.
9. `kill -TERM` the server; confirm it logs the flush and exits cleanly.
