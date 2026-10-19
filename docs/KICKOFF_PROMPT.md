# Kickoff prompts for Claude Code

Paste these into Claude Code, from the **root of the repository**, after copying `CLAUDE.md`, `ROADMAP.md` and the `docs/` folder into it.

---

## Prompt 1 — First session (audit and Phase 0 plan)

```
You are starting work on Sentinel. Before writing any code:

1. Read CLAUDE.md, ROADMAP.md, and everything in docs/.
2. Audit the current repository (frontend/, backend/, ml/, docker-compose.yml, tests).
   Do NOT open or print any .env file.
3. Produce a written audit with:
   - what exists and works (with file references),
   - what is fake, weak, or insecure (compare against CLAUDE.md section 13),
   - anything in the docs that conflicts with the real code,
   - risks for the migration to a TypeScript monorepo with multi-tenancy.
4. Propose a concrete, ordered plan for Phase 0 (tasks 0.1 to 0.10), with the
   commits you intend to make and how you will keep the existing tests green.
5. Stop and wait for my approval. Do not modify files yet.

Rules: follow CLAUDE.md strictly. Ask before destructive actions or adding
major dependencies. Be honest about anything you cannot verify.
```

---

## Prompt 2 — Execute a task or a phase

```
Continue Sentinel. Read ROADMAP.md and take the next unchecked task
(currently: <TASK ID AND TITLE>).

1. Restate the acceptance criteria in your own words.
2. If the task touches more than 3 files, write a short plan first.
3. Implement in small commits (Conventional Commits).
4. Add or update tests. Run typecheck, lint and tests; fix failures.
5. Verify the acceptance criteria and show evidence (test output, curl, screenshot).
6. Tick the box in ROADMAP.md, add a line to docs/CHANGELOG.md, and append any
   decision a future session needs to the Decisions log.
7. Summarise: what changed, what you assumed, what remains, anything risky.

Do not start the next task unless I ask.
```

---

## Prompt 3 — Frontend work (Phase 4)

```
Work on Sentinel's frontend. Read docs/DESIGN_SYSTEM.md fully first and follow it
exactly: tokens only (no raw hex in components), Radix primitives, solid overlays,
URL as state, designed loading/empty/error states, keyboard access, WCAG AA.

Task: <ROADMAP TASK ID AND TITLE>.

Before coding, list the components you will create or reuse. After coding, run
the app, check the page at 1440 px and 375 px, both themes, and attach
screenshots. Run the axe accessibility check and fix serious violations.
```

---

## Prompt 4 — ML work (Phase 1 / 2)

```
Work on Sentinel's ML. Read docs/ML_AND_DETECTION.md fully and follow its honesty
rules: macro-F1 plus per-class results with support, no accuracy-only reporting,
two feature schemas kept separate, never score a flow with a mismatched model,
benchmark and lab results reported separately.

Task: <ROADMAP TASK ID AND TITLE>.

Record library versions with every artefact. Add pytest coverage. Generate the
model card. Tell me explicitly about weak classes or unstable estimates.
```

---

## Prompt 5 — Code review before merging

```
Review the changes on this branch as a strict senior engineer against CLAUDE.md
and the relevant docs. Check: tenant scoping on every query, authorization on
every route, input validation, error envelope, secrets handling, tests for the
failure paths, accessibility, empty/loading/error states, mock data leaks, and
honesty of any number or label shown to users. List problems by severity with
file and line references, then fix the blockers.
```

---

## Prompt 6 — Start of a fresh session (context recovery)

```
New session on Sentinel. Read CLAUDE.md and ROADMAP.md (especially the Decisions
log), check `git log --oneline -20` and `git status`, and tell me in 10 lines:
where we are, what the next unchecked task is, and anything that looks broken.
Do not change files yet.
```

---

## Tips for working with Claude Code

- Start with plan mode (or ask for a plan first) on anything that touches many files.
- One task per session where possible; run `/clear` between phases to keep context sharp. Because `CLAUDE.md` and `ROADMAP.md` carry the memory, nothing is lost.
- Commit after every green task. If a change goes wrong, revert the commit instead of patching blindly.
- Keep `ROADMAP.md` honest: unticked means not demonstrably done.
- When the docs and reality disagree, update the docs in the same commit and note it in the Decisions log.
- You stay the product owner: if a spec decision feels wrong, change the doc first, then ask Claude Code to follow it.
