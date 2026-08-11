const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonotonicIsoClock } = require("../src/runtime/monotonic-iso-clock");

test("the runtime clock advances one millisecond across equal and backward wall readings", () => {
  const readings = [
    "2026-08-02T03:00:00.000Z",
    "2026-08-02T03:00:00.000Z",
    "2026-08-02T02:59:59.900Z",
    "2026-08-02T03:00:00.010Z",
  ];
  const clock = createMonotonicIsoClock(() => readings.shift());

  assert.deepEqual(
    [clock(), clock(), clock(), clock()],
    [
      "2026-08-02T03:00:00.000Z",
      "2026-08-02T03:00:00.001Z",
      "2026-08-02T03:00:00.002Z",
      "2026-08-02T03:00:00.010Z",
    ],
  );
});

test("the runtime clock is not wrapped twice", () => {
  const clock = createMonotonicIsoClock(() => "2026-08-02T03:00:00.000Z");

  assert.equal(createMonotonicIsoClock(clock), clock);
  assert.equal(clock(), "2026-08-02T03:00:00.000Z");
  assert.equal(clock(), "2026-08-02T03:00:00.001Z");
});

test("the runtime clock fails closed when its source is invalid", () => {
  const clock = createMonotonicIsoClock(() => "not-a-timestamp");

  assert.throws(
    () => clock(),
    (error) => error.code === "pantheon_runtime_clock_invalid",
  );
});

test("the runtime clock represents the exact expiry boundary without rounding", () => {
  const expiry = "2026-08-10T00:00:00.000Z";
  const clock = createMonotonicIsoClock(() => expiry);

  assert.equal(clock(), expiry);
  assert.equal(clock(), "2026-08-10T00:00:00.001Z");
});
