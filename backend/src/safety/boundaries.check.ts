import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(__dirname, "..", "..");
const workspaceRoot = path.resolve(backendRoot, "..");

const readFile = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const listTypeScriptFiles = (rootPath: string): string[] => {
  const results: string[] = [];

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      results.push(fullPath);
    }
  }

  return results;
};

const protocolChecks = (): void => {
  const indexPath = path.join(backendRoot, "src", "index.ts");
  const storePath = path.join(workspaceRoot, "frontend", "store", "use-screener-store.ts");
  const appPath = path.join(workspaceRoot, "frontend", "components", "scalp-station-app.tsx");
  const indexSource = readFile(indexPath);
  const storeSource = readFile(storePath);
  const appSource = readFile(appPath);

  assert.ok(
    !indexSource.includes('type: "trade_decision_context_created"'),
    "Protocol boundary failed: backend must not emit trade_decision_context_created for protocolized flows."
  );

  const legacyStart = storeSource.indexOf('if (message.type === "trade_decision_context_created") {');
  const responseStart = storeSource.indexOf(
    'if (message.type === "decision_context_response") {',
    legacyStart
  );
  assert.ok(
    legacyStart >= 0 && responseStart > legacyStart,
    "Protocol boundary failed: could not isolate legacy/frontend decision context handlers."
  );

  const legacyBlock = storeSource.slice(legacyStart, responseStart);
  const forbiddenLegacyMutations = [
    "latestTradeDecisionContext",
    "pendingTradeDecisionContextId",
    "tradeDecisionContextError"
  ].filter((token) => legacyBlock.includes(token));

  assert.deepEqual(
    forbiddenLegacyMutations,
    [],
    `Protocol boundary failed: legacy decision-created handler mutates protocol success state (${forbiddenLegacyMutations.join(", ")}).`
  );

  const responseBlock = storeSource.slice(
    responseStart,
    storeSource.indexOf('if (message.type === "trade_decision_context_error") {', responseStart)
  );
  for (const status of ['"REJECTED"', '"FORCED_WAIT"']) {
    assert.ok(
      responseBlock.includes(`message.payload.status === ${status}`),
      `Protocol boundary failed: frontend must explicitly handle ${status}.`
    );
  }
  assert.ok(
    responseBlock.includes("message.payload.decisionContext"),
    "Protocol boundary failed: accepted response path must map from DecisionContextResponse."
  );
  for (const status of ['"ACCEPTED"', '"REJECTED"', '"FORCED_WAIT"']) {
    assert.ok(
      appSource.includes(`latestDecisionContextResponse.status === ${status}`),
      `Protocol boundary failed: scalp-station-app must explicitly branch on ${status}.`
    );
  }
};

const lifecycleAuthorityChecks = (): void => {
  const validatorPath = path.join(
    backendRoot,
    "src",
    "execution",
    "execution-contract-validator.ts"
  );
  const validatorSource = readFile(validatorPath);
  const backendFiles = listTypeScriptFiles(path.join(backendRoot, "src"));

  assert.ok(
    !validatorSource.includes("export const lifecycleWriterAuthority"),
    "Execution boundary failed: raw lifecycleWriterAuthority export still exists."
  );

  const authorityImports = backendFiles.filter((filePath) =>
    /^\s*import[^\n;]*\blifecycleWriterAuthority\b/m.test(readFile(filePath))
  );
  assert.deepEqual(
    authorityImports,
    [],
    `Execution boundary failed: raw lifecycle authority is still imported by ${authorityImports.join(", ")}.`
  );
};

const decisionCreationChecks = (): void => {
  const backendFiles = listTypeScriptFiles(path.join(backendRoot, "src"));
  const allowedCallers = new Set([
    path.join(backendRoot, "src", "decision", "decision-context-service.ts"),
    path.join(backendRoot, "src", "decision", "decision-context-fixture-factory.ts")
  ]);
  const callPattern = /\.\s*createTradeDecisionContext\(/;

  const violations = backendFiles.filter((filePath) => {
    if (filePath.endsWith(path.join("storage", "trade-decision-repository.ts"))) {
      return false;
    }

    return !allowedCallers.has(filePath) && callPattern.test(readFile(filePath));
  });

  assert.deepEqual(
    violations,
    [],
    `Decision boundary failed: non-decision-layer files still create final TradeDecisionContext directly (${violations.join(", ")}).`
  );
};

function main(): void {
  protocolChecks();
  lifecycleAuthorityChecks();
  decisionCreationChecks();

  console.log("boundary checks passed", {
    checkedAt: Date.now(),
    backendRoot,
    workspaceRoot
  });
}

try {
  main();
} catch (error) {
  console.error("boundary checks failed", error);
  process.exitCode = 1;
}
