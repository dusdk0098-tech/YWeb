export type {
  NoticeView,
  NoticeTarget,
  NoticeAck,
} from "../server/notice-model";
export type { NoticeContent } from "../server/notice-validation";
export const noticeStatus = {
  draft: "초안",
  published: "게시됨",
  withdrawn: "철회됨",
  superseded: "후속 공지로 대체됨",
};
