import { useState } from "react";
import { api } from "./api";
import { useDraftGuard } from "./useDraftGuard";
export function PasswordChange({
  onChanged,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  onChanged: () => void;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [currentPassword, setCurrent] = useState(""),
    [newPassword, setNew] = useState(""),
    [confirmPassword, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(
    !!currentPassword || !!newPassword || !!confirmPassword,
    busy,
    onDirtyChange,
    onBusyChange,
  );
  async function change() {
    if (busy) return;
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      setCurrent("");
      setNew("");
      setConfirm("");
      return;
    }
    if (
      !window.confirm(
        "변경 후 현재 창을 포함한 모든 계정 세션이 로그아웃됩니다. 계속할까요?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api("/account/password", "POST", {
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setCurrent("");
      setNew("");
      setConfirm("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setCurrent("");
      setNew("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        돌아가기
      </button>
      <h2>내 비밀번호 변경</h2>
      <p>
        현재 비밀번호가 필요합니다. 변경하면 모든 브라우저/장치 세션(현재 창
        포함)을 종료하고 새 비밀번호로 다시 로그인합니다. 계정/현장 권한과 업무
        기록은 그대로입니다.
      </p>
      <p>
        새 비밀번호는12~128자이며 현재 값과 달라야 합니다. 공백을 자동 제거하지
        않습니다. 찾기·이메일 복구·다른 계정 변경은 지원하지 않습니다.
      </p>
      {error && (
        <p role="alert">
          {error} 보안을 위해 비밀번호 입력은 지웠습니다. 응답을 받지 못했다면
          변경됐을 수 있으니 새 비밀번호로 로그인 여부를 확인하세요.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
        <fieldset disabled={busy}>
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              minLength={1}
              maxLength={128}
              required
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            새 비밀번호
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </label>
          <label>
            새 비밀번호 확인
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={confirmPassword}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button type="submit">비밀번호 변경 · 모든 세션 종료</button>
        </fieldset>
      </form>
      <p>
        비밀번호를 변경 요청의 재시도 저장소·감사이력·URL에 기록하지 않습니다.
        브라우저 비밀번호 관리자 저장은 브라우저 설정에 따릅니다.
      </p>
    </section>
  );
}
