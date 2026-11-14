#!/usr/bin/env bash
# Run in Google Cloud Shell from the verified release checkout after linking billing.
set -euo pipefail
project=trim-patient-manager
region=northamerica-northeast1
service=trim-drive-renewal
account="$service@$project.iam.gserviceaccount.com"
secret=trim-drive-oauth-secret
: "${TRIM_OWNER_EMAIL:?Set TRIM_OWNER_EMAIL to the verified owner of the billing files}"
cd "$(dirname "$0")"

if [[ "$(gcloud billing projects describe "$project" --format='value(billingEnabled)')" != True ]]; then
  echo "Link an active Cloud Billing account to $project first." >&2
  exit 1
fi
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com iam.googleapis.com --project="$project"
if ! gcloud iam service-accounts describe "$account" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$service" --display-name='TRIM billing renewal' --project="$project"
fi
if ! gcloud firestore databases describe --database="$service" --project="$project" >/dev/null 2>&1; then
  gcloud firestore databases create --database="$service" --location="$region" --type=firestore-native --project="$project"
fi
gcloud firestore fields ttls update expiresAt --collection-group=sessions --enable-ttl \
  --database="$service" --project="$project" --async
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$account" \
  --role=roles/datastore.user \
  --condition="title=trim-renewal-database,expression=resource.name=='projects/$project/databases/$service'" --quiet >/dev/null

if ! gcloud secrets describe "$secret" --project="$project" >/dev/null 2>&1; then
  gcloud secrets create "$secret" --replication-policy=automatic --project="$project"
fi
version="$(gcloud secrets versions list "$secret" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)' --project="$project")"
if [[ -z "$version" ]]; then
  echo "Store the web client's secret as a version of $secret in Secret Manager and rerun." >&2
  exit 1
fi
version="${version##*/}"
gcloud secrets add-iam-policy-binding "$secret" --member="serviceAccount:$account" \
  --role=roles/secretmanager.secretAccessor --project="$project" --quiet >/dev/null

builder="$(gcloud builds get-default-service-account --project="$project" --region="$region" | tail -n1)"
builder="${builder##*/}"
if [[ "$builder" != *@*.gserviceaccount.com ]]; then echo 'Could not identify build identity.' >&2; exit 1; fi
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$builder" \
  --role=roles/run.builder --condition=None --quiet >/dev/null
gcloud run deploy "$service" --project="$project" --region="$region" --source=. --allow-unauthenticated \
  --service-account="$account" --set-secrets="GOOGLE_CLIENT_SECRET=$secret:$version" \
  --set-env-vars="TRIM_OWNER_EMAIL=$TRIM_OWNER_EMAIL" --min-instances=0 --max-instances=2 --quiet

endpoint="https://$service-1078252705311.$region.run.app"
status="$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' \
  -X POST -H 'Origin: https://rmanocha85.github.io' -H 'Content-Type: application/json' \
  -H 'X-TRIM-Binding: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' -d '{}' "$endpoint/renew")"
[[ "$status" == 401 ]] || { echo "Unexpected smoke check result: $status. Keep frontend activation pending." >&2; exit 1; }
echo 'Service answered the browser-origin smoke check. Verify consent and renewal before promoting the UI.'
