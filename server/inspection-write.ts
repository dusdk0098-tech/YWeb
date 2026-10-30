import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { InspectionBody } from "./inspection-validation.js";
// Caller owns transaction; shared only by inspection creation/return and explicit scheduled start.
export function createInspectionDraft(
  db: Db,
  site: string,
  templateId: string,
  snapshot: string,
  owner: string,
  body: InspectionBody,
  parent: string | null,
) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO inspections VALUES(?,?,?,?,?,?,?,'draft',1,NULL,NULL,?)",
  ).run(
    id,
    site,
    templateId,
    snapshot,
    owner,
    parent,
    JSON.stringify(body),
    new Date().toISOString(),
  );
  return id;
}
