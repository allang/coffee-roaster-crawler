'use strict';

function attemptTime(roaster) {
  if (roaster.last_crawl_attempt_at == null) return -Infinity;
  const time = Date.parse(roaster.last_crawl_attempt_at);
  if (!Number.isFinite(time)) throw new Error('Invalid last crawl attempt for roaster ' + roaster.id);
  return time;
}

// All attempts count, including failures: restarting should not move a recently
// failed merchant ahead of a merchant we have never reached.
function prioritizeRoasters(roasters) {
  const attempts = new Map(roasters.map(roaster => [roaster.id, attemptTime(roaster)]));
  return [...roasters].sort((a, b) => {
    const first = attempts.get(a.id), second = attempts.get(b.id);
    if (first !== second) return first < second ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

module.exports = { prioritizeRoasters };
