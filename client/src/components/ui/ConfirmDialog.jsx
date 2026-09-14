import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import Alert from './Alert';
import { getErrorMessage } from '../../lib/api';

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} loading={busy} autoFocus>{confirmLabel}</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        {error && <Alert kind="error">{error}</Alert>}
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.55 }}>{message}</p>
      </div>
    </Modal>
  );
}
