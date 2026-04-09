import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable } from "@remix-run/node";
import type { EntryContext } from "@remix-run/node";
import { addDocumentResponseHeaders } from "./shopify.server";

// Give the SSR render 15 s before aborting — NeonDB free tier can have
// 3-5 s cold-start delays and the token exchange adds another round trip.
const ABORT_DELAY = 15_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);

  return new Promise<Response>((resolve, reject) => {
    let didError = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onShellReady() {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: didError ? 500 : responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          console.error("Shell render error", error);
          reject(error);
        },
        onError(error) {
          didError = true;
          console.error("SSR render error", error);
        },
      }
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
