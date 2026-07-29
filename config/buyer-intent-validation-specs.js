const BUYER_INTENT_VALIDATION_SPEC_VERSION = "2026.07.28-v1";

const SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1 = Object.freeze({
  id: "social_media_manager_client_control_v1",
  version: 1,
  status: "active",
  decisionHash: "03bd9897d6b87e1412c3e09d28b25e629e88affc240406661af202c582dc48e1",
  opportunityTitle: "Social Media Manager Client-Control and Profitability System",
  buyer: "Freelance social media managers serving two or more retained clients.",
  problem: "Client intake, approvals, scope changes, delivery proof, and per-client profitability are fragmented across messages, generic templates, and separate tools.",
  offer: "One editable Excel workbook that links client work, approval status, scope changes, delivery proof, and estimated per-client contribution, with sample data and a concise setup guide.",
  priceCents: 2995,
  channel: {
    id: "etsy_au_single_listing",
    label: "One Etsy Australia digital listing",
    platformName: "Etsy",
    testActionLabel: "one Etsy Australia digital listing",
    analyticsSource: "Etsy Shop Stats",
    rationale: "Pantheon retained attributable adjacent marketplace demand, competing listings, and a measurable seller-statistics path. Etsy is a test channel, not a permanent platform commitment.",
    onlyActiveListing: true,
    publicationAllowed: false,
    advertisingAllowed: false,
    customerContactAllowed: false,
    accountActionAllowed: false,
    externalSpendCapCents: 100,
    excludedCosts: [
      "Etsy account setup fee",
      "Etsy subscription",
      "Etsy Ads",
      "Any undelegated Offsite Ads decision",
      "KYC or identity action",
    ],
  },
  measurement: {
    durationDays: 30,
    exposureTarget: 100,
    exposureUnit: "Etsy Shop Stats visits",
    qualifiedExposure: "Etsy-reported visits while this is the only active listing, excluding operator test visits and accepting Etsy's final bot filtering.",
    primaryOutcome: "Independent completed paid orders",
    secondarySignals: [
      "Listing favourites",
      "Genuine buyer enquiries about the exact offer",
    ],
    qualificationQuestion: "Is the linked client-control workflow useful enough to buy at A$29.95, and if not, is the blocker the Excel format, the promised outcome, the price, or a missing function?",
    passRule: "At least 3 independent paid orders from no more than 100 qualified visits, no format- or clarity-driven refund, and at least A$10 actual net cash contribution per completed order after all attributable cash costs.",
    reviseRule: "Revise one variable only when the cohort produces 1-2 orders, or at least 5 genuine favourites or enquiries with a coherent buyer objection.",
    inconclusiveRule: "If fewer than 100 qualified visits occur within 30 days, diagnose title, tags, preview, search placement, and channel reach before judging demand.",
    stopRule: "Stop or park if 100 qualified visits produce zero orders and fewer than 5 genuine interest signals, buyers repeatedly reject Excel as the required format, a format or clarity defect causes a refund, or actual net cash contribution is non-positive.",
    investmentReopenRule: "Reopen the parked investment case only after the pass rule is satisfied and actual costs are reconciled.",
  },
  providerPolicy: {
    productBuilderRoute: "luna",
    qualityReviewerRoute: "terra",
    productBuilderCapCents: 150,
    qualityReviewerCapCents: 150,
    combinedCapCents: 300,
    allowFallback: false,
    automaticPaidRetry: false,
    correctionLimit: 1,
  },
  sourceRecords: [
    {
      url: "https://help.etsy.com/hc/en-us/articles/115015774268-How-to-Use-Etsy-Stats-for-Your-Shop",
      title: "How to Use Etsy Stats for Your Shop",
      publisher: "Etsy",
      observedAt: "2026-07-28",
      supports: "Etsy Stats exposes visits, orders, conversion, revenue, listing views, favourites, orders, and traffic sources; visits are filtered for bot traffic.",
    },
    {
      url: "https://www.etsy.com/au/legal/fees",
      title: "Fees and Payments Policy",
      publisher: "Etsy",
      observedAt: "2026-07-28",
      supports: "Current official listing, transaction, advertising, conversion, and setup-fee rules.",
    },
    {
      url: "https://help.etsy.com/hc/en-us/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy",
      title: "Etsy payment processing fees",
      publisher: "Etsy",
      observedAt: "2026-07-28",
      supports: "Australian domestic and international Etsy Payments processing rates.",
    },
    {
      url: "https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings",
      title: "How to Manage Your Digital Listings",
      publisher: "Etsy",
      observedAt: "2026-07-28",
      supports: "Digital listings require seller-made or seller-designed files and accept up to five files of no more than 20 MB each.",
    },
    {
      url: "https://help.etsy.com/hc/en-us/articles/360024112614-What-Can-I-Sell-on-Etsy",
      title: "What Can I Sell on Etsy?",
      publisher: "Etsy",
      observedAt: "2026-07-28",
      supports: "Seller-designed digital products are permitted and seller-prompted AI creations require disclosure.",
    },
  ],
  sample: {
    packageTitle: "Social Media Manager Client-Control Validation Sample",
    customerPromise: "Record client work, approvals, scope changes, delivery proof, and estimated contribution in one editable Excel workbook.",
    setupSteps: [
      "Open the setup guide and workbook.",
      "Review the example records before replacing them.",
      "Use one row per client deliverable and update its workflow and approval status.",
      "Enter actual hours, internal hourly cost, and external cash cost so the row-level contribution formulas remain auditable.",
    ],
    disclaimers: [
      "This validation sample is an editable local workbook, not a client portal, accounting system, legal agreement, tax product, or automated publishing service.",
      "Estimated contribution is an operating estimate based only on values entered by the user.",
    ],
    item: {
      id: "smm-client-control-validation-sample",
      title: "Client Control and Profitability Workbook",
      purpose: "Record client deliverables, approvals, scope changes, delivery proof, fees, time, costs, and estimated contribution in one local workbook.",
      instructions: [
        "Replace the sample records with one row per client deliverable.",
        "Update Work Status and Approval Status as the work progresses.",
        "Record any accepted scope change and retain a concise delivery reference.",
        "Enter the quoted fee, actual hours, internal hourly cost, and external cash cost.",
        "Review the calculated labour cost, total cost, and estimated contribution before the client review.",
      ],
      columns: [
        { name: "Record ID", type: "text", guidance: "Use a short internal reference.", options: [] },
        { name: "Client", type: "text", guidance: "Record the client or account name.", options: [] },
        { name: "Deliverable", type: "text", guidance: "Name the exact piece of client work.", options: [] },
        { name: "Due Date", type: "date", guidance: "Record the agreed due date.", options: [] },
        { name: "Work Status", type: "status", guidance: "Track the current delivery state.", options: ["Planned", "In Progress", "Complete"] },
        { name: "Approval Status", type: "status", guidance: "Track the client's approval state.", options: ["Not Requested", "Waiting", "Changes Requested", "Approved"] },
        { name: "Scope Change", type: "status", guidance: "Record whether additional scope exists and was accepted.", options: ["No", "Proposed", "Accepted"] },
        { name: "Delivery Proof", type: "text", guidance: "Store a concise file, message, or handover reference.", options: [] },
        { name: "Quoted Fee", type: "currency", guidance: "Enter the fee attributable to this deliverable in AUD.", options: [] },
        { name: "Hours Worked", type: "number", guidance: "Enter actual hours worked.", options: [] },
        { name: "Hourly Cost", type: "currency", guidance: "Enter the internal hourly cost assumption in AUD.", options: [] },
        { name: "External Cost", type: "currency", guidance: "Enter attributable external cash cost in AUD.", options: [] },
        { name: "Labour Cost", type: "currency", guidance: "Calculated from hours worked and hourly cost.", options: [] },
        { name: "Total Cost", type: "currency", guidance: "Calculated from labour and external cost.", options: [] },
        { name: "Estimated Contribution", type: "currency", guidance: "Calculated from quoted fee less total cost.", options: [] },
        { name: "Notes", type: "text", guidance: "Record the next decision or important exception.", options: [] },
      ],
      sampleRows: [
        ["SM-001", "Harbour Pilates", "August content campaign", "2026-08-05", "In Progress", "Waiting", "No", "Draft link sent 2026-07-28", "1200", "8", "55", "40", "440", "480", "720", "Waiting for approval on two posts."],
        ["SM-002", "Northside Dental", "Launch asset package", "2026-08-10", "Complete", "Approved", "Accepted", "Final folder delivered 2026-07-27", "900", "6", "55", "60", "330", "390", "510", "Accepted one additional resize before delivery."],
      ],
      calculations: [
        { target: "Labour Cost", operation: "multiply", inputs: ["Hours Worked", "Hourly Cost"] },
        { target: "Total Cost", operation: "sum", inputs: ["Labour Cost", "External Cost"] },
        { target: "Estimated Contribution", operation: "subtract", inputs: ["Quoted Fee", "Total Cost"] },
      ],
    },
  },
});

