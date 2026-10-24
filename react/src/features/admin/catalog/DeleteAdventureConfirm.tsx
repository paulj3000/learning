import { useEffect, useId, useRef } from 'react';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

interface DeleteAdventureConfirmProps {
  adventureName: string;
  /** Why deleting is refused, or `null` if it is allowed. */
  blockReason: string | null;
  checking: boolean;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The second step of deleting an adventure (section 18): nothing is deleted
 * until "Delete Adventure" is pressed here. An inline alert dialog rather
 * than a modal, since the admin kit has no dialog component and ADR-023
 * keeps its dependency list short. Focus moves to Cancel when it opens.
 */
export function DeleteAdventureConfirm({
  adventureName,
  blockReason,
  checking,
  deleting,
  error,
  onCancel,
  onConfirm,
}: DeleteAdventureConfirmProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      className="grid gap-3 rounded-lg border border-destructive bg-destructive/10 p-4"
    >
      <h2 id={titleId} className="font-semibold">
        Delete Adventure?
      </h2>
      <p className="text-sm">
        You are about to delete "{adventureName}". This permanently removes the adventure's catalog
        record and its model assignments. Children's progress and history are not deleted.
      </p>
      {checking ? (
        <p className="text-sm text-muted-foreground">Checking whether it can be deleted...</p>
      ) : null}
      {blockReason ? <Alert variant="warning">{blockReason}</Alert> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button ref={cancelRef} variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          type="button"
          disabled={checking || deleting || blockReason !== null}
          onClick={onConfirm}
        >
          {deleting ? 'Deleting...' : 'Delete Adventure'}
        </Button>
      </div>
    </div>
  );
}
