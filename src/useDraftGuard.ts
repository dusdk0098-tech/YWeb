import { useEffect, useRef } from "react";
export function useDraftGuard(
  dirty: boolean,
  busy: boolean,
  onDirtyChange: (v: boolean) => void,
  onBusyChange: (v: boolean) => void,
) {
  const command = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  return {
    canLeave: () =>
      !busy &&
      (!dirty || window.confirm("저장하지 않은 입력을 버리고 이동할까요?")),
    key: (path: string, value: unknown) => {
      const signature = JSON.stringify([path, value]);
      if (command.current?.signature !== signature)
        command.current = { signature, key: crypto.randomUUID() };
      return command.current.key;
    },
  };
}
