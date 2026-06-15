# Codex Execution Rules

## 1. Scope rule
Codex is allowed to modify ONLY files explicitly listed in the PR prompt.

Any other changes = INVALID PR.

---

## 2. Architecture rule
Execution must never reintroduce:
- risk logic inside execution service
- decision logic inside UI
- duplicated risk calculations

Risk Authority is the single source of truth.

---

## 3. Atomic PR rule
Each PR must change ONE domain only:

Allowed domains:
- risk
- execution
- decision
- signal
- review

No cross-domain refactor in same PR.

---

## 4. No cleanup rule
Codex must NOT:
- remove unrelated files
- format unrelated modules
- refactor unused code
Unless explicitly requested.

---

## 5. Validation rule
Every PR must include:
- backend build
- frontend build
- safety check (if applicable)

No PR is valid without commands listed.

---

## 6. Truth rule
If architecture conflicts appear:
STOP and ask instead of guessing.