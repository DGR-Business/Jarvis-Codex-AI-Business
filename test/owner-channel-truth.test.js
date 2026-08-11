"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  integrationDefinitions,
} = require("../src/adapters/registry");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

test("digital product preparation is a local capability rather than a marketplace connection", () => {
  const definitions = integrationDefinitions();
  const localPreparation = definitions.find((item) => item.id === "digital_products");

  assert.equal(localPreparation.name, "Local Product File Preparation");
  assert.equal(localPreparation.kind, "local-capability");
  assert.equal(localPreparation.mode, "local-dry-run");
  assert.equal(localPreparation.health, "ok");
  assert.equal(localPreparation.metadata.localOnly, true);
  assert.equal(localPreparation.metadata.externalEffect, false);
  assert.equal(localPreparation.metadata.liveMarketplacePublishing, false);
  assert.match(localPreparation.metadata.use, /without publishing or changing a marketplace account/i);
});

test("Etsy registry state stays unselected and technically unverified", () => {
  const etsy = integrationDefinitions().find((item) => item.id === "etsy");

  assert.equal(etsy.status, "unselected");
  assert.equal(etsy.mode, "not-implemented");
  assert.equal(etsy.health, "not_verified");
  assert.equal(etsy.metadata.accountInspection, "not_performed");
  assert.equal(etsy.metadata.technicalConnection, "not_connected");
  assert.equal(etsy.metadata.livePublishingAdapter, "not_implemented");
  assert.equal(etsy.metadata.publishingAuthority, "none");
  assert.doesNotMatch(JSON.stringify(etsy), /owner.reported|owner.confirmed/i);
});

test("owner UI consumes canonical pre-venture truth and keeps channel claims separate", () => {
  assert.match(appSource, /pantheon\.owner-preventure-research\.v1/);
  assert.match(appSource, /data\?\.preventureResearch/);
  assert.match(appSource, /state\?\.integrity\?\.status === "ok" && state\.current/);
  assert.match(appSource, /gate\.etsy\?\.accountExistence === "owner_reported_unverified"/);
  assert.match(appSource, /Pantheon has not inspected, connected, or technically verified it/);
  assert.match(appSource, /Owner-confirmed; not technically verified/);
  assert.match(appSource, /Offer needs revision/);
  assert.match(appSource, /No selling channel selected/);
  assert.match(appSource, /Retaining cash remains available/);
  assert.match(appSource, /No external commercial effects/);
  assert.match(appSource, /researchGate\?\.nextAction/);
  assert.match(stylesSource, /\.commercial-gate/);
  assert.match(stylesSource, /\.owner-gate-grid/);

  assert.doesNotMatch(appSource, /Gumroad Direct/);
  assert.doesNotMatch(appSource, /Gumroad listing/);
  assert.doesNotMatch(appSource, /separate Gumroad publishing action/);
});
