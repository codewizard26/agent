import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, index, uniqueIndex, } from "drizzle-orm/pg-core";
export const profiles = pgTable("profiles", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerEmail: text("owner_email").notNull(),
    resumeBlobUrl: text("resume_blob_url"),
    resumeText: text("resume_text").notNull(),
    parsedProfile: jsonb("parsed_profile"),
    posture: jsonb("posture"),
    autoSubmitAuthorized: boolean("auto_submit_authorized").notNull().default(false),
    /**
     * How far back the 4-hourly cron looks for this profile. NULL means "any",
     * the only window that also admits the undated sources (Ashby, Instahyre).
     * Per profile because a fresh graduate sees far fewer new postings per day
     * than a mid/senior engineer and needs a wider window to fill a board.
     */
    feedTimeFrameDays: integer("feed_time_frame_days").default(7),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const answerBank = pgTable("answer_bank", {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    kind: text("kind", { enum: ["text", "select", "boolean", "file"] }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byProfile: index("answer_bank_profile_idx").on(t.profileId) }));
export const jobLedger = pgTable("job_ledger", {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
    atsKey: text("ats_key"),
    slugKey: text("slug_key").notNull(),
    state: text("state", { enum: ["applied", "dismissed"] }).notNull(),
    company: text("company"),
    title: text("title"),
    applyUrl: text("apply_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    byProfileAts: index("job_ledger_profile_ats_idx").on(t.profileId, t.atsKey),
    byProfileSlug: index("job_ledger_profile_slug_idx").on(t.profileId, t.slugKey),
}));
export const applyTasks = pgTable("apply_tasks", {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
    atsKey: text("ats_key"),
    slugKey: text("slug_key").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    applyUrl: text("apply_url").notNull(),
    status: text("status", {
        enum: ["queued", "opening", "filling", "awaiting_human", "failed"],
    })
        .notNull()
        .default("queued"),
    blockedFields: jsonb("blocked_fields"),
    fillReport: jsonb("fill_report"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/**
 * The board's persisted feed, written by the 4-hour cron and by an on-demand
 * fetch. Deliberately holds no `descriptionText`: descriptions are the bulk of a
 * fetch's bytes and the card never renders them, so only what is shown (plus the
 * apply URL) is stored.
 */
export const feedJobs = pgTable("feed_jobs", {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
    atsKey: text("ats_key"),
    slugKey: text("slug_key").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    locationRaw: text("location_raw").notNull(),
    remote: boolean("remote").notNull().default(false),
    applyUrl: text("apply_url").notNull(),
    sourceKind: text("source_kind").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    dateFidelity: text("date_fidelity").notNull(),
    score: integer("score"),
    tier: text("tier"),
    why: text("why"),
    redFlags: jsonb("red_flags"),
    sponsorshipGate: boolean("sponsorship_gate").notNull().default(false),
    indiaEligible: boolean("india_eligible").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    bySlug: uniqueIndex("feed_jobs_profile_slug_idx").on(t.profileId, t.slugKey),
    byAts: index("feed_jobs_profile_ats_idx").on(t.profileId, t.atsKey),
}));
