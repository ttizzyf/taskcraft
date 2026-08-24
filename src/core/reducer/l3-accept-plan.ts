// Feasibility pass transaction step for L3. The caller already owns the
// command transaction; every child, relation, graph and event rolls back with
// the review when any validation or insert fails.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import {
  type L3FrameResult,
  type L3ModuleProposal,
  type L3PlanResult,
  validateL3PlanContract,
} from "../lifecycle/l3-contract.js";
import {
  L3_FACTS_DIGEST,
  L3_FRAME_NODE_ID,
  L3_LEGACY_CHILD_COMPILER_VERSION,
  L3_LEGACY_MODULAR_COMPILER_VERSION,
  L3_SPEC_BINDING_CHILD_COMPILER_VERSION,
  L3_SPEC_BINDING_COMPILER_VERSION,
  L3_POLICY_DIGEST,
} from "../lifecycle/l3.js";
import type { ResolvedSpecBinding } from "../../spec/bindings.js";
import { insertLifecycleSpecBindings } from "../../store/spec-facts.js";
import { materializeInheritedChildLifecycle } from "./l3-child-materialize.js";
import {
  insertAcceptedRelations,
  insertSingleValidations,
  invalidL3Plan,
  type MaterializedL3Child,
  resolveReusableChildren,
} from "./l3-accepted-relations.js";
import { materializeL3Graph } from "./l3-materialize.js";
import { insertEvent } from "./shared.js";
import { allocateTaskId, insertTaskRow } from "./task-row.js";
import {
  insertAcceptedPlanSpecBindings,
  normalizePlanSpecSelections,
  validateAcceptedSpecBindings,
} from "./l3-spec-bindings.js";

export interface AcceptedL3Plan {
  newRevision: number;
  mode: "modules" | "single";
  materializedChildren: MaterializedL3Child[];
}

