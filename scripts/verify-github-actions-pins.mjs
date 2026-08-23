import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/u;
const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);

export function findUnpinnedActionReferences(source, path = "workflow.yml") {
  const findings = [];
  const lines = source.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    const match = /^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?(?:\s*#.*)?$/u.exec(line);
    const reference = match?.[1];
    if (reference === undefined || reference.startsWith("./")) continue;

    const separatorIndex = reference.lastIndexOf("@");
    const revision = separatorIndex === -1 ? "" : reference.slice(separatorIndex + 1);
    if (FULL_COMMIT_SHA.test(revision)) continue;

    findings.push({
      path,
      line: index + 1,
      reference,
    });
  }

  return findings;
}

export async function verifyGithubActionPins(root = process.cwd()) {
  const workflowsDirectory = resolve(root, ".github/workflows");
  const workflowPaths = await listWorkflowFiles(workflowsDirectory);
  const findings = [];

  for (const path of workflowPaths) {
    const source = await readFile(path, "utf8");
    findings.push(...findUnpinnedActionReferences(source, relative(root, path)));
  }

  return findings;
}

async function listWorkflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await listWorkflowFiles(path));
      continue;
    }
    if (entry.isFile() && WORKFLOW_EXTENSIONS.has(extname(entry.name))) {
      paths.push(path);
    }
  }

  return paths.sort();
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node scripts/verify-github-actions-pins.mjs\n");
    return 0;
  }

  const findings = await verifyGithubActionPins();
  if (findings.length === 0) {
    process.stdout.write("GitHub Actions references are pinned to full commit SHAs.\n");
    return 0;
  }

  process.stderr.write("GitHub Actions must use full 40-character commit SHAs:\n");
  for (const finding of findings) {
    process.stderr.write(`  ${finding.path}:${finding.line} ${finding.reference}\n`);
  }
  return 1;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (import.meta.url === invokedPath) {
  process.exitCode = await main();
}
