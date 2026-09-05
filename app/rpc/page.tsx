"use client";

/**
 * RPC console.
 *
 * The form is built from the same allowlist table the server validates against —
 * fetched from `GET /api/rpc` rather than duplicated here. That is deliberate: a
 * hardcoded copy in the client would drift, and the first symptom would be a
 * method the UI offers and the server rejects.
 *
 * Two details that matter more than they look:
 *
 *  · **The sent envelope is displayed, always, including on failure.** The claim
 *    this page exists to support is that ZPulse speaks JSON-RPC to a node. Showing
 *    `{jsonrpc, id, method, params}` next to the reply is the evidence.
 *
 *  · **Methods the node does not implement are marked, not hidden.** On an older
 *    zebrad `getmempoolinfo` is a −32601, and being able to run it and see that is
 *    the clearest demonstration of why the dialect layer exists.
 *
 * `$prev` substitution for the chained recipes happens here, one step at a time,
 * so every step is still an ordinary validated single call on the server.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  HiOutlineCommandLine,
  HiOutlineShieldCheck,
  HiOutlineLink,
  HiOutlineClock,
  HiOutlineDocumentDuplicate,
  HiCheck,
} from "react-icons/hi2";
import { ZJsonView } from "@/components/ZJsonView";
import { ZBadge, ZCard, ZDemoBanner, ZErrorNote, ZStat } from "@/components/ZUI";
import { useEnvelope } from "@/components/useEnvelope";
import type { CapabilityReport } from "@/lib/rpc/capabilities";
import type { ConsoleMethod, ParamSpec } from "@/lib/rpc/console";

type Recipe = {
  id: string;
  title: string;
  why: string;
  steps: ReadonlyArray<{ method: string; params: readonly unknown[]; use: string }>;
};

type Catalogue = {
  methods: ConsoleMethod[];
  recipes: Recipe[];
  capabilities: CapabilityReport;
  limits: { perClient: number; global: number; windowMs: number };
};

type CallResult = {
  request: Record<string, unknown>;
  result: unknown;
  latencyMs: number | null;
  method: string;
  params: unknown[];
  summary: string;
  usedFor: string;
  ok: boolean;
  error?: { kind: string; message: string };
};

type CallOutcome =
  | { kind: "call"; use?: string; call: CallResult }
  | { kind: "rejected"; use?: string; method: string; message: string };

type StepOutcome = CallOutcome | { kind: "skipped"; use?: string; method: string; reason: string };

async function postCall(method: string, params: unknown[]): Promise<CallOutcome> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = (await response.json()) as { data: CallResult | null; error?: { message: string } };

  if (!response.ok || body.data === null) {
    return {
      kind: "rejected",
      method,
      message: body.error?.message ?? `The console request failed with HTTP ${response.status}.`,
    };
  }
  return { kind: "call", call: body.data };
}

export default function RpcPage() {
  return (
    <Suspense fallback={<div className="z-chart-empty">Loading RPC console…</div>}>
      <RpcConsoleContent />
    </Suspense>
  );
}

function RpcConsoleContent() {
  const searchParams = useSearchParams();
  const initialMethod = searchParams.get("method") || "getblockchaininfo";

  const catalogue = useEnvelope<Catalogue>("/api/rpc", 0);
  const methods = catalogue.data?.methods ?? [];

  const [selected, setSelected] = useState<string>(initialMethod);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<StepOutcome[]>([]);
  const [running, setRunning] = useState(false);
  const [heading, setHeading] = useState<string | null>(null);

  useEffect(() => {
    const queryMethod = searchParams.get("method");
    if (queryMethod) {
      setSelected(queryMethod);
      setInputs({});
    }
  }, [searchParams]);

  const spec = methods.find((entry) => entry.method === selected) ?? null;

  // Feature and shape probes share a method name with a plain probe (getblock at
  // verbosity 2, getblock's valueDelta field), so only the plain method-existence
  // entries decide whether a method itself exists.
  const unsupported = useMemo(() => {
    const set = new Set<string>();
    for (const entry of catalogue.data?.capabilities.entries ?? []) {
      if (entry.kind === "method" && !entry.supported) set.add(entry.method);
    }
    return set;
  }, [catalogue.data]);

  const pick = (method: string) => {
    setSelected(method);
    setInputs({});
  };

  /** Positional params from the form: blanks become defaults, trailing blanks vanish. */
  const buildParams = (target: ConsoleMethod): unknown[] => {
    const values = target.params.map((param) => {
      const raw = inputs[param.name]?.trim() ?? "";
      if (raw === "") return null;
      if (param.kind === "int") {
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric : raw;
      }
      if (param.kind === "bool") return raw === "true";
      return raw;
    });
    while (values.length > 0 && values[values.length - 1] === null) values.pop();
    return values;
  };

  const runOne = async () => {
    if (!spec || running) return;
    setRunning(true);
    setHeading(`${spec.method}`);
    setOutcomes([]);
    try {
      setOutcomes([await postCall(spec.method, buildParams(spec))]);
    } finally {
      setRunning(false);
    }
  };

  const runRecipe = async (recipe: Recipe) => {
    if (running) return;
    setRunning(true);
    setHeading(recipe.title);
    setOutcomes([]);

    const collected: StepOutcome[] = [];
    let previous: unknown = undefined;

    for (const step of recipe.steps) {
      const needsPrevious = step.params.some((param) => param === "$prev");

      if (needsPrevious && (previous === undefined || previous === null)) {
        // Reached when an earlier step failed. Saying so beats sending null and
        // getting a validation error that looks like a different problem.
        collected.push({
          kind: "skipped",
          use: step.use,
          method: step.method,
          reason: "The previous step returned no result, so there is nothing to substitute for $prev.",
        });
        setOutcomes([...collected]);
        continue;
      }

      const params = step.params.map((param) => (param === "$prev" ? previous : param));
      const outcome = await postCall(step.method, params);
      // Rebuilt rather than spread, so the discriminant stays narrow for TypeScript.
      collected.push(
        outcome.kind === "call"
          ? { kind: "call", use: step.use, call: outcome.call }
          : { kind: "rejected", use: step.use, method: outcome.method, message: outcome.message },
      );
      setOutcomes([...collected]);

      previous =
        outcome.kind === "call" && outcome.call.ok ? outcome.call.result : null;
    }

    setRunning(false);
  };

  return (
    <>
      <div className="z-page-head">
        <h1>RPC console</h1>
        <p>
          Every method ZPulse uses, runnable by hand. The exact JSON-RPC envelope sent is shown
          alongside the node&apos;s reply and the round-trip latency. Read-only methods only — the
          server validates against a fixed allowlist, so wallet and mutating methods are not
          reachable from here by construction.
        </p>
      </div>

      <ZDemoBanner meta={catalogue.meta} />
      <ZErrorNote error={catalogue.error} meta={catalogue.meta} />

      {/* Straight-to-the-point RPC Explainer */}
      <div className="z-explainer-card">
        <div className="z-explainer-head">
          <HiOutlineCommandLine style={{ fontSize: 18, color: "var(--z-amber)" }} />
          <h3 className="z-explainer-title">Interactive JSON-RPC Explorer</h3>
        </div>
        <p className="z-explainer-desc">
          Direct query console for testing read-only Zebra node methods with live response timing.
        </p>
        <div className="z-explainer-terms">
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineShieldCheck style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Safe Read-Only Methods</span>
            </div>
            <p className="z-term-desc">Informational queries only (blocks, pools, network, and trees).</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineLink style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Multi-Step Recipes</span>
            </div>
            <p className="z-term-desc">Chained workflows demonstrating multi-call consensus audits.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineClock style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Latency Benchmark</span>
            </div>
            <p className="z-term-desc">Live round-trip response time measured in milliseconds.</p>
          </div>
        </div>
      </div>

      <div className="z-console-grid">
        <div className="z-stack">
          <ZCard title="Single call">
            <div className="z-stack" style={{ gap: 12 }}>
              <label className="z-field">
                <span className="z-label">Method</span>
                <select
                  className="z-select"
                  value={selected}
                  onChange={(event) => pick(event.target.value)}
                >
                  {methods.map((entry) => (
                    <option key={entry.method} value={entry.method}>
                      {entry.method}
                      {unsupported.has(entry.method) ? " — not on this node" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {spec ? (
                <>
                  <p className="z-hint" style={{ margin: 0 }}>
                    {spec.summary}
                  </p>
                  {spec.params.map((param) => (
                    <ParamField
                      key={param.name}
                      param={param}
                      value={inputs[param.name] ?? ""}
                      onChange={(next) => setInputs((prev) => ({ ...prev, [param.name]: next }))}
                    />
                  ))}
                  {spec.params.length === 0 ? (
                    <p className="z-hint" style={{ margin: 0 }}>
                      Takes no parameters.
                    </p>
                  ) : null}
                </>
              ) : null}

              <button className="z-btn z-primary" onClick={runOne} disabled={running || !spec}>
                {running ? "running…" : "Send request"}
              </button>

              {spec && unsupported.has(spec.method) ? (
                <p className="z-hint" style={{ margin: 0, color: "var(--z-warn)" }}>
                  This node answered −32601 for {spec.method} during the capability probe. Sending it
                  anyway is worth doing — the error you get back is the dialect difference the rest of
                  the app routes around.
                </p>
              ) : null}

              {spec ? (
                <p className="z-hint" style={{ margin: 0, paddingTop: 8, borderTop: "1px solid var(--z-line)" }}>
                  <strong style={{ color: "var(--z-text-dim)" }}>ZPulse uses this for:</strong>{" "}
                  {spec.usedFor}
                </p>
              ) : null}
            </div>
          </ZCard>

          <ZCard
            title="Chained recipes"
            note="Each step feeds the next, the way the panels actually work — a height becomes a hash becomes a block."
          >
            <div className="z-recipe-list">
              {(catalogue.data?.recipes ?? []).map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  className="z-recipe"
                  onClick={() => void runRecipe(recipe)}
                  disabled={running}
                >
                  <strong>{recipe.title}</strong>
                  <span>{recipe.steps.map((step) => step.method).join(" → ")}</span>
                </button>
              ))}
            </div>
          </ZCard>

          {catalogue.data ? (
            <ZCard title="Limits">
              <div className="z-grid">
                <ZStat
                  label="Per client"
                  value={catalogue.data.limits.perClient}
                  unit="/min"
                  small
                  sub="hand-issued calls only"
                />
                <ZStat
                  label="Global"
                  value={catalogue.data.limits.global}
                  unit="/min"
                  small
                  sub="protects the node's quota"
                />
              </div>
              <p className="z-card-note">
                The panels keep working if the console hits its ceiling — this limit applies to this
                page alone, because a hosted provider meters requests and one open console should not
                be able to spend the day&apos;s budget.
              </p>
            </ZCard>
          ) : null}
        </div>

        <div className="z-stack">
          {outcomes.length === 0 ? (
            <ZCard title="Response">
              <div className="z-chart-empty">
                {running ? "waiting for the node…" : "Send a request or run a recipe."}
              </div>
            </ZCard>
          ) : (
            <ZCard title={heading ?? "Response"} meta={catalogue.meta}>
              {outcomes.map((outcome, index) => (
                <StepView key={index} index={index} outcome={outcome} total={outcomes.length} />
              ))}
              {running ? <p className="z-hint">running next step…</p> : null}
            </ZCard>
          )}
        </div>
      </div>
    </>
  );
}

/* ── param input ─────────────────────────────────────────────────────────── */

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ParamSpec;
  value: string;
  onChange: (next: string) => void;
}) {
  const optional = param.default !== undefined;

  return (
    <label className="z-field">
      <span className="z-label">
        {param.name}
        {optional ? " (optional)" : " (required)"}
      </span>
      {param.kind === "bool" ? (
        <select className="z-select" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">default ({String(param.default)})</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          className="z-input"
          value={value}
          inputMode={param.kind === "int" ? "numeric" : "text"}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            optional
              ? `default ${String(param.default)}`
              : param.kind === "txid"
                ? "64 hex characters"
                : param.kind === "block-id"
                  ? "height or block hash"
                  : "required"
          }
        />
      )}
      <span className="z-hint">
        {param.hint}
        {param.min !== undefined && param.max !== undefined ? ` (${param.min}–${param.max})` : ""}
      </span>
    </label>
  );
}

