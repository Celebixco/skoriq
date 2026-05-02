CREATE TYPE "public"."public_successful_prediction_status" AS ENUM('draft', 'published', 'hidden');--> statement-breakpoint
CREATE TABLE "public_successful_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_output_id" uuid NOT NULL,
	"public_title" text NOT NULL,
	"public_summary" text NOT NULL,
	"public_visible_at" timestamp with time zone,
	"display_order" integer,
	"is_featured" boolean DEFAULT false NOT NULL,
	"status" "public_successful_prediction_status" DEFAULT 'draft' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "public_eligible_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "public_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "public_excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "public_exclusion_reason" text;--> statement-breakpoint
ALTER TABLE "public_successful_predictions" ADD CONSTRAINT "public_successful_predictions_prediction_output_id_football_prediction_outputs_id_fk" FOREIGN KEY ("prediction_output_id") REFERENCES "public"."football_prediction_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_successful_predictions_prediction_output_uidx" ON "public_successful_predictions" USING btree ("prediction_output_id");--> statement-breakpoint
CREATE INDEX "public_successful_predictions_prediction_output_idx" ON "public_successful_predictions" USING btree ("prediction_output_id");--> statement-breakpoint
CREATE INDEX "public_successful_predictions_status_idx" ON "public_successful_predictions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "public_successful_predictions_visible_at_idx" ON "public_successful_predictions" USING btree ("public_visible_at");--> statement-breakpoint
CREATE INDEX "public_successful_predictions_featured_idx" ON "public_successful_predictions" USING btree ("is_featured");--> statement-breakpoint
CREATE INDEX "public_successful_predictions_display_order_idx" ON "public_successful_predictions" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_public_eligible_at_idx" ON "football_prediction_outputs" USING btree ("public_eligible_at");--> statement-breakpoint
CREATE INDEX "football_prediction_outputs_public_published_at_idx" ON "football_prediction_outputs" USING btree ("public_published_at");