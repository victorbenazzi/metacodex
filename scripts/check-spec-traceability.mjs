import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const specDirectory = resolve(process.argv[2] ?? "specs/agent-runtime-reliability");
const requirements = readFileSync(resolve(specDirectory, "requirements.md"), "utf8");
const tasks = readFileSync(resolve(specDirectory, "tasks.md"), "utf8");

const requiredIds = new Set(
  [...requirements.matchAll(/^((?:REQ|NFR)-\d{3})\b/gm)].map((match) => match[1]),
);
const triageSection = tasks.match(/## A\. Test triage([\s\S]*?)## B\./)?.[1] ?? "";
const traceSection = tasks.match(/## B\. Traceability map([\s\S]*?)## C\./)?.[1] ?? "";
const triagedIds = new Set(
  [...triageSection.matchAll(/\b((?:REQ|NFR)-\d{3}):\s*(?:MUST|SHOULD)\b/g)].map(
    (match) => match[1],
  ),
);
const tracedIds = new Set(
  [...traceSection.matchAll(/^\d+\.\s+((?:REQ|NFR)-\d{3}):\s+\S.+$/gm)].map(
    (match) => match[1],
  ),
);

const missingTriage = [...requiredIds].filter((id) => !triagedIds.has(id));
const missingTrace = [...triagedIds].filter((id) => !tracedIds.has(id));
const unknownTriage = [...triagedIds].filter((id) => !requiredIds.has(id));
const unknownTrace = [...tracedIds].filter((id) => !triagedIds.has(id));

if (missingTriage.length || missingTrace.length || unknownTriage.length || unknownTrace.length) {
  console.error(
    JSON.stringify(
      { missingTriage, missingTrace, unknownTriage, unknownTrace },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  `Traceability complete: ${requiredIds.size} requirements, ${triagedIds.size} verdicts, ${tracedIds.size} mapped tests.`,
);
