# AGENTS.md

AI coding agent guide for the Personal Investment Intelligence Platform.

This file defines the behavioral rules, architecture constraints, engineering conventions, financial-computing rules, and execution playbooks that Codex and sub-agents must follow when working in this repository.

---

## 1. Behavioral Guidelines

These rules come first because they prevent the majority of avoidable implementation mistakes.

### 1.1 Think Before Coding

Before changing code:

- Understand the requested outcome, not just the literal wording.
- Inspect the relevant module and nearby existing implementations first.
- State material assumptions when they affect architecture, financial semantics, or API behavior.
- If multiple valid implementations exist, prefer the simplest one consistent with existing architecture.
- Do not silently invent missing business rules.
- If the request conflicts with an existing architectural decision, stop and surface the conflict instead of working around it.

For non-trivial tasks, produce a short execution plan containing:

1. files/modules likely involved;
2. dependencies;
3. implementation steps;
4. verification steps.

Keep plans concise. The plan exists to reduce mistakes, not to narrate obvious work.

### 1.2 Simplicity First

- Implement only what the task requires.
- Do not add speculative abstractions for hypothetical future use.
- Do not introduce infrastructure unless a current requirement needs it.
- Prefer straightforward domain code over clever generic frameworks.
- Do not create abstractions around code that has only one meaningful implementation.
- If a solution can be expressed clearly with substantially less code, prefer the smaller solution.
- Do not add defensive branches for impossible states already excluded by domain invariants.

### 1.3 Surgical Changes

- Keep changes narrowly scoped to the requested task.
- Do not refactor unrelated code while implementing a feature or bug fix.
- Do not reformat unrelated files.
- Do not rename unrelated symbols.
- Do not change adjacent comments simply because they could be improved.
- Follow the nearest established project pattern unless that pattern violates this document.
- If unrelated issues are discovered, report them separately; do not fix them unless required for the task.
- Remove only dead code made obsolete by the current change.

### 1.4 Goal-Driven Execution

Every task must be converted into a verifiable outcome.

Bad goal:

> Implement portfolio analytics.

Better goal:

> Given a fixed set of transactions and NAV data, the API returns deterministic TWR, XIRR, portfolio value, and maximum drawdown matching the golden test dataset.

A task is not complete until its acceptance criteria are verified.

### 1.5 Output Precision

When reporting work:

- Lead with what changed and whether verification passed.
- Mention important architectural or financial decisions.
- Report failed checks explicitly.
- Do not hide uncertainty.
- Do not claim tests passed unless they were executed successfully.
- Reference concrete file paths when useful.

---

## 2. Project Purpose

This project is a personal investment analysis and financial-learning platform focused primarily on Chinese public funds, ETFs, gold-related products, and portfolio-level analysis.

The system should help answer:

- What did I buy and when?
- How much did I actually earn?
- What risk did I take?
- Why did the portfolio gain or lose money?
- What underlying securities and sectors am I really exposed to through funds?
- How would alternative allocation or rebalancing strategies have performed historically?
- Which financial concepts explain the observed behavior?

The product is not an automated trading system and is not a price-prediction engine.

---

## 3. Architecture: Modular Monolith Only

This repository uses a **NestJS Modular Monolith**.

It is explicitly **not a microservice architecture**.

### 3.1 Required Architecture

```text
React Web Application
        |
        v
NestJS Modular Monolith
        |
        +-- Ledger
        +-- Portfolio Analytics
        +-- Fund Research
        +-- Portfolio X-Ray
        +-- Backtest
        +-- Attribution
        +-- AI Tutor
        |
        v
PostgreSQL
```

Redis/BullMQ may be used for caching and asynchronous jobs where justified.

A Python data worker may be used for fund-data ingestion and normalization.

Neither BullMQ workers nor the Python ingestion process should be modeled as independent business microservices.

### 3.2 Forbidden Microservice Patterns

Unless an Architecture Decision Record explicitly changes this rule, agents must not create:

- `ledger-service`
- `portfolio-service`
- `fund-service`
- `analytics-service`
- `backtest-service`
- `ai-service`
- service-to-service HTTP APIs
- gRPC between internal business modules
- API gateway infrastructure
- service discovery
- distributed sagas
- distributed transactions
- duplicated databases per module