const BUYER_INTENT_VALIDATION_SPECS = Object.freeze([
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1,
]);

const BUYER_INTENT_VALIDATION_SPEC_LIFECYCLE = Object.freeze({
  [SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1.id]: Object.freeze({
    status: "terminal_stopped",
    terminalAt: "2026-07-29",
    reason: "inspection_evidence_recheck_failed_terminal",
    frozenSourceStatus: SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1.status,
    reuseAllowed: false,
  }),
});

function getBuyerIntentValidationSpec(id) {
  return BUYER_INTENT_VALIDATION_SPECS.find((spec) => spec.id === id) || null;
}

function getBuyerIntentValidationSpecLifecycle(id) {
  return BUYER_INTENT_VALIDATION_SPEC_LIFECYCLE[id] || null;
}

function buyerIntentValidationSpecIsActive(id) {
  return getBuyerIntentValidationSpecLifecycle(id)?.status === "active";
}

module.exports = {
  BUYER_INTENT_VALIDATION_SPEC_VERSION,
  BUYER_INTENT_VALIDATION_SPEC_LIFECYCLE,
  BUYER_INTENT_VALIDATION_SPECS,
  buyerIntentValidationSpecIsActive,
  getBuyerIntentValidationSpec,
  getBuyerIntentValidationSpecLifecycle,
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1,
};
