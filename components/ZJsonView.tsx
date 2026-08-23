/**
 * JSON viewer for the RPC console.
 *
 * Tokenised into React elements rather than highlighted with
 * `dangerouslySetInnerHTML`. The content here is a node's RPC response — data
 * from outside the app — so building an HTML string out of it and injecting it
 * would be the one genuinely unsafe thing this app could do. The regex only ever
 * runs over the output of `JSON.stringify`, which is already escaped, and every
 * token becomes a text node.
 */

import type { ReactNode } from "react";

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function ZJsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // A circular structure cannot come back over JSON-RPC, but a caller could
    // hand us anything, and a viewer that throws takes the whole page down.
    text = String(value);
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;

  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));

    const [full, str, colon, bool, num] = match;
    const key = `${match.index}`;

    if (str !== undefined) {
      // A string followed by a colon is a key; the same token otherwise is a value.
      parts.push(
        <span className={colon ? "z-k" : "z-s"} key={key}>
          {str}
        </span>,
      );
      if (colon) parts.push(colon);
    } else if (bool !== undefined) {
      parts.push(
        <span className="z-b" key={key}>
          {bool}
        </span>,
      );
    } else if (num !== undefined) {
      parts.push(
        <span className="z-nu" key={key}>
          {num}
        </span>,
      );
    } else {
      parts.push(full);
    }

    cursor = match.index + full.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <pre className="z-json" style={maxHeight ? { maxHeight } : undefined}>
      {parts}
    </pre>
  );
}
