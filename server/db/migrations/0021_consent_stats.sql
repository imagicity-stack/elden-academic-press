CREATE TABLE "consent_stats" (
	"day" date NOT NULL,
	"event" text NOT NULL,
	"device" text NOT NULL,
	"region" text NOT NULL,
	"channel" text NOT NULL,
	"page" text NOT NULL,
	"timing" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "consent_stats_day_event_device_region_channel_page_timing_pk" PRIMARY KEY("day","event","device","region","channel","page","timing")
);
