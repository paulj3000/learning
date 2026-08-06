# Learning Adventure Island

AI-powered learning adventures for children ages 3–8, built with React, TypeScript, and AWS Amplify Gen 2.

This repository currently contains the product and engineering specification Claude should use to build the project from an empty source tree.

## Start here

1. Open the repository as a Claude Code project.
2. Ask Claude to read `CLAUDE.md` and all files under `docs/`.
3. Begin with Roadmap Phase 0 in `docs/ROADMAP.md`.
4. Require Claude to update `docs/IMPLEMENTATION_STATUS.md` after each task.

Suggested first instruction:

```text
Read CLAUDE.md and the docs directory. Implement Roadmap Phase 0 only. Scaffold the React/Vite/TypeScript frontend and Amplify Gen 2 backend, establish tests and CI, then update IMPLEMENTATION_STATUS.md. Do not implement product features yet.
```

## Product premise

Children do not select worksheets. They enter adventures. Learning allows them to repair, create, discover, and permanently change the island.

## Local development

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

This runs the frontend only, against the Phase 0 application shell. No backend
resources are defined yet (see `amplify/backend.ts`).

### Amplify sandbox

The Amplify Gen 2 backend is scaffolded but currently defines no resources.
Once later phases add auth, data, storage, or functions, start a personal
cloud sandbox with:

```bash
npm run sandbox
```

This requires AWS credentials on your machine (for example via `aws configure`
or an SSO profile) with permission to deploy Amplify/CloudFormation resources
in your account. `npx ampx sandbox` provisions temporary, per-developer AWS
resources and writes `amplify_outputs.json` to the repo root; that file is
gitignored and must never be committed, since it can contain
environment-specific endpoint and identifier values. Do not commit `.env`
files either.

### Available scripts

```bash
npm run dev          # start the Vite dev server
npm run build         # typecheck and build for production
npm run preview       # preview the production build locally
npm run typecheck     # typecheck app, node config, e2e, and amplify backend
npm run lint           # run oxlint
npm run format         # format with Prettier
npm run format:check   # check formatting without writing
npm run test            # run Vitest unit/component tests
npm run test:e2e        # run Playwright end-to-end tests
npm run sandbox          # start a personal Amplify cloud sandbox
```
