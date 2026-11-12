# CNTR Alignment (web)

Volunteer Greek↔Latin alignment and manuscript variant browsing.

## Stack

- Next.js (App Router) on Vercel
- Neon Postgres via Drizzle ORM
- Session username + password for edit/delete

## Features (MVP B)

1. **Alignment sessions** — public list; create with a session name, username, and password. Mutations require the session password. Saves are scoped to a session and override Aqua/system seeds for that session only.
2. **Manuscript variants** — each language has one authoritative base word stream. Other manuscripts are reconstructed with Myers (LCS) ops against that base (not full duplicate texts).
3. **Greek base** — CNTR Classic surface forms (`surface` / `collation_id`). Apparatus fields (Pattern/Align/Span/…) live in `greek_apparatus`, not in the readable base.
4. **Latin base** — Stuttgart NT (`alignment_feature/files/latin.txt`).

## Local setup

```bash
cd web
cp .env.example .env.local
# fill DATABASE_URL

npm install
npm run db:push          # apply schema to Neon
npm run db:seed          # verses, base words, demo variant, Aqua seeds
npm run dev
```

Open http://localhost:3000 — use **Align** or **Variants**.

## Seed inputs

| Data | Source |
|------|--------|
| Verse catalog | `alignment_feature/files/vref_ids.txt` + `ntvref.txt` |
| Greek words | `alignment_feature/files/greek.txt` (Classic surfaces; collation IDs derived as `vid` + word#) |
| Latin words | `alignment_feature/files/latin.txt` |
| System alignments | `web/data/alignments/` (Aqua default + bespoke option files) |
| Demo MSS ops | Synthetic `DEMO` witness on Matt 1:1 |

Full `base_files/collation.ods` import (Role/Morphology/LexemeId + apparatus) can be layered on later; the seed currently uses the parallel line files which match Classic surfaces.

## Vercel

1. Create a Vercel project pointing at `web/` (Root Directory = `web`).
2. Add `DATABASE_URL` (and related Neon vars if needed).
3. Deploy. Run `db:push` / `db:seed` once against the Neon URL (locally or a one-off job).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local Next.js |
| `npm run db:push` | Push Drizzle schema |
| `npm run db:seed` | Import base data |
| `npm run db:studio` | Drizzle Studio |
