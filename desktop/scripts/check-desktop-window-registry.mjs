import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseManagedWindowDefinitions(source) {
  const match = source.match(/const managedWindowDefinitions = \[(.*?)\];/s);
  if (!match) {
    throw new Error("Unable to locate managedWindowDefinitions.");
  }

  return [...match[1].matchAll(/\{\s*key:\s*"([^"]+)"\s*,\s*route:\s*"([^"]+)"/g)].map(
    ([, key, route]) => ({ key, route })
  );
}

function parseStringArray(source, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`const ${escapedName} = \\[(.*?)\\]`, "s"));
  if (!match) {
    throw new Error(`Unable to locate ${variableName}.`);
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function parseObjectKeys(source, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`const ${escapedName}(?::[^=]+)? = \\{(.*?)\\n\\};`, "s"));
  if (!match) {
    throw new Error(`Unable to locate ${variableName}.`);
  }

  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+):\s*/gm)].map(([, key]) => key);
}

function parseScenarioWorkspaceReferences(source) {
  const match = source.match(/const scenarioWorkspaceDefinitions = \[(.*?)\n\];/s);
  if (!match) {
    throw new Error("Unable to locate scenarioWorkspaceDefinitions.");
  }

  const definitions = [];
  for (const workspaceMatch of match[1].matchAll(/\{\s*id:\s*"([^"]+)"\s*,\s*windows:\s*\[(.*?)\]\s*\}/gs)) {
    const [, id, windowsSource] = workspaceMatch;
    const windows = [...windowsSource.matchAll(/"([^"]+)"/g)].map(([, key]) => key);
    definitions.push({ id, windows });
  }

  return definitions;
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return [...duplicates];
}

const mainSource = readFile("desktop/main.cjs");
const moduleSectionsSource = readFile("frontend/lib/module-sections.ts");
const terminalShellSource = readFile("frontend/components/darra-terminal-shell.tsx");

const managedDefinitions = parseManagedWindowDefinitions(mainSource);
const managedKeys = managedDefinitions.map((definition) => definition.key);
const managedRoutes = managedDefinitions.map((definition) => definition.route);
const managedDefinitionsByKey = new Map(
  managedDefinitions.map((definition) => [definition.key, definition])
);
const frontendManagedKeys = parseStringArray(moduleSectionsSource, "desktopManagedModuleSections");
const frontendDomIdKeys = parseObjectKeys(moduleSectionsSource, "desktopSectionDomIds");
const monitorRoleKeys = parseObjectKeys(mainSource, "managedWindowMonitorRoles");
const scenarioWorkspaces = parseScenarioWorkspaceReferences(mainSource);

const issues = [];

for (const key of findDuplicates(managedKeys)) {
  issues.push(`Duplicate Electron managed window key: ${key}`);
}

for (const route of findDuplicates(managedRoutes)) {
  issues.push(`Duplicate Electron managed window route: ${route}`);
}

for (const key of findDuplicates(frontendManagedKeys)) {
  issues.push(`Duplicate frontend managed window key: ${key}`);
}

const missingFromFrontend = managedKeys.filter((key) => key !== "dashboard" && !frontendManagedKeys.includes(key));
for (const key of missingFromFrontend) {
  issues.push(`Electron managed key missing from frontend registry: ${key}`);
}

const extraInFrontend = frontendManagedKeys.filter((key) => !managedKeys.includes(key));
for (const key of extraInFrontend) {
  issues.push(`Frontend managed key missing from Electron registry: ${key}`);
}

for (const key of frontendManagedKeys) {
  const definition = managedDefinitionsByKey.get(key);
  const expectedRoute = `/module/${key}`;

  if (definition && definition.route !== expectedRoute) {
    issues.push(
      `Managed module "${key}" route should be ${expectedRoute}, found ${definition.route}.`
    );
  }

  if (!frontendDomIdKeys.includes(key)) {
    issues.push(`Managed module "${key}" missing frontend desktopSectionDomIds entry.`);
  }
}

for (const key of monitorRoleKeys) {
  if (!managedKeys.includes(key)) {
    issues.push(`Monitor role mapping references unknown managed key: ${key}`);
  }
}

for (const workspace of scenarioWorkspaces) {
  for (const key of findDuplicates(workspace.windows)) {
    issues.push(`Scenario workspace "${workspace.id}" contains duplicate key: ${key}`);
  }

  for (const key of workspace.windows) {
    if (key === "dashboard") {
      issues.push(`Scenario workspace "${workspace.id}" cannot include dashboard.`);
      continue;
    }

    if (!managedKeys.includes(key)) {
      issues.push(`Scenario workspace "${workspace.id}" references unknown managed key: ${key}`);
    }
  }
}

if (!/const terminalWindowKeys:\s*readonly DesktopManagedWindowKey\[\]\s*=\s*\[\s*"dashboard",\s*\.\.\.desktopManagedModuleSections\s*\];/s.test(terminalShellSource)) {
  issues.push(
    "terminalWindowKeys is no longer derived from dashboard + desktopManagedModuleSections."
  );
}

if (issues.length > 0) {
  fail("Desktop window registry check failed:");
  for (const issue of issues) {
    fail(`- ${issue}`);
  }
} else {
  console.log(
    `Desktop window registry check passed (${managedKeys.length} Electron keys, ${frontendManagedKeys.length} frontend managed keys).`
  );
}
