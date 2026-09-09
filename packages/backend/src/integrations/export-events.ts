import { eq } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import type { ExportAction } from "@spectron/shared";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
// Called only by local mutation services, inside the same transaction as the save.
// Import code deliberately does not enqueue, preventing a sync feedback loop.
export async function enqueueExport(tx: Tx, projectId: string, issueId: string, entityId: string, action: ExportAction) {
  const settings = await tx.select().from(s.exportSetting).where(eq(s.exportSetting.projectId, projectId));
  for (const setting of settings) {
    if (setting.config.mode === "off" || !setting.config.actions.includes(action)) continue;
    await tx.insert(s.exportJob).values({ settingId: setting.id, issueId, entityId, action });
  }
}
