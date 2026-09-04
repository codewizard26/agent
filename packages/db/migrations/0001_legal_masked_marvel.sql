CREATE TABLE IF NOT EXISTS "feed_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"ats_key" text,
	"slug_key" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location_raw" text NOT NULL,
	"remote" boolean DEFAULT false NOT NULL,
	"apply_url" text NOT NULL,
	"source_kind" text NOT NULL,
	"posted_at" timestamp with time zone,
	"date_fidelity" text NOT NULL,
	"score" integer,
	"tier" text,
	"why" text,
	"red_flags" jsonb,
	"sponsorship_gate" boolean DEFAULT false NOT NULL,
	"india_eligible" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feed_jobs" ADD CONSTRAINT "feed_jobs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feed_jobs_profile_slug_idx" ON "feed_jobs" USING btree ("profile_id","slug_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_jobs_profile_ats_idx" ON "feed_jobs" USING btree ("profile_id","ats_key");