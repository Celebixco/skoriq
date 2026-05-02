CREATE TYPE "public"."basketball_period_type" AS ENUM('q1', 'q2', 'q3', 'q4', 'overtime');--> statement-breakpoint
ALTER TYPE "public"."provider_entity_type" ADD VALUE 'football_match_score' BEFORE 'match_score';--> statement-breakpoint
ALTER TYPE "public"."provider_entity_type" ADD VALUE 'basketball_match_score' BEFORE 'match_score';--> statement-breakpoint
ALTER TYPE "public"."provider_entity_type" ADD VALUE 'basketball_period_score' BEFORE 'match_score';--> statement-breakpoint
CREATE TABLE "basketball_match_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"winner_team_id" uuid,
	"home_score_current" integer,
	"away_score_current" integer,
	"home_score_final" integer,
	"away_score_final" integer,
	"home_score_halftime" integer,
	"away_score_halftime" integer,
	"home_score_overtime" integer,
	"away_score_overtime" integer,
	"status" "match_status",
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "basketball_period_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"period_number" integer NOT NULL,
	"period_type" "basketball_period_type" NOT NULL,
	"overtime_number" integer,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "basketball_period_scores_match_period_uidx" UNIQUE NULLS NOT DISTINCT("match_id","period_type","period_number","overtime_number")
);
--> statement-breakpoint
CREATE TABLE "football_match_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"winner_team_id" uuid,
	"home_score_current" integer,
	"away_score_current" integer,
	"home_score_halftime" integer,
	"away_score_halftime" integer,
	"home_score_fulltime" integer,
	"away_score_fulltime" integer,
	"home_score_extra_time" integer,
	"away_score_extra_time" integer,
	"home_score_penalties" integer,
	"away_score_penalties" integer,
	"status" "match_status",
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "basketball_match_scores" ADD CONSTRAINT "basketball_match_scores_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_match_scores" ADD CONSTRAINT "basketball_match_scores_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_match_scores" ADD CONSTRAINT "basketball_match_scores_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_match_scores" ADD CONSTRAINT "basketball_match_scores_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_period_scores" ADD CONSTRAINT "basketball_period_scores_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_scores" ADD CONSTRAINT "football_match_scores_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_scores" ADD CONSTRAINT "football_match_scores_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_scores" ADD CONSTRAINT "football_match_scores_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_scores" ADD CONSTRAINT "football_match_scores_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "basketball_match_scores_match_uidx" ON "basketball_match_scores" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "basketball_match_scores_winner_idx" ON "basketball_match_scores" USING btree ("winner_team_id");--> statement-breakpoint
CREATE INDEX "basketball_period_scores_match_idx" ON "basketball_period_scores" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "basketball_period_scores_match_order_idx" ON "basketball_period_scores" USING btree ("match_id","period_number","overtime_number");--> statement-breakpoint
CREATE UNIQUE INDEX "football_match_scores_match_uidx" ON "football_match_scores" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_match_scores_winner_idx" ON "football_match_scores" USING btree ("winner_team_id");