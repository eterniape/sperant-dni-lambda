const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LIMA_OFFSET = 5 * 60 * MINUTE;

function limaDate(year, month, anchor) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(lastDay, anchor)) + LIMA_OFFSET;
}

export function quotaWindows(now, anchor = 1) {
  const local = new Date(now - LIMA_OFFSET);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const monthOffset = now < limaDate(year, month, anchor) ? -1 : 0;
  return {
    minute: Math.floor(now / MINUTE) * MINUTE,
    day: Math.floor((now - LIMA_OFFSET) / DAY) * DAY + LIMA_OFFSET,
    month: limaDate(year, month + monthOffset, anchor),
    minuteEnd: (Math.floor(now / MINUTE) + 1) * MINUTE,
    dayEnd: (Math.floor((now - LIMA_OFFSET) / DAY) + 1) * DAY + LIMA_OFFSET,
    monthEnd: limaDate(year, month + monthOffset + 1, anchor),
  };
}

export function nextReservation(state, policy, now) {
  const windows = quotaWindows(now, policy.billingDay);
  const duringPromo = policy.promotionUntil > now;
  // Promotion has its own ceiling; keep the normal counter ready for when it ends.
  const fields = [
    ['minute', policy.perMinute, windows.minute, windows.minuteEnd],
    ['day', policy.perDay, windows.day, windows.dayEnd],
    duringPromo
      ? ['promo', policy.promotionLimit, policy.promotionUntil, policy.promotionUntil]
      : ['month', policy.perMonth, windows.month, windows.monthEnd],
  ];
  const next = { ...state };
  let retryAt = state.blockedUntil > now ? state.blockedUntil : 0;
  for (const [field, limit, start, end] of fields) {
    if (limit === undefined) continue;
    const counter = field + 'Count';
    const used = state[field] === start ? state[counter] : 0;
    if (used >= limit) retryAt = Math.max(retryAt, end);
    next[field] = start;
    next[counter] = used + 1;
  }
  return retryAt ? { retryAt } : { next };
}
