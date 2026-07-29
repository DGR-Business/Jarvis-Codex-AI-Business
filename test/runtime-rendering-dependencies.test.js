const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");

test("locked runtime requirements cover every local product renderer import", () => {
  const requirements = fs.readFileSync(
    path.join(workspaceRoot, "requirements-runtime.txt"),
    "utf8",
  );
  for (const packageName of ["openpyxl", "Pillow", "pypdfium2", "reportlab"]) {
    assert.match(
      requirements,
      new RegExp(`^${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}==[^\\s]+$`, "mi"),
      `${packageName} must be pinned for clean-install rendering`,
    );
  }
});
