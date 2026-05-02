CREATE TYPE "public"."football_team_form_scope" AS ENUM('overall', 'home', 'away');--> statement-breakpoint
CREATE TABLE "football_team_form_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"competition_id" uuid,
	"season_id" uuid,
	"as_of_match_id" uuid,
	"as_of_date" timestamp with time zone NOT NULL,
	"window_size" integer NOT NULL,
	"scope" "football_team_form_scope" NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"goals_for" integer DEFAULT 0 NOT NULL,
	"goals_against" integer DEFAULT 0 NOT NULL,
	"goal_difference" integer DEFAULT 0 NOT NULL,
	"avg_goals_for" numeric(8, 3),
	"avg_goals_against" numeric(8, 3),
	"clean_sheet_rate" numeric(5, 2),
	"failed_to_score_rate" numeric(5, 2),
	"both_teams_to_score_rate" numeric(5, 2),
	"over_1_5_rate" numeric(5, 2),
	"over_2_5_rate" numeric(5, 2),
	"over_3_5_rate" numeric(5, 2),
	"avg_shots" numeric(8, 3),
	"avg_shots_on_target" numeric(8, 3),
	"avg_possession_percent" numeric(5, 2),
	"avg_corners" numeric(8, 3),
	"avg_yellow_cards" numeric(8, 3),
	"avg_red_cards" numeric(8, 3),
	"avg_fouls" numeric(8, 3),
	"avg_expected_goals" numeric(8, 3),
	"avg_dangerous_attacks" numeric(8, 3),
	"standings_position" integer,
	"standings_points" integer,
	"standings_goal_difference" integer,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_team_form_features_uidx" UNIQUE NULLS NOT DISTINCT("team_id","competition_id","season_id","as_of_match_id","window_size","scope")
);
--> statement-breakpoint
ALTER TABLE "football_team_form_features" ADD CONSTRAINT "football_team_form_features_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_team_form_features" ADD CONSTRAINT "football_team_form_features_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_team_form_features" ADD CONSTRAINT "football_team_form_features_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_team_form_features" ADD CONSTRAINT "football_team_form_features_as_of_match_id_matches_id_fk" FOREIGN KEY ("as_of_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "football_team_form_features_team_idx" ON "football_team_form_features" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_team_form_features_competition_season_idx" ON "football_team_form_features" USING btree ("competition_id","season_id");--> statement-breakpoint
CREATE INDEX "football_team_form_features_as_of_match_idx" ON "football_team_form_features" USING btree ("as_of_match_id");--> statement-breakpoint
CREATE INDEX "football_team_form_features_team_competition_season_idx" ON "football_team_form_features" USING btree ("team_id","competition_id","season_id");--> statement-breakpoint
CREATE INDEX "football_team_form_features_updated_idx" ON "football_team_form_features" USING btree ("updated_at");