export function acceptL3Plan(
  database: TaskcraftDatabase,
  snapshot: TaskSnapshot,
  reviewAttempt: { id: string; lifecycleRevision: number; host: string },
  planAttemptId: string,
  actor: string,
  now: string,
  acceptedSpecBindings:
    | {
        execution: ResolvedSpecBinding[];
        modules: Record<string, ResolvedSpecBinding[]>;
      }
    | undefined,
  planningCompilerVersion: string,
): AcceptedL3Plan {
  if (snapshot.level !== 3) {
    throw invalidL3Plan(snapshot.id, [
      "feasibility materialization requires an L3 task",
    ]);
  }

  const attempts = getAttempts(database, snapshot.id).filter(
    (attempt) => attempt.lifecycleRevision === reviewAttempt.lifecycleRevision,
  );
  const planAttempt = attempts.find((attempt) => attempt.id === planAttemptId);
  const frameAttempt = [...attempts]
    .filter(
      (attempt) =>
        attempt.nodeId === L3_FRAME_NODE_ID &&
        attempt.status === "finished" &&
        attempt.outcome === "success",
    )
    .at(-1);

  if (
    planAttempt?.status !== "finished" ||
    planAttempt.outcome !== "success" ||
    planAttempt.resultJson === null ||
    frameAttempt?.resultJson === null ||
    frameAttempt === undefined
  ) {
    throw invalidL3Plan(snapshot.id, [
      "accepted review does not reference a complete Frame and Plan",
    ]);
  }

  const frame = JSON.parse(frameAttempt.resultJson) as L3FrameResult;
  const plan = normalizePlanSpecSelections(
    JSON.parse(planAttempt.resultJson) as L3PlanResult,
    planningCompilerVersion,
  );
  const validation = validateL3PlanContract(frame, plan);
  if (!validation.valid) {
    throw invalidL3Plan(snapshot.id, validation.problems);
  }

  const resolvedSpecBindings = validateAcceptedSpecBindings(
    snapshot.id,
    plan,
    acceptedSpecBindings,
    planningCompilerVersion,
  );

  const reusableChildren = resolveReusableChildren(
    database,
    snapshot,
    plan.modules,
    resolvedSpecBindings.modules,
  );

  const newRevision = snapshot.currentLifecycleRevision + 1;
  materializeL3Graph(database, {
    taskId: snapshot.id,
    revision: newRevision,
    reasonCode: "contract_changed",
    reason: `accepted L3 ${plan.decomposition.mode} plan`,
    compilerVersion: planningCompilerVersion,
    factsDigest: L3_FACTS_DIGEST,
    policyDigest: L3_POLICY_DIGEST,
    changeSummary: {
      planningRevision: reviewAttempt.lifecycleRevision,
      sourcePlanAttemptId: planAttempt.id,
      feasibilityReviewAttemptId: reviewAttempt.id,
      executionMode: plan.executionMode,
      integrationPath: plan.integrationPath,
    },
    objective: frame.objective,
    actor,
    now,
    kind: plan.decomposition.mode,
  });

  database
    .prepare(
      `INSERT INTO lifecycle_execution_sources (
         task_id, lifecycle_revision, mode, planning_revision,
         source_plan_attempt_id, feasibility_review_attempt_id
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshot.id,
      newRevision,
      plan.decomposition.mode,
      reviewAttempt.lifecycleRevision,
      planAttempt.id,
      reviewAttempt.id,
    );

  insertAcceptedPlanSpecBindings(database, {
    taskId: snapshot.id,
    lifecycleRevision: newRevision,
    mode: plan.decomposition.mode,
    planAttemptId: planAttempt.id,
    bindings: resolvedSpecBindings.execution,
    actor,
    now,
  });

  insertAnchors(database, snapshot.id, newRevision, frame, plan);
  const children =
    plan.decomposition.mode === "modules"
      ? materializeChildren(
          database,
          snapshot,
          newRevision,
          planAttempt.id,
          plan.modules,
          reusableChildren,
          resolvedSpecBindings.modules,
          actor,
          now,
          planningCompilerVersion,
        )
      : [];

  if (plan.decomposition.mode === "modules") {
    insertAcceptedRelations(database, snapshot.id, newRevision, plan, children);
  } else {
    insertSingleValidations(database, snapshot.id, newRevision, plan);
  }

  database
    .prepare(
      `UPDATE tasks
       SET current_lifecycle_revision = ?, objective_md = ?, scope_json = ?,
           acceptance_json = ?, non_goals_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      newRevision,
      frame.objective,
      JSON.stringify(frame.scope),
      JSON.stringify(frame.acceptanceAnchors.map((anchor) => anchor.text)),
      JSON.stringify(frame.nonGoals),
      now,
      snapshot.id,
    );

  insertEvent(database, {
    taskId: snapshot.id,
    lifecycleRevision: newRevision,
    nodeId: null,
    attemptId: null,
    eventType: "l3.plan_accepted",
    payload: {
      mode: plan.decomposition.mode,
      planningRevision: reviewAttempt.lifecycleRevision,
      sourcePlanAttemptId: planAttempt.id,
      feasibilityReviewAttemptId: reviewAttempt.id,
      childTaskIds: children.map((child) => child.taskId),
    },
    postTaskRevision: snapshot.revision + 1,
    actorInstanceId: actor,
    host: reviewAttempt.host,
    occurredAt: now,
  });

  return {
    newRevision,
    mode: plan.decomposition.mode,
    materializedChildren: children,
  };
}

