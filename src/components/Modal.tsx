import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  labelledBy: string;
  children: ReactNode;
  onPaste?: React.ClipboardEventHandler<HTMLDialogElement>;
  onDragOver?: React.DragEventHandler<HTMLDialogElement>;
  onDragLeave?: React.DragEventHandler<HTMLDialogElement>;
  onDrop?: React.DragEventHandler<HTMLDialogElement>;
}

/**
 * 브라우저 기본 <dialog> 를 감싼 대화상자.
 * Esc, 바깥 클릭으로 닫히고, 닫히면 onClose 가 불립니다. 대화상자를 겹쳐 열 수 있습니다.
 */
export function Modal({ open, onClose, className, labelledBy, children, ...handlers }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // 브라우저는 첫 버튼에 포커스를 줘서 테두리가 먼저 보입니다. 대화상자 자체에 포커스를 두고,
      // Tab 을 누르면 첫 버튼으로 가게 합니다. 입력칸에 포커스를 줄 대화상자는 안에서 따로 옮깁니다.
      dialog.focus({ preventScroll: true });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onCloseRef.current();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  // 바깥(배경)을 눌렀다 뗐을 때만 닫습니다. 안에서 글자를 고르다 바깥에서 놓은 경우는 닫지 않습니다.
  const isBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = ref.current;
    if (!dialog || e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onMouseDown={(e) => {
        pressedOnBackdrop.current = isBackdrop(e);
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && isBackdrop(e)) ref.current?.close();
        pressedOnBackdrop.current = false;
      }}
      {...handlers}
    >
      {open ? children : null}
    </dialog>
  );
}
