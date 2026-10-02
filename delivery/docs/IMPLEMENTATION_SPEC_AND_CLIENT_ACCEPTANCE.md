# AURELIUS MVP — Implementation Spec & Client Acceptance Matrix
## Based on client TЗ + current Production Technical Plan v10

### 1. What is already demonstrated
The current vertical slice already demonstrates the core flow: query -> Search Plan -> source discovery -> page research -> extraction -> deduplication -> Quality Gate -> evidence -> structured results -> export.

### 2. What must be completed before calling the MVP production-ready

| Area | Current baseline | Required final state | Acceptance evidence |
|---|---|---|---|
| Query understanding | Demo | Strict SearchTask JSON | 3 test prompts |
| Search Plan | Demo | Persisted + cost estimate + source classes | task record |
| Source Registry | Demo | Persistent registry + health + reuse | repeat-search test |
| Acquisition | Live web slice | Access ladder + fallback + policy state | blocked-source tests |
| Extraction | Typed result contract | Adaptive schema + field evidence | field accuracy benchmark |
| Deduplication | Basic | URL + identifiers + semantic checks | duplicate fixture |
| Quality Gate | 8 checks in demo | Deterministic PASS/REVIEW/FAIL | gate report |
| Reliability | Demo route | Checkpoints + pause/resume/cancel | worker restart test |
| Budget | Settings | Enforced hard stop | budget test |
| Security | Settings/spec | Prompt injection + SSRF + secrets controls | security checklist |
| Exports | CSV | CSV + styled XLSX + PDF + Google Docs-compatible DOCX | sample files |
| UI | Premium demo | Responsive production workspace | phone + desktop QA |
| Benchmark | Informal demo | Ground-truth benchmark | report |
| Documentation | Technical plan | Runbook + deployment + ownership | handover pack |

### 3. Source-access policy
Maximum information extraction means maximum permitted coverage, not bypassing protected access. For blocked or challenge-protected sources the agent should use a permitted API/provider, a user-authorized route when the source allows it, or manual review; otherwise mark the source unavailable.

### 4. Export standard
All exports should carry the same dataset version and task ID.

XLSX:
- Summary
- Results
- Sources
- Evidence
- filters, freeze panes, hyperlinks, wrapped evidence, conditional formatting

PDF:
- title page / run summary
- KPIs
- source coverage
- result table
- evidence appendix
- limitations

Google Docs:
- produce a DOCX that Google Docs imports cleanly
- optional future direct Drive export via OAuth connection
- never store a Google password or raw credential in the application

### 5. No customer data dependency
The implementation can continue using the current demo dataset, synthetic benchmark fixtures, and public sources. Customer-specific logins, private databases and paid source subscriptions should be injected later through the owner's production accounts.

### 6. Recommended milestone gates

**M1 — Architecture + Source Feasibility**
- contracts frozen
- source matrix validated
- access policy implemented

**M2 — Deep Search**
- one deep real-estate flow works end-to-end
- evidence and Quality Gate are deterministic
- checkpoint/resume works

**M3 — MVP Acceptance**
- real-estate deep case
- investors simplified
- companies/specialists simplified
- benchmark + exports + runbook

### 7. Definition of done
A search is not “done” because it returned rows. It is done when every accepted result is traceable to source evidence, duplicates are resolved, access restrictions are explicit, cost is recorded, and the result can be exported reproducibly.
