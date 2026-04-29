CREATE TYPE "public"."ai_job_event_level" AS ENUM('info', 'warn', 'error');
--> statement-breakpoint
CREATE TABLE "ai_job_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "attempt_number" integer DEFAULT 0 NOT NULL,
  "level" "ai_job_event_level" DEFAULT 'info' NOT NULL,
  "event_type" text NOT NULL,
  "message" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_job_events"
ADD CONSTRAINT "ai_job_events_job_id_ai_jobs_id_fk"
FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id")
ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ai_job_events_job_attempt_idx"
ON "ai_job_events" USING btree ("job_id", "attempt_number", "created_at");