/* ── one step of output ──────────────────────────────────────────────────── */

function StepView({
  outcome,
  index,
  total,
}: {
  outcome: StepOutcome;
  index: number;
  total: number;
}) {
  const stepLabel = total > 1 ? `${index + 1}/${total}` : null;

  if (outcome.kind === "skipped") {
    return (
      <div className="z-step">
        <div className="z-step-head">
          {stepLabel ? <span className="z-label">{stepLabel}</span> : null}
          <b>{outcome.method}</b>
          <ZBadge tone="warn">skipped</ZBadge>
        </div>
        <p className="z-hint" style={{ margin: 0 }}>
          {outcome.reason}
        </p>
      </div>
    );
  }

  if (outcome.kind === "rejected") {
    return (
      <div className="z-step">
        <div className="z-step-head">
          {stepLabel ? <span className="z-label">{stepLabel}</span> : null}
          <b>{outcome.method}</b>
          <ZBadge tone="bad">rejected by ZPulse</ZBadge>
        </div>
        <p className="z-hint" style={{ margin: 0 }}>
          {outcome.message}
        </p>
      </div>
    );
  }

  const { call } = outcome;
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleCopyCurl = () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: "zpulse",
      method: call.method,
      params: call.params,
    });
    const curlCmd = `curl --location --request POST 'http://127.0.0.1:8232' \\\n--header 'Content-Type: application/json' \\\n--data-raw '${payload.replace(/'/g, "'\\''")}'`;
    void navigator.clipboard.writeText(curlCmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const isUnsupported =
    !call.ok &&
    (call.error?.kind === "RpcUnsupportedError" ||
      call.error?.message?.includes("-32601") ||
      call.error?.message?.toLowerCase().includes("not implement") ||
      call.error?.message?.toLowerCase().includes("method not found"));

  return (
    <div className="z-step">
      <div className="z-step-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div className="z-row" style={{ gap: 8, alignItems: "center" }}>
          {stepLabel ? <span className="z-label">{stepLabel}</span> : null}
          <b>{call.method}</b>
          {call.ok ? (
            <ZBadge tone="ok">200 ok</ZBadge>
          ) : isUnsupported ? (
            <ZBadge tone="warn">Unsupported on Node (−32601)</ZBadge>
          ) : (
            <ZBadge tone="warn">node returned an error</ZBadge>
          )}
          {call.latencyMs !== null ? <ZBadge>{call.latencyMs}ms</ZBadge> : null}
        </div>
        <button
          type="button"
          className="z-btn z-btn-sm"
          onClick={handleCopyCurl}
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          title="Copy command formatted as cURL"
        >
          {copiedCurl ? <HiCheck style={{ color: "var(--z-good)" }} /> : <HiOutlineDocumentDuplicate />}
          <span>{copiedCurl ? "Copied cURL" : "Copy cURL"}</span>
        </button>
      </div>

      {outcome.use ? (
        <p className="z-hint" style={{ marginTop: 0 }}>
          {outcome.use}
        </p>
      ) : null}

      <div className="z-label" style={{ marginBottom: 4 }}>
        Sent
      </div>
      <ZJsonView value={call.request} maxHeight={160} />

      <div className="z-label" style={{ margin: "12px 0 4px" }}>
        {call.ok ? "Received" : "Error"}
      </div>
      {call.ok ? (
        <ZJsonView value={call.result} maxHeight={380} />
      ) : isUnsupported ? (
        <div className="z-banner" style={{ margin: 0, borderLeft: "3px solid var(--z-warn)" }}>
          <div>
            <strong>Method Unsupported on this node profile (−32601).</strong>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--z-text-muted)" }}>
              The connected node does not implement <code>{call.method}</code>. This is normal for lightweight remote endpoints or older Zebra versions. ZPulse observatory panels automatically route around this with consensus fallbacks.
            </p>
          </div>
        </div>
      ) : (
        <div className="z-banner z-bad" style={{ margin: 0 }}>
          <strong>{call.error?.kind ?? "Error"}.</strong> {call.error?.message}
        </div>
      )}
    </div>
  );
}
