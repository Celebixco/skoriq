ALTER TABLE "football_rc_prematch_predictions" ADD COLUMN "competition_id" uuid;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_predictions" ADD COLUMN "evaluation_group" text DEFAULT 'multi_league_unassessed' NOT NULL;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_results" ADD COLUMN "competition_id" uuid;--> statement-breakpoint
UPDATE "football_rc_prematch_predictions" p SET "competition_id" = m."competition_id" FROM "matches" m WHERE m."id" = p."match_id";--> statement-breakpoint
UPDATE "football_rc_prematch_results" r SET "competition_id" = m."competition_id" FROM "matches" m WHERE m."id" = r."match_id";--> statement-breakpoint
UPDATE "football_rc_prematch_predictions" SET "evaluation_group" = 'stage12_1' WHERE "evaluation_group" = 'multi_league_unassessed';--> statement-breakpoint
ALTER TABLE "football_rc_prematch_predictions" ALTER COLUMN "competition_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_results" ALTER COLUMN "competition_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_predictions" ADD CONSTRAINT "football_rc_prematch_predictions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_rc_prematch_results" ADD CONSTRAINT "football_rc_prematch_results_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "football_rc_prematch_predictions_competition_idx" ON "football_rc_prematch_predictions" USING btree ("competition_id");
