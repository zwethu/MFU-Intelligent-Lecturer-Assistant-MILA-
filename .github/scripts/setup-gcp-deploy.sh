#!/usr/bin/env bash
# One-time setup so .github/workflows/deploy-production.yml can deploy.
#
# Creates, in the GCP project:
#   - a deploy service account, `github-deployer`
#   - a Workload Identity pool + GitHub OIDC provider, so GitHub Actions
#     authenticates without any long-lived key. The provider only accepts
#     tokens from THIS repo's `production` branch.
# and, on the GitHub repo:
#   - repo variables for the provider/service account and the public Firebase
#     web config (copied from frontend/.env)
#   - a `production` environment
#
# Safe to re-run: existing resources are left alone, role grants are idempotent.
# Needs: gcloud logged in as a project owner, gh logged in with admin on the repo.
#
# Usage, from the repo root:  bash .github/scripts/setup-gcp-deploy.sh

set -euo pipefail

PROJECT_ID="project-84d32b41-da8b-4f57-b15"
REPO="zwethu/MFU-Intelligent-Lecturer-Assistant-MILA-"
BRANCH="production"
POOL="github"
PROVIDER="github-oidc"
DEPLOYER="github-deployer"
RUNTIME_SA="mila-agent@${PROJECT_ID}.iam.gserviceaccount.com"   # what Cloud Run runs as

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOYER_EMAIL="${DEPLOYER}@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" # what `run deploy --source` builds as

echo "==> APIs"
gcloud services enable --project "$PROJECT_ID" \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firebasehosting.googleapis.com firebaserules.googleapis.com

echo "==> Deploy service account"
if ! gcloud iam service-accounts describe "$DEPLOYER_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$DEPLOYER" --project "$PROJECT_ID" \
    --display-name "GitHub Actions production deployer"
fi

echo "==> Project roles for the deployer"
for role in \
  roles/run.sourceDeveloper \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebasehosting.admin \
  roles/firebaserules.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOYER_EMAIL}" --role "$role" \
    --condition=None --quiet >/dev/null
  echo "    $role"
done

echo "==> Let the deployer act as the runtime and build service accounts"
for sa in "$RUNTIME_SA" "$BUILD_SA"; do
  gcloud iam service-accounts add-iam-policy-binding "$sa" --project "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOYER_EMAIL}" --role roles/iam.serviceAccountUser \
    --quiet >/dev/null
  echo "    $sa"
done

echo "==> Workload Identity pool and provider"
if ! gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location global --project "$PROJECT_ID" \
    --display-name "GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --workload-identity-pool "$POOL" --location global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool "$POOL" --location global --project "$PROJECT_ID" \
    --display-name "GitHub OIDC" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/${BRANCH}'"
fi

POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
PROVIDER_ID="${POOL_ID}/providers/${PROVIDER}"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_EMAIL" --project "$PROJECT_ID" \
  --member "principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${REPO}" \
  --role roles/iam.workloadIdentityUser --quiet >/dev/null

echo "==> GitHub repo variables"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" --body "$PROVIDER_ID"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "$REPO" --body "$DEPLOYER_EMAIL"

ENV_FILE="frontend/.env"
for name in VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID VITE_FIREBASE_DATABASE_URL; do
  value=$(grep -E "^${name}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')
  if [ -z "$value" ]; then
    echo "    !! $name not found in $ENV_FILE — set it by hand in the repo variables"
    continue
  fi
  gh variable set "$name" --repo "$REPO" --body "$value"
done

echo "==> GitHub 'production' environment"
gh api --method PUT "repos/${REPO}/environments/production" >/dev/null

echo
echo "Done. Provider: $PROVIDER_ID"
echo "Deployer:  $DEPLOYER_EMAIL"
