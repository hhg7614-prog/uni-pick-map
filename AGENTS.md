# UNI PICK Agent Brain Working Agreement

## 1. Mission and scope

This repository develops and operates **UNI PICK** and its Agent Brain.
Keep every planned feature, tool, automation, and code change within one of the
following work domains. Do not add unrelated product features without the
user's explicit approval.

```text
Agent Brain
├─ UNI PICK work
│  ├─ University search tools
│  ├─ Notice-board inspection tools
│  └─ Source activation and source-quality tools
├─ Document work
│  ├─ PDF analysis
│  ├─ Word document creation
│  └─ PowerPoint creation
├─ Development work
│  ├─ Code reading
│  ├─ Code changes
│  ├─ Tests
│  └─ Error analysis
└─ Research work
   ├─ Web search
   ├─ Source comparison
   └─ Report writing
```

When a request touches more than one domain, state the domain sequence before
acting. Example: `UNI PICK inspection -> research -> report writing`.

## 2. Agent Brain architecture

Keep the Agent Brain separated into the following stages:

```text
Observe -> Think/Plan -> Policy check -> Execute -> Verify -> Record -> Notify
```

- The Brain decides and records the next action; it must not run arbitrary
  shell commands or mutate production data directly.
- Executors may call only an explicit allowlist of named actions.
- Every automatic action must save a result record with input, output, time,
  changed files, validation result, and retry/rollback outcome.
- Automatic deployment is allowed only after its defined tests, data validation,
  and post-deploy health check all pass.
- Never automatically delete large datasets, loosen source-verification rules,
  expose secrets, or overwrite a production configuration without a backup and
  an explicit policy entry.

## 3. UNI PICK operating rules

- Collect news only from enabled and verified sources.
- Preserve existing public data when collection, validation, or deployment
  fails; do not replace it with partial or unverified output.
- Handle transient network failures with bounded retry and backoff. Quarantine
  repeated failures while allowing other universities to continue.
- Keep source activation, collection, preview generation, and deployment as
  separate named actions with their own validation gates.
- Treat external URLs, dates, selectors, source host matching, duplicate
  detection, and public-preview eligibility as data-quality gates.

## 4. Required protocol for JSON and JavaScript changes

Before editing **any `.json` or `.js` file**, always do all of the following:

1. State the absolute path and why the file must change.
2. Show the command that opens the file before editing it. Use PowerShell:

   ```powershell
   Get-Content -Raw -LiteralPath "D:\hhg(code)\path\to\file.js"
   ```

3. Read the complete current file before deciding on the edit.
4. Make the smallest safe change, preserving valid complete JSON or JavaScript.
   Do not replace unrelated user changes.
5. Validate after editing:

   ```powershell
   node --check "D:\hhg(code)\path\to\file.js"
   ```

   For JSON, parse the complete file:

   ```powershell
   node -e "JSON.parse(require('fs').readFileSync('D:\\hhg(code)\\path\\to\\file.json', 'utf8')); console.log('JSON OK')"
   ```

6. In the handoff, provide the absolute file path, the same command for opening
   the file, a complete-file view when the user asks to see the source, and the
   exact validation result.

## 5. Verification rules

- For a JavaScript change, run `node --check` on changed files and relevant
  targeted tests; run `npm test` for shared agent, API, collector, or data-flow
  changes when feasible.
- For data/source changes, run the relevant source and preview validation before
  any collection or deployment.
- For a deployment change, verify the deployed API or page after deployment.
- Report failures plainly. Do not claim a task is complete if required
  verification was skipped or failed.

## 6. Documentation and safety

- Do not include `.env` values, tokens, or credentials in code, reports, logs,
  prompts, or commits.
- Prefer project-relative paths in code; use absolute paths only in operator
  commands and handoff instructions.
- Keep generated reports, run logs, backups, and temporary data out of source
  code unless they are intentionally tracked project artifacts.
- When a request is outside the scope in section 1, explain the mismatch and
  ask for explicit direction before extending the system.
