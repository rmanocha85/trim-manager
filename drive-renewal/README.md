# Deploying hosted TRIM Billing renewal

TRIM Manager owns this service. The maintained code and deployment instructions live here in the billing app repository. Google Cloud project `trim-patient-manager` (1078252705311) owns the web OAuth client and the service. Chrome sends billing, roster and backup data directly to Drive. The service accepts only the configured billing account and the existing `drive.file` grant. Broader patient-record access continues to use separate consent.

## Initial setup

1. Enable billing on the Google Cloud project, then enable Cloud Run, Cloud Build, Artifact Registry, Firestore and Secret Manager. Use the Montréal region `northamerica-northeast1`.
2. In Google Auth Platform, edit the existing **TRIM Manager** web client. Add the authorized redirect URI `https://rmanocha85.github.io/trim-manager/public/drive-authorized.html`. Retain the current origins and other redirect URIs. Keep the OAuth client in production for long-lived grants. Google can expire refresh tokens for projects in testing after seven days.
3. Store the existing web client's secret in Secret Manager as `trim-drive-oauth-secret`. Use Google’s secret entry, never the repository, a shell command argument or a chat message. Use the verified email of the owner of the billing Drive files for `TRIM_OWNER_EMAIL`.
4. Create a dedicated **Firestore Native** database named `trim-drive-renewal`. Disable end-user access. Set a TTL policy on the `sessions` collection group for `expiresAt`. The service also checks expiry on every request. Firestore encrypts the refresh tokens at rest. They are retained for at most a 30-day app session plus the TTL deletion delay. No patient or billing records belong in this database.
5. Create a dedicated runtime service account, `trim-drive-renewal@trim-patient-manager.iam.gserviceaccount.com`. Grant it Secret Manager Secret Accessor **on the one secret** and Datastore User restricted to the **named database** via an IAM condition. Use Google-managed workload credentials. No service account key file is needed.

## Deployment order

Deploy this directory only. In Cloud Shell, from this branch's repository root, substitute the configured owner's email and the numeric secret version before running:

```sh
gcloud run deploy trim-drive-renewal --project=trim-patient-manager \
  --region=northamerica-northeast1 --source=drive-renewal --allow-unauthenticated \
  --service-account=trim-drive-renewal@trim-patient-manager.iam.gserviceaccount.com \
  --set-secrets=GOOGLE_CLIENT_SECRET=trim-drive-oauth-secret:VERSION \
  --set-env-vars=TRIM_OWNER_EMAIL=OWNER_EMAIL --min-instances=0 --max-instances=2
```

The public HTTPS service accepts credentialed requests only from the TRIM Pages origin. A session requires both the partitioned HttpOnly cookie and the random binding kept by the app. Initial consent requires a one-time code with PKCE and a verified owner email. Store deployment credentials separately from the session database. The service does not log request bodies, codes, cookies, tokens or email addresses.

Verify the service at `https://trim-drive-renewal-1078252705311.northamerica-northeast1.run.app`. A POST to `/renew` from the configured origin with a valid-format synthetic binding and no cookie must return 401. Check logs for service startup errors. Check that the production website can serve the callback path (publish the callback assets first if staging separately). Publish the frontend only when the backend and Google redirect are ready. Connect in a fresh Chrome tab, then verify renewal against the live service. Existing working tabs can finish in their current version.

Run `node --test tests/hosted-renewal.test.mjs` and `node tests/hosted-renewal-browser.mjs` from the repository root for isolated regression checks. The browser scenario intercepts Google, Drive and the service, including the OAuth callback and the partitioned session cookie.

To roll back, revert the frontend to the previous Pages release. Disable the service to stop all renewals. For an individual device, **Lock app** clears the browser binding and deletes the server session when reachable. Google Account permissions can also revoke the grant.