Business modules communicate through in-process application interfaces, facades, query ports, or domain contracts.

### 3.3 Module Boundary Rule

A module may not directly access another module's repository implementation or database table as an implementation shortcut.

Preferred dependency:

```text
Module A Application Service
        |
        v
Module B Public Application Port / Query Interface
```

Avoid:

```text
Module A
   |
   v
Module B PrismaRepository
```

---

## 4. Backend Architecture

The backend uses NestJS + TypeScript.

Recommended module structure:

```text
src/
  modules/
    ledger/
      domain/
      application/
      infrastructure/
      presentation/
    portfolio/
    research/
    xray/
    backtest/
    attribution/
    tutor/
  shared/
    kernel/
    database/
    errors/
    observability/
    time/
```

### 4.1 Dependency Direction

```text
Controller / API
      |
      v
Application Use Case
      |
      v
Domain

Infrastructure ---> Domain/Application Ports
```

The domain layer must not import:

- NestJS decorators;
- Prisma;
- HTTP concepts;
- Redis;
- BullMQ;
- external API SDKs.

### 4.2 Controllers

Controllers should only handle:

- protocol adaptation;
- request validation;
- authentication/authorization;
- application use-case invocation;
- response mapping.

Controllers must not contain:

- portfolio calculations;
- database queries;
- pricing logic;
- cost-basis logic;
- fund-research business rules.

### 4.3 Application Layer

Application services/use cases should:

- orchestrate domain operations;
- manage transaction boundaries;
- call repositories through ports;
- publish/requeue recalculation work when appropriate;
- return application DTOs.

### 4.4 Domain Layer

The domain layer owns:

- business rules;
- value objects;
- financial calculation semantics;
- invariants;
- domain-specific errors.

Keep it framework-independent and deterministic wherever possible.

### 4.5 Infrastructure Layer

Infrastructure owns:

- Prisma repositories;
- PostgreSQL access;
- Redis;
- BullMQ;
- external fund-data providers;
- external AI providers;
- filesystem/network adapters.

---

## 5. Frontend Architecture

Frontend uses React + TypeScript.

Preferred shape:

```text
src/
  app/
  pages/
  features/
  entities/
  components/
    ui/
    charts/
  api/
  hooks/
  lib/
```

### 5.1 Frontend Rules

- Pages must not contain direct raw HTTP logic.
- Use a centralized API/query layer.
- Domain presentation components should not depend directly on backend wire DTO details when avoidable.
- Keep reusable UI components presentational.
- Separate chart configuration/transformations from page composition.
- Keep financial-number formatting centralized.
- Do not duplicate return, amount, date, or percentage formatting across screens.

### 5.2 UI Philosophy

The interface should be:

- simple;
- calm;
- information-dense without clutter;
- visually pleasant;
- optimized for understanding rather than decoration.

Prefer:

- light neutral backgrounds;
- low-saturation blue/teal primary accents;
- restrained red/green financial colors;
- clear hierarchy;
- generous spacing;
- minimal visual noise.

Charts exist to explain data, not merely decorate dashboards.

---

## 6. Ledger Is the Source of Truth

Transactions are the canonical investment facts.

The system must be able to rebuild derived state from:

- transactions;
- cash flows;
- prices/NAV;
- relevant configuration.

Do not treat a stored `currentPosition` or `currentProfit` field as the primary truth.

Derived values include:

- position quantity;
- cost basis;
- market value;
- realized profit/loss;
- unrealized profit/loss;
- portfolio snapshots;
- performance metrics.

Corrections to historical transactions should preserve auditability.

---

## 7. Financial Computing Rules

Financial correctness has priority over implementation convenience.

### 7.1 Never Use JavaScript Floating Point for Money

Do not use native JavaScript `number` for:

- money;
- NAV where precision matters;
- shares/units;
- cumulative financial calculations;
- rates that participate in repeated calculations.

Use Decimal-based arithmetic consistently.

Recommended database precision:

```text
money   NUMERIC(20,4)
shares  NUMERIC(24,8)
nav     NUMERIC(18,8)
ratio   NUMERIC(18,10)
```

