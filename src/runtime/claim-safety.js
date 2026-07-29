"use strict";

function withoutExplicitAbsence(value) {
  return String(value || "")
    .replace(
      /\bno\s+(?:revision|correction|changes?)\s+(?:(?:is|are|was|were)\s+)?(?:required|needed|necessary)\b/gi,
      "",
    )
    .replace(
      /\b(?:does not|doesn't|do not|don't)\s+(?:require|need)\s+(?:a\s+)?(?:revision|correction|changes?)\b/gi,
      "",
    )
    .replace(
      /\b(?:is|are|was|were)\s+not\s+(?:unsupported|unsubstantiated|unverified|misleading|inaccurate|unreliable|deceptive)\b/gi,
      "",
    )
    .replace(
      /\bno\s+(?:material\s+)?(?:unsupported|unsubstantiated|unverified|misleading|inaccurate|unreliable|deceptive)\s+(?:claims?|statements?|language)\s+(?:remain|exists?)\b/gi,
      "",
    );
}

function claimSafetyRequiresCorrection(value) {
  return /\b(?:unsafe|unsupported|unsubstantiated|unverified|misleading|inaccurate|unreliable|deceptive|overclaims?|revise|revision required|needs? (?:a )?(?:revision|changes?|correction)|requires? (?:a )?(?:revision|changes?|correction)|(?:must|should|needs? to|has to)\s+(?:be\s+)?(?:revised|corrected|revise|correct)|(?:revision|correction)\s+(?:is|remains|was)\s+(?:required|needed|necessary)|(?:cannot|can't|could not|couldn't)\s+be\s+substantiated|(?:is|are|was|were)\s+not\s+(?:supported|substantiated|verified|accurate|reliable)|lacks?\s+(?:support|substantiation|verification|evidence))\b/i.test(
    withoutExplicitAbsence(value),
  );
}

function claimSafetyIsConfirmed(value) {
  const statement = String(value || "").trim();
  return /^(?:safe|supported|acceptable)\b/i.test(statement)
    && !claimSafetyRequiresCorrection(statement);
}

module.exports = {
  claimSafetyIsConfirmed,
  claimSafetyRequiresCorrection,
};
