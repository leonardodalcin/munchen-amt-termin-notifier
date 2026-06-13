# Multi-Agent Development Playbook

> My working notes on how I actually prompt and steer Claude (Claude Code /
> Cowork) to build production software with **multiple agents** — the mental
> model, the concrete levers, and real examples of what shipped to production
> and what blew up.
>
> Distilled from my own build logs: the "Stealth" extraction system (an
> LLM-driven unstructured→structured pipeline built on **Mastra** + **Claude
> Code** in ~1.5 weeks, ~40 tasks over two weeks), and the production prompt
> templates behind **Sunny** (our ESG assistant). The war stories below are
> real failures I hit and fixed.

---

## The one idea that changed everything

**You don't *prompt* an agent — you *steer* it.**

The quality lever is not a cleverer system prompt. It's the **control structure
around the agent**. A system prompt is the *weakest* of the steering levers —
reach for it last. This is true at runtime (the workflow steers the agent) *and*
at dev-time (the process steers the subagents). Runtime steering and development
steering are the same muscle.

If you remember nothing else:

> **Steering = stop conditions + step budgets + feedback injection + tool scope
> + shared state.** A bigger prompt is not on that list.

---

## The mental model: three layers

I stopped thinking in terms of "one agent" and started thinking in three layers.
This applies whether the agents are running in production or building the app.

1. **Workflows / process own control flow** — deterministic orchestration,
   retries, stop conditions. *The workflow decides when it's done, never the
   model.*
2. **Agents are stateless workers** — bounded chunks of work, call tools, return
   outputs.
3. **Storage + tracing is the substrate** — every run produces artifacts you can
   query later. Make the runtime observable *first*; the rest is just iteration.

```
Workflow (control flow: retries, dountil, stop conditions)
   │  steers
   ▼
Agent (bounded work: calls tools, returns output)
   │  every run →
   ▼
Storage + tracing (queryable rows: what was said and done)
```

---

## Part 1 — The six steering levers (runtime)

When I fan out work to an agent, behavior is controlled by these, in roughly
this order of power. Example values are the ones that actually shipped in the
Stealth script-writer/extractor loop.

| Lever | What it looked like in production | What it controls |
|-|-|-|
| **Stop condition** | the `dountil` predicate: `passed \|\| iterationCount >= maxIterations` | *the workflow* decides done — never the model |
| **Step budget** | `maxSteps: 25` on the agent turn | a wandering agent can't loop forever |
| **Feedback injection** | the harness's failing `stderr` → `lastFailure`, rebuilt into the next prompt as the **top-priority** instruction | redirect with *ground truth*, not vibes |
| **Tool surface = scope** | `scriptWriter` gets sandbox tools; `extractor` is tool-less with a single per-call `submit` tool | constraining tools constrains behavior |
| **Shared state** | a `RequestContext` threads the sandbox handle / resource id / event callback across steps | state without making agents stateful |
| **Capacity** | model fallback ladder (Sonnet → Opus → Haiku on overload) | keeps the loop alive under load |

The loop, concretely:

```
Workflow ──prompt + lastFailure + iter/maxIter──▶ Agent turn (bounded by maxSteps)
   ▲                                                   │
   │                                                output
   │                                                   ▼
   └──────────── pass? | iter>=max? ◀──────────── Harness verdict
```

### Feedback injection is the real unlock

The single most effective prompt-level technique I use is **injecting a
machine-readable failure back into the next turn as the top instruction**. Not
"please try to fix the test" — the *actual* failing `stderr` / Zod path /
missing-row assertion, phrased as:

> Fix THAT. Don't rewrite what already worked.

That one framing stops the agent from helpfully refactoring the 90% that was
fine. The harness verdict *is* the feedback signal that drives the loop — vibes
are not.

---

## Part 2 — Multi-agent *development* (dev-time steering)

The biggest Claude Code lesson was **not** a prompting trick. It's that
multi-agent development scales with **process structure, not more agents**. The
speedup came from *cheap, enforced structure* — ids, hooks, PR gates — not from
trusting the model more. Structure is what makes parallelism safe.

The structure that produced ~40 tasks / ~40 PRs over two weeks:

- **`wiki/`** — a knowledge base (sources, syntheses, concepts) = shared memory
  across sessions.
- **`tasks/`** — a kanban with **real ids** (e.g. `STH-1234`), one unit of work
  per task, moved via `git mv`, auto-committed. Each finished task file
  self-documents its *why* and *what shipped*.
- **skills** — repeatable playbooks (setup, deploy, e2e, commit, PR self-review)
  so *any* session behaves the same way.
- **commit + PR gates** — a pre-commit hook blocks the commit unless
  `bun run check` (format + lint + typecheck + test) passes. That's the
  "definition of done", enforced locally.

The three rules that prevented chaos:

1. **One task id per parallel agent / workstream.** That id is the unit of
   isolation — a card, a branch, a commit scope, a worktree.
2. **Keep boundaries aligned with package boundaries** in the monorepo.
3. **Use the PR gate as the merge barrier.** Agents run independently; merges to
   `main` happen one at a time.

### How I prompt subagents (the dev-time version of the levers)

When I fan out Claude subagents to build, I steer them the same way I steer
runtime agents:

- **Bounded prompts** — one task id, one package, one clear definition of done.
- **"Return the conclusion, not the file dump."** A search/explore subagent
  should hand me the *answer* (the file:line, the decision), not paste 2,000
  lines back into context. This is the dev-time equivalent of "tool surface =
  scope".
