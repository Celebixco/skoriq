CREATE TABLE "football_rc_prematch_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"prediction_generated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"prediction_cutoff_at" timestamp with time zone NOT NULL,
	"feature_as_of_at" timestamp with time zone NOT NULL,
	"actual_lead_seconds" integer NOT NULL,
	"p1" double precision NOT NULL,
	"px" double precision NOT NULL,
	"p2" double precision NOT NULL,
	"pick" text NOT NULL,
	"history_home_n" integer NOT NULL,
	"history_away_n" integer NOT NULL,
	"scope_level" text NOT NULL,
	"history_completeness" text DEFAULT 'unverified' NOT NULL,
	"feature_hash" text NOT NULL,
	"model_hash" text NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"supersedes_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "football_rc_prematch_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"home_score_90" integer,
	"away_score_90" integer,
	"normal_time_status" text NOT NULL,
	"result_label" text,
	"resolved_at" timestamp with time zone NOT NULL,
	"source_label" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football_rc_prematch_predictions" ADD CONSTRAINT "football_rc_prematch_predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_results" ADD CONSTRAINT "football_rc_prematch_results_prediction_id_football_rc_prematch_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."football_rc_prematch_predictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_results" ADD CONSTRAINT "football_rc_prematch_results_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "football_rc_prematch_predictions_version_uidx" ON "football_rc_prematch_predictions" USING btree ("match_id","model_id","model_version");--> statement-breakpoint
CREATE INDEX "football_rc_prematch_predictions_match_idx" ON "football_rc_prematch_predictions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_rc_prematch_predictions_kickoff_idx" ON "football_rc_prematch_predictions" USING btree ("kickoff_at");--> statement-breakpoint
CREATE INDEX "football_rc_prematch_predictions_published_idx" ON "football_rc_prematch_predictions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "football_rc_prematch_predictions_status_idx" ON "football_rc_prematch_predictions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "football_rc_prematch_results_prediction_uidx" ON "football_rc_prematch_results" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "football_rc_prematch_results_match_idx" ON "football_rc_prematch_results" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_rc_prematch_results_status_idx" ON "football_rc_prematch_results" USING btree ("normal_time_status");