CREATE TABLE "football_match_prediction_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"form_window_size" integer NOT NULL,
	"h2h_window_size" integer NOT NULL,
	"home_form_feature_id" uuid,
	"away_form_feature_id" uuid,
	"h2h_feature_id" uuid,
	"home_form_coverage_score" numeric(5, 2),
	"away_form_coverage_score" numeric(5, 2),
	"h2h_coverage_score" numeric(5, 2),
	"combined_coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"home_recent_points" integer,
	"away_recent_points" integer,
	"home_avg_goals_for" numeric(8, 3),
	"home_avg_goals_against" numeric(8, 3),
	"away_avg_goals_for" numeric(8, 3),
	"away_avg_goals_against" numeric(8, 3),
	"home_attack_strength_proxy" numeric(8, 3),
	"away_attack_strength_proxy" numeric(8, 3),
	"home_defense_strength_proxy" numeric(8, 3),
	"away_defense_strength_proxy" numeric(8, 3),
	"h2h_avg_total_goals" numeric(8, 3),
	"h2h_btts_rate" numeric(5, 2),
	"h2h_over_2_5_rate" numeric(5, 2),
	"standings_position_diff" integer,
	"standings_points_diff" integer,
	"standings_goal_difference_diff" integer,
	"feature_status" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_home_form_feature_id_football_team_form_features_id_fk" FOREIGN KEY ("home_form_feature_id") REFERENCES "public"."football_team_form_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_away_form_feature_id_football_team_form_features_id_fk" FOREIGN KEY ("away_form_feature_id") REFERENCES "public"."football_team_form_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD CONSTRAINT "football_match_prediction_features_h2h_feature_id_football_head_to_head_features_id_fk" FOREIGN KEY ("h2h_feature_id") REFERENCES "public"."football_head_to_head_features"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "football_match_prediction_features_match_windows_uidx" ON "football_match_prediction_features" USING btree ("match_id","form_window_size","h2h_window_size");--> statement-breakpoint
CREATE INDEX "football_match_prediction_features_match_idx" ON "football_match_prediction_features" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_match_prediction_features_competition_idx" ON "football_match_prediction_features" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "football_match_prediction_features_home_team_idx" ON "football_match_prediction_features" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "football_match_prediction_features_away_team_idx" ON "football_match_prediction_features" USING btree ("away_team_id");--> statement-breakpoint
CREATE INDEX "football_match_prediction_features_status_idx" ON "football_match_prediction_features" USING btree ("feature_status");--> statement-breakpoint
CREATE INDEX "football_match_prediction_features_updated_idx" ON "football_match_prediction_features" USING btree ("updated_at");