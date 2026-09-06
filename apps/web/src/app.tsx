import { Page } from "@spectron/frontend";
import { productName } from "@spectron/shared";

export function App() {
  return (
    <Page title={productName}>
      <p>An open source development workspace for your team.</p>
    </Page>
  );
}
