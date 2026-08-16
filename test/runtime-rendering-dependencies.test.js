const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseRendererInventoryText,
  parseRendererRequirementsText,
} = require("../src/runtime/renderer-environment");

const workspaceRoot = path.resolve(__dirname, "..");

test("locked runtime requirements cover every local product renderer import", () => {
  const requirements = fs.readFileSync(
    path.join(workspaceRoot, "requirements-runtime.txt"),
    "utf8",
  );
  const pins = parseRendererRequirementsText(requirements);
  assert.deepEqual(Object.keys(pins), ["openpyxl", "Pillow", "pypdfium2", "reportlab"]);
  for (const packageName of ["openpyxl", "Pillow", "pypdfium2", "reportlab"]) {
    assert.match(
      requirements,
      new RegExp(`^${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}==[^\\s]+$`, "mi"),
      `${packageName} must be pinned for clean-install rendering`,
    );
  }
  const inventory = fs.readFileSync(
    path.join(workspaceRoot, "requirements-renderer-lock.txt"),
    "utf8",
  );
  const inventoryPins = parseRendererInventoryText(inventory);
  assert.deepEqual(inventoryPins, {
    openpyxl: "3.1.5",
    Pillow: "12.3.0",
    pypdfium2: "5.13.0",
    reportlab: "5.0.0",
    "charset-normalizer": "3.5.1",
    et_xmlfile: "2.0.0",
    pip: "26.2.1",
  });
  for (const packageName of Object.keys(pins)) {
    assert.equal(inventoryPins[packageName], pins[packageName]);
  }
});
