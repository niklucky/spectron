# Automatic export

Project settings → Integrations → Jira Cloud or Yandex Tracker → Sync → Export.

Click **Edit**, choose **Off**, **On save**, or **By schedule**, select the actions and save. Saving locks the form. Scheduled export supports every 15 minutes, hour, or day; its first run is one interval after saving. Import and export settings are independent. Export is off until an owner enables it.

Supported actions:

- Create and update issues.
- Create and update comments.
- Create and delete worklogs.

Changes made by project members after export is enabled are queued in the same database transaction as the local mutation. Existing records are not bulk-exported on enablement. Import code does not enqueue exports. Jobs send the latest local values, so successive edits can be combined into a single remote update by the existing sync checkpoints. Worklog edits and restores, issue/comment deletion, and attachment export are not automatic export actions.

The API server checks the durable queue every two seconds. On save queues work immediately; by schedule waits until the next server run. The browser can be closed. An issue is created before its comments/worklogs if issue creation is enabled; otherwise the child export fails with an instruction to link/export its parent first. Comment updates cannot create an unlinked comment when comment creation is disabled. Exports execute with the connected account's permissions, and worklogs are attributed remotely to that account. The local worker attribution is retained in Spectron.

The owner who saves the export configuration authorizes the worker; access and archived state are rechecked on every job. Turning Off cancels pending/failed jobs, and disabling an action cancels its pending/failed jobs. An in-flight request can finish. Re-enabling does not resurrect cancelled jobs or backfill edits made while Off.

## Recovery and logs

Export settings show persistent pending, running, successful, failed and cancelled counts, plus up to 50 log entries with failures and pending jobs first. Entries include the entity ID, action, creation time, attempt count and error. Retry requeues a failed job using the current saved mode and schedule. Transient provider rejections retry up to five attempts with backoff. Validation and conflict failures require correction before retrying.

A database session lock serializes each connection's queue across API replicas; provider locks also prevent overlap with manual operations. Interrupted running jobs are recovered after the prior worker's session lock disappears. Local saves roll back if the queue write fails.

Jira issue/comment creates use existing pending-create records; their uncertain outcomes can be reconciled in Jira Sync settings. Tracker reuses its stable issue unique key and comment marker. Worklog creates for both providers persist an intent before POST. After an ambiguous response, the job stops rather than creating a duplicate. Use **Link remote worklog** in the failed export entry, supply the worklog ID from the linked issue, save the link, then Retry. If no remote worklog was created, create the corresponding record remotely and link it. Tracker worklog IDs are qualified by issue in storage.

Deleting a worklog uses its recorded remote ID and checks its remote snapshot first. A changed remote worklog is left intact and reported as a conflict; imported Jira worklogs use their existing sync identity. A worklog created and deleted before export is skipped. If a delete succeeded before a response was lost, retry recognizes the missing remote record and completes safely. Restoring a worklog already deleted remotely does not recreate it.

Jira worklog requests preserve the remaining estimate (`adjustEstimate=leave`) and retain second precision. See the [Jira worklog API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/), [Tracker time record format](https://yandex.ru/support/tracker/en/api/issues/get-worklog), and [Tracker worklog deletion](https://yandex.ru/support/tracker/en/api-ref/issues/delete-worklog).

## Validation

Apply database migrations before starting the updated server (`pnpm db:migrate`). `pnpm test:exports` runs both provider lifecycles in disposable databases with mocked HTTP requests. It covers all six actions, scheduled delivery, interrupted claims, concurrent workers, transaction rollback, permissions, action switches, cancellation, uncertain creates, rate-limit retries, second precision, worklog identity scoping and remote conflicts. The tests make no live integration writes.
