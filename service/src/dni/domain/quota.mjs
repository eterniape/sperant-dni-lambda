const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LIMA_OFFSET = 5 * 60 * MINUTE;

function limaDate(year, month, anchor) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(lastDay, anchor)) + LIMA_OFFSET;
}

export function quotaReset(now, anchor, daily) {
  if (daily) return (Math.floor((now - LIMA_OFFSET) / DAY) + 1) * DAY + LIMA_OFFSET;
  const local = new Date(now - LIMA_OFFSET);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const cycleStart = limaDate(year, month, anchor);
  return now < cycleStart ? cycleStart : limaDate(year, month + 1, anchor);
}