### 7.2 Date Semantics Must Be Explicit

Never collapse these concepts into one generic timestamp:

- trade date;
- confirmation date;
- NAV date;
- report date;
- publication date;
- fetch time.

Use date-only domain semantics where time-of-day has no business meaning.

### 7.3 Missing Data Must Be Explicit

Do not silently replace missing NAV/market data with zero.

If forward-fill is used, it must be an explicit documented rule appropriate for the metric.

If data quality is insufficient, return a clear incomplete/stale state rather than inventing values.

### 7.4 Deterministic Finance Engine

LLMs must never calculate or overwrite authoritative values for:

- XIRR;
- TWR;
- CAGR;
- volatility;
- Sharpe ratio;
- maximum drawdown;
- cost basis;
- market value;
- holdings exposure;
- backtest performance;
- attribution metrics.

Authoritative financial numbers come from deterministic code.

LLMs may explain structured outputs after calculations are complete.

### 7.5 Calculation Versioning

Important derived calculations should support a `calculationVersion` or equivalent mechanism so historical outputs remain reproducible after algorithm changes.

### 7.6 Benchmark Alignment

Portfolio and benchmark comparisons must use aligned date ranges and clearly defined return conventions.

Never compare mismatched periods and label the result as alpha/outperformance.

---

## 8. Backtesting Integrity

Backtests must prioritize methodological correctness over attractive results.

### 8.1 No Look-Ahead Bias

At backtest date `T`, only information available by `T` may be used.

For fund research data this means, for example:

```text
publishDate <= backtestDate
```

A quarter-end holding must not become visible to the simulation before it was actually published.

### 8.2 Avoid Survivorship Bias

Do not automatically exclude liquidated or delisted historical products from datasets if doing so changes historical conclusions.

### 8.3 Explicit Simulation Assumptions

Backtests must make assumptions visible, including where relevant:

- subscription/redemption fees;
- rebalance frequency;
- contribution schedule;
- NAV availability;
- settlement delay;
- cash handling;
- dividend treatment;
- benchmark definition.

### 8.4 Separate Observation From Causation

Attribution and behavior analysis may produce approximations.

Do not present correlation or counterfactual comparisons as proven causal effects.

---

## 9. Fund Research Data Rules

Fund data is time-varying and source-dependent.

Do not model these as timeless static attributes:

- fund manager;
- AUM;
- holdings;
- industry allocation;
- style classification;
- subscription status.

Store historical validity/effective dates where appropriate.

External financial records should preserve provenance such as:

- `source`;
- `effectiveDate` / `reportDate`;
- `publishDate` where relevant;
- `fetchedAt`;
- source identifier/hash where useful.

---

## 10. AI Tutor Rules

The AI Tutor exists to explain finance using the user's actual portfolio data.

It must consume structured deterministic results.

Preferred flow:

```text
Transactions + Market/Research Data
              |
              v
      Deterministic Engines
              |
              v
        Structured Insight
              |
              v
              LLM
              |
              v
       User Explanation
```

AI output should distinguish:

1. observed fact;
2. calculated result;
3. interpretation;
4. educational concept;
5. uncertainty/limitation.

Never fabricate:

- fund managers;
- holdings;
- NAV;
- report dates;
- economic events;
- portfolio metrics.

---

## 11. TypeScript Conventions

- `strict: true`.
- Avoid `any`.
- If an unsafe external payload begins as `unknown`, validate/narrow it at the boundary.
- Prefer explicit domain names over generic helpers.
- Prefer named exports.
- Keep functions small and single-purpose.
- Avoid boolean parameters when they create multiple behavioral modes; use explicit options or commands.
- Keep DTOs separate from domain entities.
- Prefer discriminated unions for meaningful state transitions.
- Avoid giant `CommonService`, `UtilsService`, or `HelperService` classes.

Good names:

```text
calculateTimeWeightedReturn
calculateMaximumDrawdown
PortfolioSnapshot
FundManagerAssignment
FundHolding
MoneyWeightedReturn
```

Poor names:

```text
calc
processData
handleInfo
CommonService
Utils
```

---

## 12. Error Handling

