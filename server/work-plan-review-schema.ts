import type { Db } from "./db.js";
// Schema fence is assigned only after Phase48 freeze; do not rewrite old archives.
export function createWorkPlanReviewTables(db:Db){db.exec(`
 CREATE TABLE work_plan_document_reviews(plan_id TEXT PRIMARY KEY REFERENCES work_plans(id),submission_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('submitted','accepted','returned')),version INTEGER NOT NULL,decision TEXT,submitted_at TEXT NOT NULL);
 CREATE TRIGGER work_plan_review_source_fixed BEFORE UPDATE ON work_plan_document_reviews WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.submission_hash IS NOT OLD.submission_hash OR NEW.submitted_at IS NOT OLD.submitted_at OR OLD.status<>'submitted' OR NEW.status NOT IN('accepted','returned') OR NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'Document review transition/source immutable'); END;
 CREATE TRIGGER work_plan_review_retained BEFORE DELETE ON work_plan_document_reviews BEGIN SELECT RAISE(ABORT,'Document review retained'); END;
 CREATE TABLE work_plan_review_events(id INTEGER PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES work_plans(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(plan_id,version));
 CREATE TRIGGER work_plan_review_event_fixed BEFORE UPDATE ON work_plan_review_events BEGIN SELECT RAISE(ABORT,'Document review history immutable'); END;
 CREATE TRIGGER work_plan_review_event_retained BEFORE DELETE ON work_plan_review_events BEGIN SELECT RAISE(ABORT,'Document review history retained'); END;
 `);}

export function migrateWorkPlanReview(db:Db){createWorkPlanReviewTables(db);db.exec("PRAGMA user_version=36");}
