const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalListingIncludedFiles,
  currentPackageDefectIssues,
  exactPublicationListMatch,
  normalizePublicationText,
  publicationSafeText,
  publicationTextIssues,
} = require("../src/runtime/publication-artifact-quality");

test("canonical listing contents come from the product manifest", () => {
  const manifest = {
    catalogueItems: [
      {
        files: [
          "customer-files/intake.xlsx",
          "customer-files/intake-sample.csv",
        ],
      },
      {
        files: [
          "customer-files/delivery.xlsx",
          "customer-files/delivery-sample.csv",
        ],
      },
    ],
    sharedFiles: ["customer-files/00-customer-setup-guide.pdf"],
    storefrontPreviews: [
      "storefront-previews/catalogue-overview.png",
      "storefront-previews/workbook-preview.png",
    ],
    bundle: { filename: "customer-toolkit.zip" },
  };

  assert.deepEqual(canonicalListingIncludedFiles(manifest), [
    "2 editable Excel workbooks: intake.xlsx, delivery.xlsx",
    "2 matching sample CSV files: intake-sample.csv, delivery-sample.csv",
    "1 PDF setup guide: 00-customer-setup-guide.pdf",
    "2 storefront preview images: catalogue-overview.png, workbook-preview.png",
    "1 ZIP download bundle: customer-toolkit.zip",
  ]);
});

test("publication checks reject broken encoding and internal drafting notes", () => {
  const output = {
    operatorWorkload: "Approximately 2\u00e2\u20ac\u201c3 hours. We need avoid too long and confusing. Maybe simplify.",
  };
  assert.deepEqual(publicationTextIssues(output, "Launch copy"), [
    "Launch copy contains broken character encoding.",
    "Launch copy contains internal drafting commentary instead of finished customer-facing text.",
  ]);
  assert.equal(
    publicationSafeText(output.operatorWorkload),
    "Approximately 2-3 hours.",
  );
});

test("current package defects block readiness while resolved wording remains valid", () => {
  assert.equal(
    currentPackageDefectIssues("Reconcile the listing filenames against the manifest before publishing.").length,
    1,
  );
  assert.deepEqual(
    currentPackageDefectIssues("The package is reconciled and no material discrepancy remains."),
    [],
  );
});

test("canonical included-file matching is exact after harmless punctuation normalization", () => {
  const expected = ["1 PDF setup guide: setup.pdf", "1 ZIP download bundle: files.zip"];
  assert.equal(exactPublicationListMatch([...expected], expected), true);
  assert.equal(exactPublicationListMatch([expected[0]], expected), false);
  assert.equal(normalizePublicationText("2\u20133 hours"), "2-3 hours");
});
