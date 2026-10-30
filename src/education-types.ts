import type {
  EducationRow,
  EducationParticipant,
  EducationSnapshot,
} from "../server/education";
import type { EducationInput } from "../server/education-validation";
export type { EducationInput, EducationParticipant };
export type EducationSession = Omit<EducationRow, "body"> & {
  body: EducationInput;
};
export type EducationFull = EducationSession & {
  catalogSource:
    import("../server/education-catalog-source").CatalogProvenance | null;
  scheduledMinutes: number;
  participants: EducationParticipant[];
  successorId: string | null;
  snapshot: { body: EducationSnapshot; hash: string } | null;
};
