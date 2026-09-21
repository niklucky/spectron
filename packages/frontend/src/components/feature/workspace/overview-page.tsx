import type { ReactNode } from "react";
import { EmptyState, PageBody, PageHeader, PageShell, WidgetSlot } from "../../ui/page-shell";

/**
 * Personal dashboard across all projects. Starts empty: the user composes it
 * from widgets, nothing is pre-filled.
 */
export function OverviewPage({ actions }: { actions?: ReactNode }) {
  return (
    <PageShell label="Overview">
      <PageHeader breadcrumbs={[{ label: "Overview", icon: "overview" }]} actions={actions} />
      <PageBody className="p-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          <EmptyState
            icon="overview"
            title="Your dashboard is empty"
            description="Add widgets to build a helicopter view of everything you care about, across all projects."
            className="py-10"
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <WidgetSlot disabled hint="Widgets are coming next" />
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}
