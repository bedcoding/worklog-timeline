import { useCallback, useEffect, useRef, useState } from 'react';

/** 화면 아래에 잠깐 뜨는 알림 */
export function useToast(duration = 2800) {
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (message: string) => {
      window.clearTimeout(timer.current);
      setToast({ message, visible: true });
      timer.current = window.setTimeout(() => setToast((t) => ({ ...t, visible: false })), duration);
    },
    [duration],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, show };
}
