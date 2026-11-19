# Game Engine Core: known defects and risks

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-060, ADR-070 (Reserved, collision)
- **Related tickets:** GE-001, GE-090
- **Canonical sources:** test runs recorded in [implementation-status.md](implementation-status.md)

## 1. Defects

| Id | Defect | Severity | State |
|---|---|---|---|
| GE-D1 | One island-map test that scans the asset catalogue failed once in a full `src/features/island-map/three/` run and passed on rerun (baseline `5b300e30`, before any engine change) | Low (flaky test, not product) | Open; observed, not investigated |

## 2. Risks

| Id | Risk | Mitigation |
|---|---|---|
| GE-R1 | `core/gameengine` contains the unmerged movement stack (PR #26 to #36). If those PRs change before merging, this branch must merge them again | Merge order O4 in [decisions.md](decisions.md); merge, never rebase |
| GE-R2 | Rename conflicts if a realm branch later edits a moved module | No realm branch edits them today (measured 2026-11-18); realm leads agreed to request changes from the engine lead |
| GE-R3 | Temporary duplication: engine components port platform math, and atmosphere will be ported | Each port carries a source note; GE-076 removes the legacy copy after migration |
| GE-R4 | `createLocationEngine` keeps growing on realm branches while the engine runtime exists beside it | Adopt the runtime piece by piece per migration; move it in GE-076 |
| GE-R5 | Scoring economy (XP, coins) conflicts with the mandatory scoring standard | Owner decision O5; engine claims stay neutral facts |
| GE-R6 | Performance targets (ADR-020) are unmeasured | Diagnostics and renderer stats exist; the measurement harness is LAI-2105 |
| GE-R7 | WebGL, visual and touch behaviour are not covered by unit tests | Owner QA and browser checks at merge readiness (GE-090) |
| GE-R8 | `DECISIONS.md` merge resolution (E9) may differ from how the movement owner resolves PR #26 | Owner decision O3; the branch follows the owner's choice |
