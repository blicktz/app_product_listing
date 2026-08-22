export type PendingHomeAction =
  | { type: 'upload-complete'; message: string }
  | { type: 'sku-scanned'; sku: string };

let pending: PendingHomeAction | null = null;

export function setPendingHomeAction(action: PendingHomeAction): void {
  pending = action;
}

export function takePendingHomeAction(): PendingHomeAction | null {
  const action = pending;
  pending = null;
  return action;
}
