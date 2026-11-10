export function formatTime(iso: string | null): string {
  if (!iso) {
    return '–';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Today 14:10", or "11-07 09:32" for another day. */
export function sessionDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const day = sameDay
    ? 'Today'
    : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${day} ${formatTime(iso)}`;
}
