export type { Company } from "../server/companies";
import type { workerCompany } from "../server/companies";
export type WorkerCompany = ReturnType<typeof workerCompany>;
export type { PpeRecord } from "../server/ppe";
