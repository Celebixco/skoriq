CREATE TYPE "public"."basketball_team_form_scope" AS ENUM('overall', 'home', 'away');--> statement-breakpoint
CREATE TABLE "basketball_team_form_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"competition_id" uuid,
	"season_id" uuid,
	"as_of_match_id" uuid,
	"as_of_date" timestamp with time zone NOT NULL,
	"window_size" integer NOT NULL,
	"scope" "basketball_team_form_scope" NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"points_for" integer DEFAULT 0 NOT NULL,
	"points_against" integer DEFAULT 0 NOT NULL,
	"point_difference" integer DEFAULT 0 NOT NULL,
	"avg_points_for" numeric(8, 3),
	"avg_points_against" numeric(8, 3),
	"avg_total_points" numeric(8, 3),
	"avg_margin" numeric(8, 3),
	"over_150_5_rate" numeric(5, 2),
	"over_160_5_rate" numeric(5, 2),
	"over_170_5_rate" numeric(5, 2),
	"over_180_5_rate" numeric(5, 2),
	"avg_q1_points_for" numeric(8, 3),
	"avg_q1_points_against" numeric(8, 3),
	"avg_first_half_points_for" numeric(8, 3),
	"avg_first_half_points_against" numeric(8, 3),
	"avg_second_half_points_for" numeric(8, 3),
	"avg_second_half_points_against" numeric(8, 3),
	"avg_q4_points_for" numeric(8, 3),
	"avg_q4_points_against" numeric(8, 3),
	"avg_field_goal_percent" numeric(5, 2),
	"avg_three_point_percent" numeric(5, 2),
	"avg_free_throw_percent" numeric(5, 2),
	"avg_rebounds_total" numeric(8, 3),
	"avg_rebounds_offensive" numeric(8, 3),
	"avg_rebounds_defensive" numeric(8, 3),
	"avg_assists" numeric(8, 3),
	"avg_steals" numeric(8, 3),
	"avg_blocks" numeric(8, 3),
	"avg_turnovers" numeric(8, 3),
	"avg_personal_fouls" numeric(8, 3),
	"avg_fast_break_points" numeric(8, 3),
	"avg_points_in_paint" numeric(8, 3),
	"avg_second_chance_points" numeric(8, 3),
	"avg_bench_points" numeric(8, 3),
	"standings_position" integer,
	"standings_win_percentage" numeric(5, 2),
	"standings_point_difference" integer,
	"standings_streak" text,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "basketball_team_form_features_uidx" UNIQUE NULLS NOT DISTINCT("team_id","competition_id","season_id","as_of_match_id","window_size","scope")
);
--> statement-breakpoint
ALTER TABLE "basketball_team_form_features" ADD CONSTRAINT "basketball_team_form_features_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_team_form_features" ADD CONSTRAINT "basketball_team_form_features_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_team_form_features" ADD CONSTRAINT "basketball_team_form_features_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_team_form_features" ADD CONSTRAINT "basketball_team_form_features_as_of_match_id_matches_id_fk" FOREIGN KEY ("as_of_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "basketball_team_form_features_team_idx" ON "basketball_team_form_features" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "basketball_team_form_features_competition_season_idx" ON "basketball_team_form_features" USING btree ("competition_id","season_id");--> statement-breakpoint
CREATE INDEX "basketball_team_form_features_as_of_match_idx" ON "basketball_team_form_features" USING btree ("as_of_match_id");--> statement-breakpoint
CREATE INDEX "basketball_team_form_features_team_competition_season_idx" ON "basketball_team_form_features" USING btree ("team_id","competition_id","season_id");--> statement-breakpoint
CREATE INDEX "basketball_team_form_features_updated_idx" ON "basketball_team_form_features" USING btree ("updated_at");