function insertAnchors(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  frame: L3FrameResult,
  plan: L3PlanResult,
): void {
  const dispositionByAnchor = new Map(
    plan.coverage.map((coverage) => [coverage.anchorId, coverage]),
  );
  const insert = database.prepare(
    `INSERT INTO lifecycle_acceptance_anchors (
       task_id, lifecycle_revision, anchor_id, text, disposition, reason
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const anchor of frame.acceptanceAnchors) {
    const coverage = dispositionByAnchor.get(anchor.id)!;
    insert.run(
      taskId,
      revision,
      anchor.id,
      anchor.text,
      coverage.disposition,
      coverage.disposition === "required" ? null : coverage.reason,
    );
  }
}

function materializeChildren(
  database: TaskcraftDatabase,
  parent: TaskSnapshot,
  parentRevision: number,
  planAttemptId: string,
  modules: L3ModuleProposal[],
  reusableChildren: Map<string, TaskSnapshot>,
  moduleSpecBindings: Record<string, ResolvedSpecBinding[]>,
  actor: string,
  now: string,
  planningCompilerVersion: string,
): AcceptedL3Plan["materializedChildren"] {
  const children: AcceptedL3Plan["materializedChildren"] = [];

  for (const [orderIndex, module] of modules.entries()) {
    const reusable = reusableChildren.get(module.key);
    if (reusable !== undefined) {
      database
        .prepare(
          `INSERT INTO lifecycle_child_requirements (
             parent_task_id, parent_lifecycle_revision, module_key,
             child_task_id, requirement_status, order_index,
             source_plan_attempt_id
           ) VALUES (?, ?, ?, ?, 'required', ?, ?)`,
        )
        .run(
          parent.id,
          parentRevision,
          module.key,
          reusable.id,
          orderIndex,
          planAttemptId,
        );
      insertEvent(database, {
        taskId: parent.id,
        lifecycleRevision: parentRevision,
        nodeId: null,
        attemptId: null,
        eventType: "l3.child_reused",
        payload: {
          childTaskId: reusable.id,
          moduleKey: module.key,
          sourcePlanAttemptId: planAttemptId,
        },
        postTaskRevision: parent.revision + 1,
        actorInstanceId: actor,
        host: null,
        occurredAt: now,
      });
      children.push({
        moduleKey: module.key,
        taskId: reusable.id,
        level: reusable.level as 1 | 2,
        reused: true,
      });
      continue;
    }

    const taskId = allocateTaskId(database);
    insertTaskRow(
      database,
      taskId,
      {
        title: module.title,
        level: module.level,
        objectiveMd: module.objective,
        scope: module.scope,
        acceptance: module.acceptance,
        nonGoals: module.nonGoals,
        classificationFacts: {
          source: "l3-module",
          parentTaskId: parent.id,
          moduleKey: module.key,
        },
        classificationReasons: [module.reason],
        parentTaskId: parent.id,
      },
      now,
    );
    materializeInheritedChildLifecycle(database, {
      taskId,
      level: module.level,
      objective: module.objective,
      parentTaskId: parent.id,
      parentLifecycleRevision: parentRevision,
      moduleKey: module.key,
      sourcePlanAttemptId: planAttemptId,
      factsDigest: L3_FACTS_DIGEST,
      policyDigest: L3_POLICY_DIGEST,
      actor,
      now,
      ...(planningCompilerVersion === L3_LEGACY_MODULAR_COMPILER_VERSION
        ? { compilerVersion: L3_LEGACY_CHILD_COMPILER_VERSION }
        : planningCompilerVersion === L3_SPEC_BINDING_COMPILER_VERSION
          ? { compilerVersion: L3_SPEC_BINDING_CHILD_COMPILER_VERSION }
          : {}),
    });
    database
      .prepare(
        `INSERT INTO lifecycle_child_requirements (
           parent_task_id, parent_lifecycle_revision, module_key,
           child_task_id, requirement_status, order_index,
           source_plan_attempt_id
         ) VALUES (?, ?, ?, ?, 'required', ?, ?)`,
      )
      .run(
        parent.id,
        parentRevision,
        module.key,
        taskId,
        orderIndex,
        planAttemptId,
      );
    database
      .prepare(
        `INSERT INTO lifecycle_inherited_planning (
           child_task_id, child_lifecycle_revision, parent_task_id,
           parent_lifecycle_revision, module_key, source_plan_attempt_id
         ) VALUES (?, 1, ?, ?, ?, ?)`,
      )
      .run(taskId, parent.id, parentRevision, module.key, planAttemptId);
    insertLifecycleSpecBindings(database, {
      taskId,
      lifecycleRevision: 1,
      nodeIds:
        module.level === 1
          ? ["execute-1", "record-1"]
          : ["execute-1", "review-1", "record-1"],
      bindings: moduleSpecBindings[module.key] ?? [],
      source: {
        kind: "inherited_plan",
        taskId: parent.id,
        attemptId: planAttemptId,
      },
      actor,
      now,
    });
    insertEvent(database, {
      taskId,
      lifecycleRevision: 1,
      nodeId: null,
      attemptId: null,
      eventType: "task.child_materialized",
      payload: {
        parentTaskId: parent.id,
        parentLifecycleRevision: parentRevision,
        moduleKey: module.key,
        sourcePlanAttemptId: planAttemptId,
      },
      postTaskRevision: 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });
    children.push({
      moduleKey: module.key,
      taskId,
      level: module.level,
      reused: false,
    });
  }

  return children;
}
