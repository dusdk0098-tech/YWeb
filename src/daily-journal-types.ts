import type { dailyRecord, fullDaily } from "../server/daily-journal-model";
export type DailyListItem = ReturnType<typeof dailyRecord>;
export type DailyJournal = ReturnType<typeof fullDaily>;
export type { DailyBody } from "../server/daily-journal-validation";
