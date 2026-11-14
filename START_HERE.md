# Start Here With Claude

The repository is past its scaffolding phase. React (Vite, Three.js) runs on a Django REST
backend with PostgreSQL, parents sign in through the existing Amazon Cognito user pool, and the
Amplify Gen 2 backend and Amplify Hosting are retired (`docs/platform/AMPLIFY_FINAL_REMOVAL.md`).

To work on it:

1. Read `CLAUDE.md` and the documents listed in its section 17.
2. Check `docs/IMPLEMENTATION_STATUS.md` and `docs/DJANGO_MIGRATION_ROADMAP.md` for what is open,
   and which tasks need owner approval.
3. Start the app locally with the ten steps in `README.md`, "Local development". No Amplify
   sandbox, `amplify_outputs.json` or AWS credentials are needed.
4. Run the development checks in `docs/TESTING_STRATEGY.md` for your change, and update
   `docs/IMPLEMENTATION_STATUS.md` when you finish.

The original Phase 0 instruction, which scaffolded an Amplify Gen 2 backend, is kept in the git
history only; do not follow it.
