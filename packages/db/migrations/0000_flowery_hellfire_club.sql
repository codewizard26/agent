CREATE TABLE IF NOT EXISTS "answer_bank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"kind" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apply_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"ats_key" text,
	"slug_key" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"apply_url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"blocked_fields" jsonb,
	"fill_report" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"ats_key" text,
	"slug_key" text NOT NULL,
	"state" text NOT NULL,
	"company" text,
	"title" text,
	"apply_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_email" text NOT NULL,
	"resume_blob_url" text,
	"resume_text" text NOT NULL,
	"parsed_profile" jsonb,
	"posture" jsonb,
	"auto_submit_authorized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_bank" ADD CONSTRAINT "answer_bank_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "apply_tasks" ADD CONSTRAINT "apply_tasks_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_ledger" ADD CONSTRAINT "job_ledger_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_bank_profile_idx" ON "answer_bank" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_ledger_profile_ats_idx" ON "job_ledger" USING btree ("profile_id","ats_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_ledger_profile_slug_idx" ON "job_ledger" USING btree ("profile_id","slug_key");