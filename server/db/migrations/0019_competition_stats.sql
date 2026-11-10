CREATE TABLE "competition_stats" (
	"competition_slug" text NOT NULL,
	"day" date NOT NULL,
	"step" text NOT NULL,
	"channel" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "competition_stats_competition_slug_day_step_channel_pk" PRIMARY KEY("competition_slug","day","step","channel")
);
