# My Hosts operations pilot visual QA

Captured from `apps/web/e2e/my-hosts-real-server.spec.ts` against the isolated
real HTTP + SSH/SFTP + HTTPS fixture. The screenshots cover the two new owner
surfaces in the complete pilot flow:

- `participant-feedback-1280w.png`: ordinary user, terminal operations case,
  structured clarity/ease feedback, withdrawal still available.
- `professional-workbench-1280w.png`: administrator, persisted post-restart
  campaign summary, invitation, evidence export, and non-blocking posture.

Regenerate with:

```sh
CAPTURE_VISUAL_QA=true pnpm --filter @myagenttool/web exec playwright test \
  -c playwright.config.ts my-hosts-real-server.spec.ts --project=chromium \
  --grep "explicitly consented operations pilot"
```
