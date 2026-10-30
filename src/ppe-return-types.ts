import type { PpeRecord } from "./company-ppe-types";
import type { ReturnSnapshot } from "../server/ppe-return-ledger";
export type PpeReturnView={issue:PpeRecord;entries:ReturnSnapshot[];summary:{returnedQuantity:string;remainingQuantity:string;partialCount:number;terminal:boolean;partialLimit:number};itemVersion:number};
