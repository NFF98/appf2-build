export const LAST_SEEN_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function shouldUpdateLastSeen(
  previousLastSeenAtMs: number | null,
  nowMs: number
): boolean {
  if (previousLastSeenAtMs === null) {
    return true;
  }
  return nowMs - previousLastSeenAtMs >= LAST_SEEN_UPDATE_INTERVAL_MS;
}