Use explicit domain/application errors.

Examples:

```text
INSUFFICIENT_POSITION
NAV_NOT_AVAILABLE
ASSET_NOT_FOUND
INVALID_TRANSACTION_DATE
STALE_RESEARCH_DATA
INVALID_BACKTEST_RANGE
```

Rules:

- Do not throw `HttpException` from the domain layer.
- Do not catch and swallow exceptions.
- Convert external provider failures into explicit integration errors.
- Do not log the same exception at every layer.
- Never expose secrets or sensitive financial payloads in logs.

---

## 13. Database Rules

- Use PostgreSQL as the primary persistent store.
- Use migrations for schema changes.
- Do not manually mutate production schemas outside migrations.
- Explain the business meaning of unique constraints.
- Preserve financial history; avoid destructive changes to ledger facts.
- Consider locking/index impact for large-table migrations.
- Repository implementations belong to infrastructure layers.

Prisma schema and migration files are shared high-conflict files and should normally have a single task owner at a time.

---

## 14. API Rules

- REST + JSON unless an ADR changes this decision.
- Version public API under `/api/v1`.
- Generate/maintain OpenAPI definitions from the application.
- Use ISO-8601 dates.
- Send money/NAV/precision-sensitive decimal values as strings in JSON.
- Do not silently change the semantic meaning of an existing field.
- Deprecate before removing externally consumed fields.

Example:

```json
{
  "totalValue": "523840.2500",
  "xirr": "0.0942000000"
}
```

---

## 15. Testing Standards

A financial feature without tests is incomplete.

### 15.1 Unit Tests

Prioritize unit coverage for:

- position reconstruction;
- cost basis;
- XIRR;
- TWR;
- maximum drawdown;
- volatility;
- rebalancing;
- fund look-through exposure;
- attribution algorithms.

### 15.2 Golden Dataset

Maintain a small, manually verified financial fixture containing known:

- transactions;
- NAV/prices;
- positions;
- portfolio values;
- XIRR/TWR;
- drawdown values.

Core finance-engine changes must pass the golden dataset regression suite.

### 15.3 Bug Fixes

For a reproducible bug:

1. add a failing regression test;
2. implement the smallest correct fix;
3. verify the test passes;
4. run relevant broader tests.

### 15.4 Integration and E2E

Use integration/E2E tests for important user flows such as:

```text
Create transaction
    -> rebuild position
    -> rebuild portfolio snapshot
    -> dashboard displays updated metrics
```

---

## 16. Security and Privacy

This product handles sensitive personal financial information.

Agents must:

- avoid logging full personal transaction histories;
- never log secrets, tokens, credentials, or provider keys;
- keep credentials in environment/secret management;
- validate file imports;
- validate all external-provider payloads;
- use parameterized/ORM database access;
- avoid exposing unnecessary personal data through APIs.

Do not add telemetry that exports personal financial data unless explicitly designed and approved.

---

## 17. Common Task Playbooks

### 17.1 Adding a Ledger Feature

1. Read ledger domain rules.
2. Define/update domain command/value object.
3. Add domain validation/invariants.
4. Add application use case.
5. Add repository changes only if persistence actually changes.
6. Add controller/DTO mapping.
7. Trigger derived-state recalculation if required.
8. Add unit and integration tests.
9. Verify existing ledger reconstruction remains correct.

### 17.2 Adding a Portfolio Metric

1. Define the exact financial formula and convention.
2. Identify required source series.
3. Define missing-data behavior.
4. Implement as a deterministic pure calculation where practical.
5. Add known examples/golden tests.
6. Add calculation-version implications if necessary.
7. Expose through application/API only after the engine is verified.
8. Add UI explanation/visualization separately.

### 17.3 Adding External Fund Data

1. Extend provider port only if the domain needs a new capability.
2. Implement provider-specific adapter in infrastructure.
3. Preserve raw/source metadata as required.
4. Normalize external payloads.
5. Validate dates and numeric precision.
6. Persist historical versions.
7. Add provider fixture tests.
8. Ensure provider failure does not corrupt existing trusted data.

### 17.4 Adding a Frontend Page

