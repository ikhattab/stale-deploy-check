# Releasing

1. Bump every `package.json` and `packages/extension/static/manifest.json` to the new version (a test checks they match), and run calibration as `calibration/README.md` describes.
2. Push a `vX.Y.Z` tag that matches `packages/cli/package.json`.
3. [`release.yml`](../.github/workflows/release.yml) tests the tag and waits for a maintainer to approve the `npm` environment. It then publishes the CLI to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers) and provenance.
4. Once npm has it, the `extension` job zips the extension and submits it to the [Chrome Web Store](https://chromewebstore.google.com/detail/stale-deploy-check/bcibhjoeiphifeicebippfihloijnanm) for review. The job summary says the submission's state. The store publishes it when the review passes.
5. After npm lists the version, move the `v0` tag to it for the action.

If `npm publish` fails with `TLOG_CREATE_ENTRY_ERROR` (409), signing the provenance timed out and was retried. Nothing was published, so re-run the failed job.

The store only accepts a higher manifest version than the last upload, so a re-run of the `extension` job after its upload succeeded fails at the upload. In that case, submit the draft from the developer dashboard.

## Chrome Web Store: one-time setup

The `extension` job signs in to Google the way `publish` signs in to npm: with the workflow's OIDC token, exchanged through [workload identity federation](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account) for a 10-minute access token of a service account. No key is stored anywhere. Google only trusts jobs from this repository that run in the `chrome-web-store` environment.

In a Google Cloud project you own (`PROJECT` below):

```sh
PROJECT=your-project-id
NUMBER=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')

# IAM holds the identity pool; STS and IAM Credentials exchange the GitHub token for a Google one.
gcloud services enable chromewebstore.googleapis.com iam.googleapis.com sts.googleapis.com iamcredentials.googleapis.com --project "$PROJECT"

gcloud iam service-accounts create cws-publisher --project "$PROJECT" --display-name "Chrome Web Store publisher"

gcloud iam workload-identity-pools create github --project "$PROJECT" --location global --display-name GitHub
gcloud iam workload-identity-pools providers create-oidc stale-deploy-check --project "$PROJECT" --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment' \
  --attribute-condition "assertion.repository == 'ikhattab/stale-deploy-check' && assertion.environment == 'chrome-web-store'"

gcloud iam service-accounts add-iam-policy-binding "cws-publisher@$PROJECT.iam.gserviceaccount.com" --project "$PROJECT" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/ikhattab/stale-deploy-check"
```

On the **Settings** page of the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole):

- Under **Service account**, enter `cws-publisher@PROJECT.iam.gserviceaccount.com` and click **Add a service account**. A publisher can have only one.
- Copy the **Publisher ID**.

In GitHub, create the `chrome-web-store` environment, allow only `v*.*.*` tags to deploy to it, and give it three variables. They're IDs, not secrets:

```sh
gh api -X PUT repos/ikhattab/stale-deploy-check/environments/chrome-web-store \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/ikhattab/stale-deploy-check/environments/chrome-web-store/deployment-branch-policies -f name='v*.*.*' -f type=tag

gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env chrome-web-store \
  --body "projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/stale-deploy-check"
gh variable set CWS_SERVICE_ACCOUNT --env chrome-web-store --body "cws-publisher@$PROJECT.iam.gserviceaccount.com"
gh variable set CWS_PUBLISHER_ID --env chrome-web-store --body "<publisher ID from the dashboard>"
```

The API publishes with the listing's current visibility. If the visibility was last changed by hand in the dashboard, publish once by hand before the API can.

`scripts/publish-extension.mjs` does the upload and submission, and can be run by hand with a token from `gcloud auth print-access-token --impersonate-service-account=… --scopes=https://www.googleapis.com/auth/chromewebstore` and the same variables.
