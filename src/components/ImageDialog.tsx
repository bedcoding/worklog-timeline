import { IconClose } from './Icons';
import { Modal } from './Modal';

interface ImageDialogProps {
  image: { url: string; title: string } | null;
  onClose: () => void;
}

export function ImageDialog({ image, onClose }: ImageDialogProps) {
  return (
    <Modal open={!!image} onClose={onClose} className="full-image" labelledBy="image-title">
      {image && (
        <>
          <div className="dialog-top">
            <h2 id="image-title">{image.title}</h2>
            <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
              <IconClose />
            </button>
          </div>
          <img src={image.url} alt={image.title} />
        </>
      )}
    </Modal>
  );
}