1. Reuse existing layout and feature patterns.
2. Define/query the API contract first.
3. Keep page composition separate from server-state hooks.
4. Reuse shared financial formatting.
5. Keep charts focused on one analytical question.
6. Handle loading, empty, stale, and error states.
7. Add component/E2E tests where valuable.

### 17.5 Adding an AI Explanation

1. Identify deterministic structured inputs.
2. Define explanation contract.
3. Include data date/freshness and caveats.
4. Do not let the LLM recompute authoritative metrics.
5. Validate output format.
6. Clearly separate fact from interpretation.

---

## 18. Sub-Agent Execution Rules

Sub-agents are useful only when work is genuinely parallelizable.

### 18.1 Main Agent Responsibilities

The main agent owns:

- architecture consistency;
- dependency analysis;
- task decomposition;
- shared-file ownership;
- integration;
- final verification.

### 18.2 Before Spawning Sub-Agents

The main agent should:

1. inspect the repository;
2. identify the requested goal;
3. build a dependency graph;
4. identify shared/high-conflict files;
5. freeze shared contracts where possible;
6. assign non-overlapping task boundaries.

### 18.3 Good Parallel Work

Examples:

```text
Agent A: implement XIRR pure calculator + unit tests
Agent B: implement TWR pure calculator + unit tests
Agent C: implement maximum drawdown calculator + unit tests
```

Provided each agent owns distinct files and interfaces have already been agreed.

### 18.4 Poor Parallel Work

Do not run multiple agents concurrently when they all need to edit:

- `prisma/schema.prisma`;
- root `package.json`;
- shared domain primitives;
- public API contract files;
- the same migration;
- golden fixtures;
- the same module barrel/index files.

### 18.5 Contract-First Parallelism

When frontend/backend or multiple modules can proceed in parallel, stabilize the interface first.

Example:

```ts
interface PortfolioSummaryResponse {
  totalValue: DecimalString;
  investedCapital: DecimalString;
  totalProfit: DecimalString;
  xirr: RateString | null;
}
```

After the contract is stable, backend and frontend implementation can proceed independently.

### 18.6 Sub-Agent Scope Discipline

A sub-agent must not expand its scope simply to unblock itself.

If a required dependency is missing, report:

```text
BLOCKED
Reason: required contract/repository/schema is not available.
Needed from main agent: <specific dependency>
```

Do not modify unrelated modules without ownership.

### 18.7 Sub-Agent Completion Report

Each sub-agent should return:

```text
Status: DONE | BLOCKED | FAILED

Changed:
- <files>

Implemented:
- <behavior>

Verification:
- <commands/tests and results>

Risks / Follow-ups:
- <remaining issues>
```

The main agent must independently integrate and run appropriate checks.

---

## 19. Validation Checklist

Before declaring a task complete, execute the applicable checks available in the repository.

Typical commands may include:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Use the actual repository scripts; do not invent commands without checking `package.json`.

Verify at minimum:

- [ ] requested behavior is implemented;
- [ ] relevant unit tests pass;
- [ ] integration/E2E tests pass where applicable;
- [ ] TypeScript compiles;
- [ ] lint passes;
- [ ] build succeeds when relevant;
- [ ] financial calculations preserve Decimal precision;
- [ ] architecture boundaries remain intact;
- [ ] no unrelated files were modified;
- [ ] docs/contracts were updated if behavior changed.

Unverified work is incomplete work.

---

## 20. Definition of Done

A task is complete only when:

- behavior matches the requested outcome;
- domain rules are respected;
- architecture boundaries are respected;
- financial semantics are explicit;
- precision/date handling is correct;
- tests cover meaningful behavior;
- verification passes;
- no unnecessary refactoring was introduced;
- API/data contracts remain coherent;
- remaining risks are stated clearly.

---

## 21. When in Doubt

Use this priority order:

1. financial correctness;
2. user data integrity;
3. existing architecture;
4. clear domain semantics;
5. simple implementation;
6. consistency with nearby code;
7. performance optimization.

Do not optimize before correctness is established.

When an existing implementation pattern is reasonable, follow it.
When an existing pattern conflicts with financial correctness or an explicit rule in this document, follow this document and call out the discrepancy.
