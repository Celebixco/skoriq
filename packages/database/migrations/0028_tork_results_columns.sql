ALTER TABLE "football_tork_prematch_results" ADD COLUMN "home_score_fulltime" integer;--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" ADD COLUMN "away_score_fulltime" integer;--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" ADD COLUMN "btts_outcome" integer;--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" ADD COLUMN "fulltime_status" text;--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" ALTER COLUMN "fulltime_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" DROP COLUMN IF EXISTS "home_score_halftime";--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" DROP COLUMN IF EXISTS "away_score_halftime";--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" DROP COLUMN IF EXISTS "h1_goals";--> statement-breakpoint
ALTER TABLE "football_tork_prematch_results" DROP COLUMN IF EXISTS "halftime_status";
