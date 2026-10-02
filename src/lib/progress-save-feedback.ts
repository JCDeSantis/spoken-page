export function progressSaveFailure(status?: number) {
  const authentication = status === 401 || status === 403;
  return { retryable: !authentication, message: authentication
    ? "Progress is not saved. Your session needs attention; sign in again before closing the player."
    : "Progress could not be saved. Retrying while this player is open; keep it open until saving succeeds." };
}
export function progressRetryDelay(failures: number) { return Math.min(60000, 10000 * 2 ** Math.min(Math.max(failures - 1, 0), 3)); }
