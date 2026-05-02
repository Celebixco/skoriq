ALTER TABLE "football_match_prediction_features" ADD COLUMN "expected_total_goals_proxy" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "expected_home_goals_proxy" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "expected_away_goals_proxy" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "home_goal_signal_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "away_goal_signal_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "first_half_goal_signal_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "btts_signal_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "goal_profile" text;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "first_half_goal_profile" text;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "btts_profile" text;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "home_team_goal_profile" text;--> statement-breakpoint
ALTER TABLE "football_match_prediction_features" ADD COLUMN "away_team_goal_profile" text;