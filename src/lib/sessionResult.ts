export type SessionResult = {
  message: string;
};

let pending: SessionResult | null = null;

export function setPendingSessionResult(result: SessionResult): void {
  pending = result;
}

export function takePendingSessionResult(): SessionResult | null {
  const result = pending;
  pending = null;
  return result;
}