- **Worktree isolation** — one task id ⇒ one worktree ⇒ safe parallelism.
- **The PR gate is the stop condition.** The subagent isn't "done" because it
  says so; it's done when `bun run check` is green and the PR gate passes.

> **EM angle:** parallelism is safe because of ids + hooks + PR gates, not
> because the model is trusted more.

---

## Part 3 — Real examples: what worked vs. what failed

These are verbatim war stories. Each one taught a lever.

### ✅ Worked → production

**A verification harness the workflow re-runs independently.**
Every project repo gets a bundled test (`scripts/extract.test.ts`) that validates
every output row against the project's Zod schema and asserts every
human-accepted row still appears. The agent runs `bun test` *itself* during its
turn (its own convergence signal) — **then the API re-runs the exact same test**
as an independent truth check before committing anything. "The agent said it
passed" is not proof; only an API-side pass commits.

> Lesson: an agent writing code is only useful if something *independent* checks
> it. Build the harness first.

**Human "accept" becomes three reinforcing signals on the next run.**
A reviewer accepting a row writes it to `rows/accepted.jsonl` + typed working
memory, which then feeds the next generation as (1) a few-shot example, (2) a
typed working-memory entry, and (3) a **hard test assertion**. The system gets
better without anyone re-prompting it.

**Observational memory to keep prompts affordable.**
A cheap model (Haiku) compresses old turns into deltas in the background, so the
agent reads a compact current summary instead of re-reading the world every
iteration. This shipped because of the next failure ↓.

**Consolidate micro-tasks into flag-gated PRs.**
On the Mastra migration I canceled a stale **15-issue** breakdown and replaced it
with **3 consolidated, flag-gated** issues/PRs. Fewer merge barriers, less
tracking overhead, same isolation.

### ❌ Failed → and what fixed it

**The 1M-token context blowup.**
Before observational memory, the script-writer's per-run context ballooned
**past 1M tokens** because every iteration re-read the full history. Fix: let a
cheap model compress old turns; cap *replay* with `lastMessages` (a replay cap,
**not** a storage cap — the full history stays in the table).

**"Passed the test, emitted zero rows in production."**
The production runner took document paths from the DB (bare filenames) while the
test walked `documents/` (prefixed). The *same* `extract.ts` passed the test and
produced **nothing** in prod.

> Lesson: your verification harness and your production harness must exercise the
> code the **same way**, or "passing" is meaningless.

**The Overview card that silently went blank.**
We matched observability spans by their human-friendly `name`
(`'workflow.generateExtractScript'`). A library version bump auto-reformatted the
name to `workflow run: 'generateScript'` and the card showed **no error, just no
data**. Fix: filter by stable identifiers (`spanType` + `entityId`), treat
`name` as display-only, and move the ids into one `names.ts` so the contract
lives in one place.

**Trying to make everything a chat message.**
I tried to model *every* signal as a conversation turn. Human acceptance is
**not** a chat message — it's a *verdict*, a separate data plane. Forcing it into
chat made the UI incoherent. Fix: two planes — the *chat plane* (what was said
and done) and the *acceptance plane* (what's correct) — reconciled through memory,
not through chat.

**Trying to fix behavior with a bigger system prompt.**
Every time I reached for a longer persona before reaching for a stop
condition / budget / feedback loop / tool scope, I was pulling the weakest lever.
The behavior problems were control-structure problems wearing a prompt costume.

---

## Part 4 — Production prompt anatomy (the Sunny templates)

Separate from the agent loop, here's how the *prompts themselves* are written for
production. Every LLM input is a **prompt** made of **messages**: a **system**
message (persona, guardrails, goal — users never touch it), one or more **user**
messages, and optionally an **assistant** prefill.

We don't hand-write prompts inline — we use **templates** in Markdown with
`{{variables}}` that can `@@@refer to other prompts@@@`, version-controlled in
Langfuse:

```markdown
SYSTEM: You are Sunny, Sunhat's highly accurate and context-aware assistant
helping ESG professionals respond to questions from rating agencies.

The current year is {{currentYear}}.

@@@langfusePrompt:name=markdown-table-generation|label=production@@@
```

…which **compiles** to a fully-resolved system prompt at request time. Patterns
that consistently produced shippable output:

- **Numbered, imperative instructions** in a `<instructions>…</instructions>`
  block (the production `sunny` user template has 16 of them), e.g. "Use **only**
  the provided context", "ALWAYS cite sources", "Do **not** speculate", "You MUST
  respond in the user's query language".
- **Wrap every input in named tags** so the model can't confuse them:
  `<query>{{query}}</query>`, `<answer-template>{{answerTemplate}}</answer-template>`,
  `<user-preferences>{{instructions}}</user-preferences>`.
- **Exact refusal strings.** Guardrails specify the *verbatim* sentence to return
  on a prohibited request — no improvisation.
- **One worked example beats a paragraph of rules** (chain-of-thought / few-shot)
  — especially for formatting like compact Markdown tables.
- **Refresh the role every 4–6 messages** in long chats so the persona doesn't
  drift.

---

## TL;DR

- **Steer, don't prompt.** Stop conditions, step budgets, feedback injection,
  tool scope, shared state — the system prompt is last.
- **Inject ground-truth failures** back as the top instruction: "fix THAT, don't
  rewrite what worked."
- **Build the verification harness first**, and make it exercise the code the
  *same way production does*.
- **Multi-agent dev scales with process structure** — task ids, worktrees,
  skills, PR gates — not with more agents or more trust.
- **One task id per workstream; the PR gate is the merge barrier.**
- **"Return the conclusion, not the file dump."**
- **Make the runtime observable first — the rest is just iteration.**
