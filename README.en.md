[中文](./README.md) | [**English**](./README.en.md)

# lite-spec

A lightweight workflow for requirement clarification, task breakdown, and knowledge capture across frontend, backend, DevOps, and other engineering projects.

## Installation

```bash
npx skills add gancao-web/lite-spec
```

or

```bash
npx skills add https://github.com/gancao-web/lite-spec.git
```

## After Installing This Skill, You Can Tell Your AI

- "Here are the design mockups and API docs. Help me build page xx."
- "Here is the design. Implement the page directly in the current project's style."
- "Here is the prototype link. First organize the requirements for this project, then I will review them before implementation."
- "This change affects database tables, API responses, and scheduled jobs. Start with an implementation plan."
- "Here is the runbook and an alert screenshot. First sort out the troubleshooting scope, risks, and execution steps."
- "This repo needs a new script or CLI. First help me map the impact, inputs and outputs, and validation approach."
- "Here are the ticket, documents, and a few links. First organize the implementation scope, open questions, and acceptance points."
- "Extract the constraints, rules, and boundaries from this discussion that are worth keeping long term, and save them into docs."
- "What knowledge in this project is worth turning into documentation?"

It will:

- Read the materials you provide together with the current project context
- Collect common online sources when needed, such as `axure`, `figma`, `yapi`, `swagger`, and `openapi`, including authenticated access
- Organize requirements that fit the current project, identify open questions, risks, and obvious inconsistencies
- Generate `plan.md` / `tasks.md`, and wait for your approval before execution starts
- Save long-lived rules into documentation when appropriate

## Why "lite"

This skill started from a simple goal: provide something lighter than `OpenSpec`.

`lite` stands for:

- Lightweight planning: quickly sort out scope, risks, dependencies, and open questions first
- Fast execution: once `plan.md` / `tasks.md` are good enough, move into implementation or review
- Knowledge capture: support not only one-off requirements, but also long-term knowledge capture during planning

It is not meant to replace a full specification-driven system. It is meant for high-frequency iterative work that needs momentum without giving up documentation and knowledge retention.

## Difference from `OpenSpec`

This comparison is mainly about product positioning and explains why `lite-spec` exists:

| Comparison | `OpenSpec` | `lite-spec` |
| --- | --- | --- |
| Core approach | Emphasizes a complete planning system, spec-driven workflow, and stronger process constraints | Emphasizes lightweight planning and fast execution so the work can move forward quickly |
| Output goal | More complete and systematized spec / plan artifacts | Quickly produce plan / task artifacts for the current requirement |
| Knowledge capture | Mainly captured through artifacts produced by its planning workflow | Adds long-term rules, constraints, and boundaries during the `plan` process |
| Positioning | Better for teams working around an established planning system | Lighter and better suited for frequent day-to-day requirement delivery |
| Best fit | Projects that want a unified planning framework and strong process collaboration | Projects that want to move fast while still keeping basic planning and knowledge capture |

- If a project has already standardized on `OpenSpec` or another stable planning system, keep using that system for planning
- `lite-spec` can still work alongside them, but planning artifacts should follow the original system's rules first

## Difference from an AI Tool's `plan` Mode

This table is not about which one is "better". It highlights differences in experience, artifact shape, and intended usage boundaries:

| Comparison | AI tool `plan` mode | `lite-spec` |
| --- | --- | --- |
| Main form | Planning output mainly stays in the conversation | Combines conversation with repo-based document artifacts |
| Presentation | Information stays in chat and is good for quick discussion | Key information is written into files, making it easier for teammates to share and track |
| Communication cost | Complex requirements often require repeated chat edits and restatements, which can cost more time and tokens | Scope and risks are organized first, then captured in docs, which usually reduces repeated conversation |
| Documentation output | No long-term repo documentation by default | Produces `plan.md` / `tasks.md` by default and can continue capturing long-term knowledge docs |
| Access to materials | Does not directly handle collection from external links that require credentials | Adds an entry point for authenticated materials and captures related access rules |
| Best fit | You already understand the requirement well and only want a quick step list in chat | The requirement spans multiple sources, includes open questions or risks, and you want durable artifacts |
| Limitation | Better for instant collaboration, but does not naturally take ownership of long-term project knowledge capture | Adds a documentation step, so the upfront process is slightly heavier than pure chat planning |

If you only want a quick outline, an AI tool's `plan` mode is often enough. `lite-spec` is a better fit when you want to move the work forward while also capturing plans, tasks, and long-term constraints into project docs.

## Runtime

- Node.js `>=18`

## Triggering the Skill

Besides natural-language triggering, you can also trigger the skill explicitly with commands:

- Send `/lite:init` to initialize the long-term project documentation system. If you also want broader knowledge scanning and capture afterward, run `/lite:knowledge` next.
- Send `/lite:knowledge` to perform project-wide knowledge capture.
- Send `/lite:knowledge + a natural-language scope` to capture knowledge for the current conversation or a specific directory.
- Send `/lite:plan + a natural-language requirement` to generate `plan.md` and `tasks.md` for a one-off requirement. Code execution starts only after user review.
- Send `/lite:d2c + a natural-language requirement` to implement a page or component directly from mockups, prototypes, or screenshots. Only switch back to `/lite:plan` when the request is high-risk or you explicitly want planning first.
- Send `/lite:open + a link` to give the AI access to external materials and capture access rules plus credential constraints, such as authenticated `figma`, `yapi`, monitoring dashboards, or online documents.

## Output Artifacts

### Requirement Planning

`/lite:plan` writes temporary requirement artifacts to:

```text
<repo>/plans/YYYY-MM-DD-<slug>/
  plan.md
  tasks.md
```

Where:

- `plan.md`: implementation plan
- `tasks.md`: reviewable task list

## Long-Term Documents

`/lite:knowledge` does not dump everything into long documents by default. It only writes content that is:

- Stable over time
- Reusable
- Useful for constraining future implementation
