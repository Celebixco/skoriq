CREATE TYPE "public"."football_prediction_conflict_severity" AS ENUM('blocking', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."football_prediction_consistency_status" AS ENUM('unchecked', 'passed', 'warning', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."football_prediction_family" AS ENUM('match_result', 'scoreline', 'total_goals', 'first_half_goals', 'both_teams_to_score', 'team_total_goals', 'double_chance', 'score_range');--> statement-breakpoint
CREATE TYPE "public"."football_prediction_risk_level" AS ENUM('low', 'medium', 'high', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."football_prediction_status" AS ENUM('draft', 'generated', 'member_visible', 'locked', 'settlement_pending', 'settled_success', 'settled_failed', 'settled_void', 'public_eligible', 'public_published', 'archived');--> statement-breakpoint
CREATE TABLE "football_prediction_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_output_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"conflict_type" text NOT NULL,
	"severity" "football_prediction_conflict_severity" NOT NULL,
	"source_prediction_type" text,
	"conflicting_prediction_type" text,
	"reason" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "football_prediction_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"feature_snapshot_id" uuid NOT NULL,
	"prediction_type" text NOT NULL,
	"prediction_value" text NOT NULL,
	"prediction_family" "football_prediction_family" NOT NULL,
	"confidence_score" numeric(5, 2),
	"confidence_ceiling" numeric(5, 2),
	"risk_level" "football_prediction_risk_level" DEFAULT 'unknown' NOT NULL,
	"status" "football_prediction_status" DEFAULT 'draft' NOT NULL,
	"consistency_status" "football_prediction_consistency_status" DEFAULT 'unchecked' NOT NULL,
	"consistency_checked_at" timestamp with time zone,
	"consistency_summary" text,
	"expectation_snapshot" jsonb,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"blocking_conflict_count" integer DEFAULT 0 NOT NULL,
	"warning_conflict_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"visible_to_members_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football_prediction_conflicts" ADD CONSTRAINT "football_prediction_conflicts_prediction_output_id_football_prediction_outputs_id_fk" FOREIGN KEY ("prediction_output_id") REFERENCES "public"."football_prediction_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_prediction_conflicts" ADD CONSTRAINT "football_prediction_conflicts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD CONSTRAINT "football_prediction_outputs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD CONSTRAINT "football_prediction_outputs_feature_snapshot_id_football_match_prediction_features_id_fk" FOREIGN KEY ("feature_snapshot_id") REFERENCES "public"."football_match_prediction_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "football_prediction_conflicts_prediction_output_idx" ON "football_prediction_conflicts" USING btree ("prediction_output_id");--> statement-breakpoint
CREATE INDEX "football_prediction_conflicts_match_idx" ON "football_prediction_conflicts" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_prediction_conflicts_severity_idx" ON "football_prediction_conflicts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "football_prediction_conflicts_type_idx" ON "football_prediction_conflicts" USING btree ("conflict_type");--> statement-breakpoint
CREATE UNIQUE INDEX "football_prediction_outputs_dedupe_key_uidx" ON "football_prediction_outputs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_match_idx" ON "football_prediction_outputs" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_feature_snapshot_idx" ON "football_prediction_outputs" USING btree ("feature_snapshot_id");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_status_idx" ON "football_prediction_outputs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_consistency_status_idx" ON "football_prediction_outputs" USING btree ("consistency_status");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_family_idx" ON "football_prediction_outputs" USING btree ("prediction_family");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_type_idx" ON "football_prediction_outputs" USING btree ("prediction_type");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_generated_at_idx" ON "football_prediction_outputs" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_visible_to_members_at_idx" ON "football_prediction_outputs" USING btree ("visible_to_members_at");