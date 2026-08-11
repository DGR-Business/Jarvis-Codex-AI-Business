const monotonicClocks = new WeakSet();

function invalidClockError() {
  const error = new Error(
    "Pantheon requires its runtime clock to return a valid date or timestamp.",
  );
  error.code = "pantheon_runtime_clock_invalid";
  return error;
}

function exactTime(value) {
  if (value === null || value === undefined || value === "") throw invalidClockError();
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw invalidClockError();
  return parsed;
}

function createMonotonicIsoClock(source = () => new Date()) {
  if (typeof source !== "function") throw invalidClockError();
  if (monotonicClocks.has(source)) return source;

  let previousTime = null;
  const clock = () => {
    const wallTime = exactTime(source());
    const nextTime = previousTime === null
      ? wallTime
      : Math.max(wallTime, previousTime + 1);
    const value = new Date(nextTime);
    if (!Number.isFinite(value.getTime())) throw invalidClockError();
    previousTime = nextTime;
    return value.toISOString();
  };
  monotonicClocks.add(clock);
  return clock;
}

module.exports = {
  createMonotonicIsoClock,
};
