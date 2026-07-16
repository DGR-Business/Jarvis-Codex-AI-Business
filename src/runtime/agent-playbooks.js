const { all, fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { getAiTeamState } = require("./ai-team");
const { getAgentOperatingBriefsState } = require("./agent-operating-briefs");
const { getAgentWorkbenchState, queueAgentWorkbenchProof, queueAgentWorkbenchProofSuite } = require("./agent-workbench");
const { getAgentToolPolicyState } = require("./agent-tools");

const AGENT_PLAYBOOK_SCHEMA = "jarvis_agent_playbooks_v1";

const PLAYBOOKS = {
  chief_of_staff: {
    trigger: "Specialists have produced evidence and the operator needs one decision.",
    firstMove: "Compress the work into a money move, risk, evidence, cost cap, and decision.",
    protectedSteps: [
      "Read the workflow, worker outputs, scorecard, costs, approvals, and current blockers.",
      "Name the next money move and the smallest safe action.",
      "Summarize evidence, upside, risk, and missing information in operator language.",
      "Create approve, request-changes, or deny options without taking external action.",
    ],
    evidenceCaptured: ["money move", "evidence summary", "risk", "cost cap", "operator decision"],
    handoff: "Operator decision queue or the next specialist who must repair the gap.",
    successMetric: "Operator can decide from the dashboard without opening raw documents.",
    stopRule: "Stop if evidence is missing, risk is unclear, or the next action touches a hard stop.",
  },
  opportunity_scout: {
    trigger: "The system needs new digital product opportunities or niche angles.",
    firstMove: "Map buyer groups and visible pain before building anything.",
    protectedSteps: [
      "Start from the chosen business direction or channel.",
      "List buyer groups, painful jobs, niche language, and competitor gaps.",
      "Mark each opportunity as evidence-backed, assumption-only, or blocked by missing research.",
      "Send the strongest opportunity to Demand Validator or Offer Architect.",
    ],
    evidenceCaptured: ["buyer", "problem", "demand signal", "evidence gap", "recommended test"],
    handoff: "Demand Validator for proof or Offer Architect when enough evidence exists.",
    successMetric: "At least one specific buyer/problem pair can be tested cheaply.",
    stopRule: "Stop if the opportunity cannot be tied to a buyer, channel, or demand signal.",
  },
  demand_validator: {
    trigger: "An idea, buyer, problem, or offer needs demand proof.",
    firstMove: "Check whether people already show demand before product work expands.",
    protectedSteps: [
      "Read the buyer, problem, channel, and evidence standard.",
      "Use protected records first and label assumptions clearly.",
      "Prepare live research only as an approval-gated request when protected evidence is weak.",
      "Return a continue, revise, or stop verdict with confidence.",
    ],
    evidenceCaptured: ["source summary", "confidence", "demand verdict", "kill or continue signal"],
    handoff: "Offer Architect if demand is plausible; Chief of Staff if risk or uncertainty needs operator steering.",
    successMetric: "The system avoids building offers with weak or invented demand.",
    stopRule: "Stop if live research, spend, or external browsing would be needed without approval.",
  },
  offer_architect: {
    trigger: "Demand evidence exists and the system needs a sellable test offer.",
    firstMove: "Turn buyer pain into a small paid offer with a clear promise and price.",
    protectedSteps: [
      "Read the buyer, problem, evidence, channel, and price assumptions.",
      "Define the offer promise, product format, buying trigger, and objection list.",
      "Keep the offer small enough to test manually.",
      "Send copy, product, distribution, and finance requirements to the right workers.",
    ],
    evidenceCaptured: ["offer", "price", "positioning", "promise", "objections", "test hypothesis"],
    handoff: "Copy and Conversion, Product Builder, Finance, and Distribution.",
    successMetric: "A buyer can understand the offer and the test can be run with low risk.",
    stopRule: "Stop if buyer, painful problem, channel, price, or risk is unclear.",
  },
  product_builder: {
    trigger: "A promoted test needs the smallest sellable product asset or listing package.",
    firstMove: "Prepare only the asset needed for the next market test.",
    protectedSteps: [
      "Read the offer, channel requirements, quality bar, and test hypothesis.",
      "Create an asset plan or listing draft without live upload or paid generation.",
      "Identify quality risks and missing source material.",
      "Hand off to Quality Reviewer or Chief of Staff for the approval decision.",
    ],
    evidenceCaptured: ["asset plan", "mockup or listing draft", "quality risks", "approval needed"],
    handoff: "Quality Reviewer before any publishing or paid asset generation.",
    successMetric: "The operator can approve a minimal product test without overbuilding.",
    stopRule: "Stop before paid asset generation, live upload, publishing, or supplier action.",
  },
  copy_conversion_agent: {
    trigger: "An offer needs buyer-facing copy for a manual or dry-run test.",
    firstMove: "Write clear copy tied to one measurable buyer action.",
    protectedSteps: [
      "Read the buyer, problem, offer, channel, and desired action.",
      "Write headline, description, call to action, and message variants.",
      "Flag unsupported claims and tracking gaps.",
      "Hand off to Distribution or Quality Reviewer.",
    ],
    evidenceCaptured: ["headline", "description", "call to action", "message variants", "tracking note"],
    handoff: "Distribution Agent for the run sheet or Quality Reviewer for claim safety.",
    successMetric: "Copy is specific enough to test attention, click, reply, or sale.",
    stopRule: "Stop before sending customer messages or publishing copy externally.",
  },
  distribution_operator: {
    trigger: "A ready offer needs a manual channel test plan.",
    firstMove: "Convert the offer and copy into safe channel steps and result fields.",
    protectedSteps: [
      "Read the offer, channel, message, and tracking plan.",
      "Write the manual run sheet and evidence capture checklist.",
      "Define success metric, time box, and kill rule.",
      "Send the test to the operator decision queue before external action.",
    ],
    evidenceCaptured: ["channel steps", "evidence to capture", "success metric", "kill rule"],
    handoff: "Chief of Staff or Growth Analyst after the result is recorded.",
    successMetric: "The operator can run the channel test and record results without guessing.",
    stopRule: "Stop before sending, posting, publishing, scraping, or account action.",
  },
  finance_analyst: {
    trigger: "A test, offer, or next action has price, cost, time, or spend implications.",
    firstMove: "Set the unit-economics truth before work scales.",
    protectedSteps: [
      "Read price, cost assumptions, channel, time required, and spend cap.",
      "Estimate margin, break-even, and risk.",
      "Flag missing costs or unrealistic price assumptions.",
      "Return a spend-safe decision signal.",
    ],
    evidenceCaptured: ["margin logic", "break-even", "cost cap", "financial risk", "decision signal"],
    handoff: "Chief of Staff and Growth Analyst.",
    successMetric: "The next action has a clear cost cap and expected commercial upside.",
    stopRule: "Stop before money movement, increased spend, or uncapped model/tool costs.",
  },
  customer_voice_agent: {
    trigger: "The system receives buyer replies, objections, reviews, or feedback.",
    firstMove: "Turn actual buyer language into offer and product revisions.",
    protectedSteps: [
      "Read the feedback, result context, and current offer.",
      "Separate exact buyer words from interpretation.",
      "Cluster objections, requested improvements, and buying friction.",
      "Recommend a revision for Offer Architect or Growth Analyst.",
    ],
    evidenceCaptured: ["buyer language", "objections", "requested improvements", "recommended revision"],
    handoff: "Offer Architect for revised positioning or Growth Analyst for result interpretation.",
    successMetric: "The next test uses real buyer signal rather than internal opinion.",
    stopRule: "Stop before customer replies, refunds, disputes, or sensitive support decisions.",
  },
  growth_analyst: {
    trigger: "A test has actual results or enough lack-of-response to learn from.",
    firstMove: "Compare expected metric with actual outcome and decide the next move.",
    protectedSteps: [
      "Read the hypothesis, expected metric, actual result, feedback, cost, and time.",
      "Classify the verdict as scale, revise, pause, kill, or needs evidence.",
      "Explain what changed and which improvement matters next.",
      "Create or request the next revised test when useful.",
    ],
    evidenceCaptured: ["verdict", "learning", "improvement", "next action", "confidence"],
    handoff: "Chief of Staff for the operator packet.",
    successMetric: "The system improves based on actual metrics rather than running the same weak test again.",
    stopRule: "Stop before autopilot promotion or increased spend without approval.",
  },
  quality_reviewer: {
    trigger: "A deliverable, pack, claim, or worker output is about to reach the operator or a live gate.",
    firstMove: "Find missing evidence, risky claims, and unclear decisions.",
    protectedSteps: [
      "Read the deliverable, claims, evidence, risk context, and intended decision.",
      "Score completeness, readability, claim safety, and platform/IP risk.",
      "Request changes when the operator cannot safely decide.",
      "Escalate hard-stop items without making legal or compliance determinations.",
    ],
    evidenceCaptured: ["quality score", "risk findings", "missing evidence", "operator recommendation"],
    handoff: "Chief of Staff with an approve, change, or deny recommendation.",
    successMetric: "The operator sees fewer vague or risky review packs.",
    stopRule: "Stop before legal determinations, IP/platform-risk decisions, or unsafe approvals.",
  },
};

function listValue(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readinessLabel(brief) {
  if (!brief) return "Run protected proof first.";
  if (brief.connectionReadiness?.status === "ready_for_one_capped_comparison") {
    return "Ready for one capped live comparison after provider setup and approval.";
  }
  if (brief.connectionReadiness?.status === "ready_for_narrow_live_use") {
    return "Ready only for narrow capped live use with existing controls.";
  }
  return brief.nextSafeAction || "Keep protected and close the evidence gap.";
}

function parseRow(row, fields = ["metadata", "payload", "result"]) {
  if (!row) return null;
  const copy = { ...row };
  for (const field of fields) {
    if (field in copy) copy[field] = fromJson(copy[field], {});
  }
  return copy;
}

function latestByTime(items, fields = ["completed_at", "updated_at", "created_at"]) {
  return [...items].sort((left, right) => {
    for (const field of fields) {
      const comparison = String(right[field] || "").localeCompare(String(left[field] || ""));
      if (comparison) return comparison;
    }
    return 0;
  })[0] || null;
}

function marketContextFromPack(db) {
  const pack = parseRow(get(db, "SELECT * FROM commercial_execution_packs ORDER BY updated_at DESC, created_at DESC LIMIT 1"));
  if (!pack) return null;
  const experiment = parseRow(get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [pack.experiment_id]));
  return {
    source: "manual_market_cockpit",
    sourceType: "execution_pack",
    executionPackId: pack.id,
    workflowId: pack.workflow_id || experiment?.workflow_id || null,
    experimentId: pack.experiment_id || null,
    candidateId: pack.candidate_id || null,
    subject: pack.title || experiment?.name || "Manual market test",
    buyer: pack.metadata?.buyer || experiment?.buyer || "Digital product buyers",
    problem: pack.metadata?.problem || "The buyer needs a clearer reason to act.",
    offer: pack.metadata?.offer || experiment?.offer || pack.title || "Digital product test offer",
    channel: pack.metadata?.channel || experiment?.channel || "Manual market channel",
    successMetric: pack.metadata?.successMetric || experiment?.expected_metric || "A measurable buyer signal is recorded.",
    killCriteria: pack.metadata?.killCriteria || experiment?.metadata?.killCriteria || "Revise or stop if there is no useful buyer signal.",
  };
}

function marketContextFromCandidate(db) {
  const candidate = parseRow(get(
    db,
    "SELECT * FROM commercial_test_candidates ORDER BY updated_at DESC, rank ASC LIMIT 1",
  ));
  if (!candidate) return null;
  return {
    source: "manual_market_cockpit",
    sourceType: "test_candidate",
    candidateId: candidate.id,
    workflowId: candidate.workflow_id || null,
    subject: candidate.title || "Manual market test candidate",
    buyer: candidate.buyer || "Digital product buyers",
    problem: candidate.problem || "The buyer needs a clearer reason to act.",
    offer: candidate.offer || "Digital product test offer",
    channel: candidate.channel || "Manual market channel",
    successMetric: candidate.success_metric || "A measurable buyer signal is recorded.",
    killCriteria: candidate.kill_criteria || "Revise or stop if there is no useful buyer signal.",
  };
}

function defaultMarketContext(db, options = {}) {
  const optionContext = options.marketContext || {};
  const base = Object.keys(optionContext).length
    ? { source: "operator_request", sourceType: "manual_context", ...optionContext }
    : marketContextFromPack(db) || marketContextFromCandidate(db) || {
      source: "manual_market_cockpit",
      sourceType: "default",
      subject: "Digital product pilot rehearsal",
      buyer: "Digital product buyers",
      problem: "The buyer needs clearer proof before the operator spends or publishes.",
      offer: "Protected digital-product test offer",
      channel: "Manual market channel",
      successMetric: "A measurable buyer signal is recorded.",
      killCriteria: "Revise or stop if there is no useful buyer signal.",
    };
  return {
    ...base,
    subject: options.subject || base.subject,
    buyer: options.buyer || base.buyer,
    problem: options.problem || base.problem,
    offer: options.offer || base.offer,
    channel: options.channel || base.channel,
    successMetric: options.successMetric || base.successMetric,
    killCriteria: options.killCriteria || base.killCriteria,
  };
}

function playbookRehearsalTasks(db) {
  const tasks = all(
    db,
    `SELECT tasks.*, workflows.title AS workflow_title, workflows.type AS workflow_type
     FROM tasks
     LEFT JOIN workflows ON workflows.id = tasks.workflow_id
     WHERE tasks.kind = 'workbench_proof'
     ORDER BY tasks.updated_at DESC, tasks.created_at DESC
     LIMIT 300`,
  ).map((row) => parseRow(row));
  const runs = all(db, "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 300").map((row) => parseRow(row));
  const runByTask = new Map(runs.map((runRecord) => [runRecord.task_id, runRecord]));
  return tasks
    .filter((task) => task.payload?.playbookRehearsal)
    .map((task) => {
      const runRecord = runByTask.get(task.id) || null;
      return {
        id: task.id,
        workflowId: task.workflow_id,
        workflowTitle: task.workflow_title,
        workerId: task.payload.workerId || task.payload.requestedWorker || task.agent,
        workerName: task.payload.workerName || task.agent,
        status: task.status,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at || null,
        context: task.payload.manualMarketContext || null,
        playbook: task.payload.playbook ? {
          trigger: task.payload.playbook.trigger,
          firstMove: task.payload.playbook.firstMove,
          successMetric: task.payload.playbook.successMetric,
          stopRule: task.payload.playbook.stopRule,
        } : null,
        run: runRecord ? {
          id: runRecord.id,
          status: runRecord.status,
          evalStatus: runRecord.eval_status,
          actualCostCents: Number(runRecord.actual_cost_cents || 0),
          outputSummary: runRecord.output_summary || "",
        } : null,
      };
    });
}

function buildPlaybook(definition, brief) {
  const template = PLAYBOOKS[definition.id] || {};
  const outputs = listValue(brief?.mustProduce).length ? brief.mustProduce : listValue(definition.output_contract?.required).map(humanize);
  const hardStops = listValue(brief?.hardStops).length ? brief.hardStops : listValue(definition.approval_policy?.mustPauseFor);
  return {
    schema: AGENT_PLAYBOOK_SCHEMA,
    agentId: definition.id,
    name: definition.name,
    status: "ready",
    trigger: template.trigger || "This worker is needed when its specialist contract matches the work.",
    firstMove: template.firstMove || definition.instructions,
    protectedSteps: listValue(template.protectedSteps),
    evidenceCaptured: listValue(template.evidenceCaptured).length ? template.evidenceCaptured : outputs,
    mustProduce: outputs,
    handoff: template.handoff || listValue(definition.handoff_targets).map(humanize).join(", ") || "Chief of Staff",
    successMetric: template.successMetric || "The operator receives a clearer decision with better evidence.",
    stopRule: template.stopRule || `Stop before ${hardStops.slice(0, 3).join(", ")}.`,
    modelConnectionRule: readinessLabel(brief),
    operatorControl: {
      primary: "Run Protected Proof",
      secondary: "Request Changes",
      live: brief?.connectionReadiness?.status === "ready_for_one_capped_comparison" ? "Prepare Capped Comparison" : "Keep Protected",
    },
  };
}

function buildRehearsalSummary(rehearsals) {
  const passedRehearsalWorkerIds = new Set(
    rehearsals
      .filter((item) => item.run?.evalStatus === "passed")
      .map((item) => item.workerId)
      .filter(Boolean),
  );
  return {
    rehearsals: rehearsals.length,
    completed: rehearsals.filter((item) => item.status === "completed").length,
    passed: rehearsals.filter((item) => item.run?.evalStatus === "passed").length,
    rehearsedWorkers: passedRehearsalWorkerIds.size,
    actualCostCents: rehearsals.reduce((sum, item) => sum + Number(item.run?.actualCostCents || 0), 0),
  };
}

function getAgentPlaybooksState(db, context = {}) {
  const aiTeam = context.aiTeam || getAiTeamState(db);
  const agentWorkbench = context.agentWorkbench || getAgentWorkbenchState(db);
  const agentToolPolicy = context.agentToolPolicy || getAgentToolPolicyState(db);
  const operatingBriefs = context.agentOperatingBriefs || context.operatingBriefs || getAgentOperatingBriefsState(db, {
    aiTeam,
    agentWorkbench,
    agentToolPolicy,
  });
  const definitions = aiTeam.definitions || [];
  const rehearsals = context.rehearsals || playbookRehearsalTasks(db);
  const rehearsalsByAgent = new Map();
  for (const rehearsal of rehearsals) {
    const list = rehearsalsByAgent.get(rehearsal.workerId) || [];
    list.push(rehearsal);
    rehearsalsByAgent.set(rehearsal.workerId, list);
  }
  const playbooks = definitions.map((definition) => {
    const playbook = buildPlaybook(definition, operatingBriefs.byAgent?.[definition.id]);
    const workerRehearsals = rehearsalsByAgent.get(definition.id) || [];
    const latestRehearsal = latestByTime(workerRehearsals, ["completedAt", "updatedAt", "createdAt"]);
    return {
      ...playbook,
      latestRehearsal,
      rehearsalStatus: latestRehearsal?.run?.evalStatus === "passed"
        ? "rehearsed"
        : latestRehearsal
          ? latestRehearsal.status
          : "not_rehearsed",
      rehearsalCount: workerRehearsals.length,
    };
  });
  const ready = playbooks.filter((playbook) => playbook.protectedSteps.length >= 3 && playbook.evidenceCaptured.length >= 3);
  const rehearsalSummary = buildRehearsalSummary(rehearsals);

  return {
    schema: AGENT_PLAYBOOK_SCHEMA,
    status: ready.length === playbooks.length ? "ready" : "needs_review",
    summary: {
      total: playbooks.length,
      ready: ready.length,
      protectedOnly: playbooks.filter((playbook) => playbook.operatorControl.live === "Keep Protected").length,
      cappedComparisonReady: playbooks.filter((playbook) => playbook.operatorControl.live === "Prepare Capped Comparison").length,
      rehearsals: rehearsalSummary.rehearsals,
      completedRehearsals: rehearsalSummary.completed,
      passedRehearsals: rehearsalSummary.passed,
      rehearsedWorkers: rehearsalSummary.rehearsedWorkers,
      actualCostCents: rehearsalSummary.actualCostCents,
      summary: `${ready.length}/${playbooks.length} worker playbooks are ready for protected local execution before OpenAI model connection.`,
      nextAction: rehearsalSummary.rehearsals
        ? "Review the latest rehearsal evidence, then run missing workers against the current manual market test."
        : "Use protected proof drills and manual market-test evidence to exercise playbooks before live model spend.",
    },
    byAgent: Object.fromEntries(playbooks.map((playbook) => [playbook.agentId, playbook])),
    rehearsals,
    playbooks,
  };
}

function mergeJsonIntoRow(db, table, id, field, patch) {
  const row = get(db, `SELECT ${field} FROM ${table} WHERE id = ?`, [id]);
  if (!row) return null;
  const merged = { ...fromJson(row[field], {}), ...patch };
  run(db, `UPDATE ${table} SET ${field} = ?, updated_at = ? WHERE id = ?`, [toJson(merged), now(), id]);
  return merged;
}

function queueAgentPlaybookRehearsal(db, agentId, options = {}) {
  const playbookState = getAgentPlaybooksState(db);
  const playbook = playbookState.byAgent?.[agentId];
  if (!playbook) throw new Error(`AI worker playbook not found: ${agentId}`);
  const marketContext = defaultMarketContext(db, options);
  const proofGoal = options.proofGoal || `Rehearse the ${playbook.name} protected playbook against the current manual market-test context. First move: ${playbook.firstMove}`;
  const queued = queueAgentWorkbenchProof(db, agentId, {
    source: "agent-playbooks",
    subject: marketContext.subject,
    buyer: marketContext.buyer,
    problem: marketContext.problem,
    offer: marketContext.offer,
    channel: marketContext.channel,
    proofGoal,
  });
  const rehearsalPatch = {
    playbookRehearsal: true,
    playbookSchema: AGENT_PLAYBOOK_SCHEMA,
    playbook: {
      trigger: playbook.trigger,
      firstMove: playbook.firstMove,
      protectedSteps: playbook.protectedSteps,
      evidenceCaptured: playbook.evidenceCaptured,
      handoff: playbook.handoff,
      successMetric: playbook.successMetric,
      stopRule: playbook.stopRule,
      modelConnectionRule: playbook.modelConnectionRule,
    },
    manualMarketContext: marketContext,
    noLiveModels: true,
    noExternalActions: true,
  };
  mergeJsonIntoRow(db, "workflows", queued.workflow.id, "metadata", rehearsalPatch);
  mergeJsonIntoRow(db, "commands", queued.command.id, "metadata", rehearsalPatch);
  mergeJsonIntoRow(db, "tasks", queued.task.id, "payload", rehearsalPatch);
  mergeJsonIntoRow(db, "tasks", queued.task.id, "result", {
    waitingFor: "protected_playbook_rehearsal",
    workerId: agentId,
    playbookFirstMove: playbook.firstMove,
  });

  run(
    db,
    "UPDATE workflows SET type = ?, title = ?, current_step = ? WHERE id = ?",
    ["agent_playbook_rehearsal", `AI Team - ${playbook.name} Playbook Rehearsal`, "protected playbook rehearsal queued", queued.workflow.id],
  );
  run(
    db,
    "UPDATE commands SET intent = ?, summary = ? WHERE id = ?",
    [
      "rehearse_ai_worker_playbook",
      `${playbook.name} playbook rehearsal queued against ${marketContext.subject}. No live model call, spend, publishing, or customer contact is allowed.`,
      queued.command.id,
    ],
  );
  run(
    db,
    "UPDATE tasks SET title = ? WHERE id = ?",
    [`${playbook.name} playbook rehearsal`, queued.task.id],
  );

  insertEvent(db, {
    actor: "agent_playbooks",
    type: "agent.playbook_rehearsal_queued",
    entityType: "task",
    entityId: queued.task.id,
    message: `${playbook.name} protected playbook rehearsal was queued against the current market-test context.`,
    metadata: { workflowId: queued.workflow.id, taskId: queued.task.id, workerId: agentId, marketContext },
  });

  return {
    ...queued,
    workflow: { ...queued.workflow, title: `AI Team - ${playbook.name} Playbook Rehearsal` },
    task: { ...queued.task, title: `${playbook.name} playbook rehearsal`, kind: "workbench_proof" },
    playbook,
    marketContext,
  };
}

function queueAgentPlaybookRehearsalSuite(db, options = {}) {
  const playbookState = getAgentPlaybooksState(db);
  const requestedAgentIds = Array.isArray(options.agentIds) && options.agentIds.length
    ? options.agentIds
    : playbookState.playbooks.map((playbook) => playbook.agentId);
  const selectedPlaybooks = [];
  const seen = new Set();

  for (const rawId of requestedAgentIds) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    const playbook = playbookState.byAgent?.[id];
    if (!playbook) throw new Error(`AI worker playbook not found: ${id}`);
    selectedPlaybooks.push(playbook);
    seen.add(id);
  }

  if (!selectedPlaybooks.length) throw new Error("Playbook rehearsal suite needs at least one worker.");

  const marketContext = defaultMarketContext(db, options);
  const teamName = options.teamName || "AI Team playbook rehearsal suite";
  const proofGoal = options.proofGoal || "Rehearse each selected worker's protected operating playbook against the current manual market-test context.";
  const queued = queueAgentWorkbenchProofSuite(db, {
    ...options,
    source: "agent-playbooks",
    teamName,
    agentIds: selectedPlaybooks.map((playbook) => playbook.agentId),
    subject: marketContext.subject,
    buyer: marketContext.buyer,
    problem: marketContext.problem,
    offer: marketContext.offer,
    channel: marketContext.channel,
    proofGoal,
  });
  const playbookById = new Map(selectedPlaybooks.map((playbook) => [playbook.agentId, playbook]));
  const suitePatch = {
    playbookRehearsalSuite: true,
    playbookSchema: AGENT_PLAYBOOK_SCHEMA,
    manualMarketContext: marketContext,
    noLiveModels: true,
    noExternalActions: true,
  };

  mergeJsonIntoRow(db, "workflows", queued.workflow.id, "metadata", suitePatch);
  mergeJsonIntoRow(db, "commands", queued.command.id, "metadata", suitePatch);
  run(
    db,
    "UPDATE workflows SET title = ?, current_step = ? WHERE id = ?",
    [`AI Team - ${teamName}`, "protected playbook rehearsal suite queued", queued.workflow.id],
  );
  run(
    db,
    "UPDATE commands SET intent = ?, summary = ? WHERE id = ?",
    [
      "rehearse_ai_worker_playbook_suite",
      `${teamName} queued for ${selectedPlaybooks.length} worker${selectedPlaybooks.length === 1 ? "" : "s"}. No live model call, spend, publishing, customer contact, or account action is allowed.`,
      queued.command.id,
    ],
  );

  const tasks = queued.tasks.map((task) => {
    const playbook = playbookById.get(task.workerId);
    const taskPatch = {
      ...suitePatch,
      playbookRehearsal: true,
      playbook: {
        trigger: playbook.trigger,
        firstMove: playbook.firstMove,
        protectedSteps: playbook.protectedSteps,
        evidenceCaptured: playbook.evidenceCaptured,
        handoff: playbook.handoff,
        successMetric: playbook.successMetric,
        stopRule: playbook.stopRule,
        modelConnectionRule: playbook.modelConnectionRule,
      },
    };
    mergeJsonIntoRow(db, "tasks", task.id, "payload", taskPatch);
    mergeJsonIntoRow(db, "tasks", task.id, "result", {
      waitingFor: "protected_playbook_rehearsal",
      workerId: task.workerId,
      playbookFirstMove: playbook.firstMove,
      suiteWorkflowId: queued.workflow.id,
    });
    run(db, "UPDATE tasks SET title = ? WHERE id = ?", [`${task.workerName} playbook rehearsal`, task.id]);
    return {
      ...task,
      title: `${task.workerName} playbook rehearsal`,
    };
  });

  insertEvent(db, {
    actor: "agent_playbooks",
    type: "agent.playbook_rehearsal_suite_queued",
    entityType: "workflow",
    entityId: queued.workflow.id,
    message: `${teamName} queued ${selectedPlaybooks.length} protected playbook rehearsal${selectedPlaybooks.length === 1 ? "" : "s"} against the current market-test context.`,
    metadata: {
      workflowId: queued.workflow.id,
      workerIds: selectedPlaybooks.map((playbook) => playbook.agentId),
      taskIds: tasks.map((task) => task.id),
      marketContext,
    },
  });

  return {
    ...queued,
    team: {
      name: teamName,
      workerCount: selectedPlaybooks.length,
      workers: selectedPlaybooks.map((playbook) => ({
        id: playbook.agentId,
        name: playbook.name,
      })),
    },
    workflow: { ...queued.workflow, title: `AI Team - ${teamName}` },
    tasks,
    playbooks: selectedPlaybooks,
    marketContext,
  };
}

module.exports = {
  AGENT_PLAYBOOK_SCHEMA,
  PLAYBOOKS,
  getAgentPlaybooksState,
  queueAgentPlaybookRehearsal,
  queueAgentPlaybookRehearsalSuite,
};
