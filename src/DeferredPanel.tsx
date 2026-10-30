import {
  Component,
  Suspense,
  createElement,
  lazy,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
// This boundary handles module-download failures only, not business render errors.
export class PanelLoadError extends Error {
  constructor() {
    super("The selected screen module could not be loaded.");
  }
}
export async function loadPanel<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  try {
    return await load();
  } catch {
    throw new PanelLoadError();
  }
}
export function PanelLoadFailure({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      <p>
        선택한 업무 화면 파일을 불러오지 못했습니다. 현장/메뉴 선택은 그대로
        유지됩니다. 업무 저장 요청을 다시 보내는 동작이 아닙니다.
      </p>
      <button onClick={retry}>화면 파일 다시 불러오기</button>
      <p>
        계속 실패하면 연결 또는 배포 파일 상태를 확인해야 합니다. 이 화면에는
        아직 업무 입력 폼이 열리지 않았습니다.
      </p>
    </div>
  );
}
export class PanelLoadBoundary extends Component<
  { retry: () => void; children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error) {
      if (!(this.state.error instanceof PanelLoadError)) throw this.state.error;
      return <PanelLoadFailure retry={this.props.retry} />;
    }
    return this.props.children;
  }
}
// A new React.lazy instance on an explicit retry avoids its cached rejection.
// Browser/module-loader cache behavior still needs real-browser validation.
export function deferredPanel<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  return function Deferred(props: P) {
    const [attempt, setAttempt] = useState(() => ({
      Panel: lazy(() => loadPanel(load)),
      number: 0,
    }));
    return (
      <PanelLoadBoundary
        key={attempt.number}
        retry={() =>
          setAttempt((old) => ({
            Panel: lazy(() => loadPanel(load)),
            number: old.number + 1,
          }))
        }
      >
        <Suspense
          fallback={
            <p role="status">
              선택한 업무 화면을 불러오는 중입니다. 저장 요청은 보내지 않습니다.
            </p>
          }
        >
          {createElement(attempt.Panel, props)}
        </Suspense>
      </PanelLoadBoundary>
    );
  };
}
