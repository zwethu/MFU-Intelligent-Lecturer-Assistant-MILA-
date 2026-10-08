# CI/CD

`main` is where work lands. `production` is what is live. Pushing to
`production` runs `.github/workflows/deploy-production.yml`, which deploys.

## What the workflow does

| Step | Job | Blocks deploy if it fails |
|---|---|---|
| 1 | Backend tests (`uv run pytest`) | yes |
| 1 | Frontend type-check and build (`npm run build`) | yes |
| 2 | Backend → Cloud Run `ai-teacher-backend`, then a `GET /` smoke test | yes, for step 3 |
| 3 | Frontend → Firebase Hosting, plus `docs/firestore.rules` | — |

The backend deploys first because a new frontend may call endpoints only the
new backend has.

The backend deploy **never** passes `--env-vars-file`. Env vars and the runtime
service account (`mila-agent`) carry over between revisions. To change one env
var, use `gcloud run services update … --update-env-vars KEY=VALUE`, as in
`how_to_deploy.txt`.

Firestore indexes and RTDB rules are not deployed automatically. Run
`firebase deploy --only firestore:indexes` or `--only database` by hand when
they change.

`npm test` is not a gate yet. 24 frontend test files fail to load: Firebase
Auth's `initializeAuth` asserts under jsdom, even though every test in those
files passes. Fix that on `main`, then add `npm test` to the frontend job.

## Releasing a version

1. Merge to `main` and tag it: `git tag -a v1.2.0 -m "…" && git push origin v1.2.0`.
2. Open a PR from `main` (or the tag) into `production` and merge it. The merge
   deploys.
3. On GitHub, mark the release as Latest. Until a version is on `production`,
   keep its release marked pre-release.

`production` carries the CI commit that `main` may not have yet, so a promotion
is a merge, not a fast-forward.

To redeploy without a new commit (for example, after fixing GCP permissions),
go to Actions → Deploy production → Run workflow, on branch `production`.

## One-time setup

Run this once from the repo root, logged in to `gcloud` as a project owner and
`gh` as a repo admin:

```bash
bash .github/scripts/setup-gcp-deploy.sh
```

It creates:

- **`github-deployer` service account**, with Cloud Run source deploy, Firebase
  Hosting admin and Firestore rules admin, and permission to act as
  `mila-agent` (runtime) and the default compute account (builds).
- **Workload Identity Federation**: pool `github`, provider `github-oidc`.
  GitHub authenticates with short-lived OIDC tokens, with no key file. The
  provider only accepts tokens from this repo's `production` branch, so no
  other branch or fork can deploy.
- **GitHub repo variables**: `GCP_WORKLOAD_IDENTITY_PROVIDER`,
  `GCP_DEPLOY_SERVICE_ACCOUNT`, and the five `VITE_FIREBASE_*` values from
  `frontend/.env`. These are public web config, not secrets.
- **A `production` GitHub environment.** In Settings → Environments →
  production, you can add required reviewers so every deploy waits for an
  approval click.

Until `GCP_WORKLOAD_IDENTITY_PROVIDER` is set, the deploy jobs are skipped and
only the checks run.
