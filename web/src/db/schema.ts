import {
  pgTable,
  serial,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  real,
} from "drizzle-orm/pg-core";

/** Language codes, e.g. grc / lat */
export const languages = pgTable("languages", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

/** Manuscript / edition metadata */
export const manuscripts = pgTable("manuscripts", {
  id: serial("id").primaryKey(),
  languageId: integer("language_id")
    .notNull()
    .references(() => languages.id),
  siglum: text("siglum").notNull(),
  name: text("name"),
  dating: text("dating"),
  notes: text("notes"),
  isBase: boolean("is_base").notNull().default(false),
}, (t) => [
  uniqueIndex("manuscripts_lang_siglum").on(t.languageId, t.siglum),
]);

/** Canonical verse catalog (CNTR-style vid: BBCCCVVV) */
export const verses = pgTable("verses", {
  id: serial("id").primaryKey(),
  vid: text("vid").notNull().unique(),
  bookNum: smallint("book_num").notNull(),
  bookAbbr: text("book_abbr").notNull(),
  chapter: smallint("chapter").notNull(),
  verse: smallint("verse").notNull(),
  ref: text("ref").notNull(),
}, (t) => [
  index("verses_book_chapter").on(t.bookNum, t.chapter),
]);

/**
 * Authoritative word stream per language.
 * Greek: surface = Classic from collation.ods; collationId = CollationId.
 * Apparatus (Pattern/Align/Span/…) stays out of the readable base text.
 */
export const baseWords = pgTable("base_words", {
  id: serial("id").primaryKey(),
  languageId: integer("language_id")
    .notNull()
    .references(() => languages.id),
  verseId: integer("verse_id")
    .notNull()
    .references(() => verses.id),
  wordIndex: integer("word_index").notNull(),
  surface: text("surface").notNull(),
  collationId: text("collation_id"),
  lexemeId: text("lexeme_id"),
  role: text("role"),
  morphology: text("morphology"),
}, (t) => [
  uniqueIndex("base_words_lang_verse_idx").on(t.languageId, t.verseId, t.wordIndex),
  index("base_words_collation").on(t.collationId),
]);

/** CNTR apparatus metadata for a Greek base word (not part of base text) */
export const greekApparatus = pgTable("greek_apparatus", {
  id: serial("id").primaryKey(),
  baseWordId: integer("base_word_id")
    .notNull()
    .references(() => baseWords.id)
    .unique(),
  pattern: text("pattern"),
  align: text("align"),
  span: text("span"),
  sic: text("sic"),
});

/**
 * Myers / LCS edit script reconstructing a manuscript verse from the
 * language base word stream. Ops are word-level JSON.
 */
export const manuscriptVerseDiffs = pgTable("manuscript_verse_diffs", {
  id: serial("id").primaryKey(),
  manuscriptId: integer("manuscript_id")
    .notNull()
    .references(() => manuscripts.id),
  verseId: integer("verse_id")
    .notNull()
    .references(() => verses.id),
  ops: jsonb("ops").notNull().$type<MyersOp[]>(),
}, (t) => [
  uniqueIndex("mss_verse_diff_unique").on(t.manuscriptId, t.verseId),
]);

export type MyersOp =
  | { op: "equal"; baseIndex: number; length: number }
  | { op: "delete"; baseIndex: number; length: number }
  | { op: "insert"; baseIndex: number; tokens: string[] }
  | { op: "replace"; baseIndex: number; length: number; tokens: string[] };

/**
 * Alignment session — visible to everyone.
 * Mutations (edit / delete) require `passwordHash` verification.
 * `clerkUserId` is retained for legacy rows; new sessions use "public".
 */
export const alignmentSessions = pgTable("alignment_sessions", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().default("public"),
  sourceLanguageId: integer("source_language_id")
    .notNull()
    .references(() => languages.id),
  targetLanguageId: integer("target_language_id")
    .notNull()
    .references(() => languages.id),
  status: text("status").notNull().default("open"),
  /** Unique session name (required for new sessions). */
  label: text("label").notNull(),
  /** Volunteer display name captured at session creation. */
  username: text("username").notNull(),
  /** scrypt salt:hash; required to modify or delete the session. */
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [
  index("sessions_user").on(t.clerkUserId),
  uniqueIndex("sessions_label_unique").on(t.label),
]);

/**
 * Verses explicitly submitted in a session (completion tracking).
 * Distinct from draft autosaves on `alignments`.
 */
export const sessionVerseSubmissions = pgTable(
  "session_verse_submissions",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => alignmentSessions.id, { onDelete: "cascade" }),
    verseId: integer("verse_id")
      .notNull()
      .references(() => verses.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("session_verse_submission_unique").on(t.sessionId, t.verseId),
    index("session_submissions_session").on(t.sessionId),
  ],
);

/**
 * Cross-language word links. Target is typically Greek (authoritative spine).
 * sessionId NULL = system seed (Aqua / bespoke / … keyed by sourceKey);
 * non-null = volunteer session edit (sourceKey unused).
 */
export const alignments = pgTable("alignments", {
  id: serial("id").primaryKey(),
  verseId: integer("verse_id")
    .notNull()
    .references(() => verses.id),
  sourceLanguageId: integer("source_language_id")
    .notNull()
    .references(() => languages.id),
  targetLanguageId: integer("target_language_id")
    .notNull()
    .references(() => languages.id),
  sourceWordIndex: integer("source_word_index").notNull(),
  targetWordIndex: integer("target_word_index").notNull(),
  score: real("score"),
  /** System baseline id, e.g. "aqua" | "bespoke". Null on session rows. */
  sourceKey: text("source_key"),
  sessionId: integer("session_id").references(() => alignmentSessions.id, {
    onDelete: "cascade",
  }),
  supersededById: integer("superseded_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("alignments_verse_langs").on(
    t.verseId,
    t.sourceLanguageId,
    t.targetLanguageId,
  ),
  index("alignments_session").on(t.sessionId),
  index("alignments_source_key").on(t.sourceKey),
]);
