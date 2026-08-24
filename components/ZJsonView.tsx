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

import { useState, type ReactNode } from "react";
import { HiOutlineClipboard, HiCheck } from "react-icons/hi2";

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function ZJsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  const [copied, setCopied] = useState(false);

  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;

  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));

    const [full, str, colon, bool, num] = match;
    const key = `${match.index}`;

    if (str !== undefined) {
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
    <div className="z-json-wrap">
      <div className="z-json-toolbar">
        <span className="z-json-size">{text.length.toLocaleString()} bytes</span>
        <button
          type="button"
          className="z-btn z-btn-sm"
          onClick={handleCopy}
          title="Copy formatted JSON to clipboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          {copied ? (
            <>
              <HiCheck style={{ fontSize: 14, color: "var(--z-good)" }} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <HiOutlineClipboard style={{ fontSize: 14 }} />
              <span>Copy JSON</span>
            </>
          )}
        </button>
      </div>
      <pre className="z-json" style={{ maxHeight: maxHeight || 420, overflow: "auto" }}>
        {parts}
      </pre>
    </div>
  );
}


