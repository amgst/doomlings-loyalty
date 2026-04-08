import { RemixBrowser } from "@remix-run/react";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

startTransition(() => {
  hydrateRoot(document, <RemixBrowser />, {
    onRecoverableError(error, errorInfo) {
      // Log the actual mismatch text so you can see what's different
      // between server and client without needing the non-minified bundle.
      console.error("[Hydration error]", error);
      if (errorInfo?.componentStack) {
        console.error("[Component stack]", errorInfo.componentStack);
      }
    },
  });
});
