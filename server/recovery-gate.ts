import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
export const RECOVERY_MARKER = "RECOVERY_REQUIRED.json";
export function assertRecoveryReady(databasePath: string) {
  let path = resolve(databasePath);
  try {
    path = realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let marked = false;
  try {
    lstatSync(join(dirname(path), RECOVERY_MARKER));
    marked = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (marked)
    throw new Error(
      "Restored database requires authorized credential recovery and secret rotation. Session purge alone is insufficient; do not remove the recovery marker merely to bypass this gate.",
    );
}
