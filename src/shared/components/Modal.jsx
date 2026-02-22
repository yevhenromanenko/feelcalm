import ActionButton from "./ActionButton";

export default function Modal({ isOpen, titleId, title, onClose, children }) {
  function onBackdropClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className={`modal${isOpen ? " open" : ""}`} aria-hidden={!isOpen} onClick={onBackdropClick}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <ActionButton className="modal-close" aria-label="Close" onClick={onClose}>
            x
          </ActionButton>
        </div>
        {children}
      </div>
    </div>
  );
}
