import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/**
 * Explicit-intent confirmation for a side-effecting action. The confirm is the
 * user's explicit approval — the caller supplies whatever token/side effect the
 * action needs.
 */
export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  error = null,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          This action is governed and requires explicit confirmation.
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
