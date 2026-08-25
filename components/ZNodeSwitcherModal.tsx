"use client";

import { useEffect, useState } from "react";
import {
  HiOutlineServerStack,
  HiOutlineComputerDesktop,
  HiOutlineCloud,
  HiOutlineShieldCheck,
  HiOutlineBolt,
  HiOutlineXMark,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlineArrowPath,
  HiOutlineLockClosed,
} from "react-icons/hi2";

type ConnectionMode = "demo" | "local" | "remote";

interface ConnectionData {
  mode: "demo" | "live";
  endpoint: string;
  isDemo: boolean;
  isCustomSession: boolean;
  session?: {
    mode: "demo" | "live";
    url: string;
    hasApiKey: boolean;
    headerName?: string;
  } | null;
}

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  height?: number | null;
  chain?: string;
  endpoint?: string;
}

export function ZNodeSwitcherModal({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ConnectionMode>("demo");
  const [currentConnection, setCurrentConnection] = useState<ConnectionData | null>(null);

  // Local Node Form State
  const [localUrl, setLocalUrl] = useState("http://127.0.0.1:8232");

  // 3rd-Party Remote RPC Form State
  const [remoteUrl, setRemoteUrl] = useState("");
  const [headerName, setHeaderName] = useState("api-key");
  const [apiKey, setApiKey] = useState("");

  // Test & Submit states
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [isCloud, setIsCloud] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      setIsCloud(!host.includes("localhost") && !host.includes("127.0.0.1") && !host.includes("0.0.0.0"));
    }
  }, []);

  // Fetch current active connection on open
  useEffect(() => {
    if (!isOpen) return;
    setTestResult(null);

    fetch("/api/connection")
      .then((res) => res.json())
      .then((body) => {
        if (body.data) {
          const data = body.data as ConnectionData;
          setCurrentConnection(data);
          if (data.isDemo) {
            setActiveTab("demo");
          } else if (data.session?.url && (data.session.url.includes("127.0.0.1") || data.session.url.includes("localhost"))) {
            setActiveTab("local");
            setLocalUrl(data.session.url);
          } else if (data.session?.url) {
            setActiveTab("remote");
            setRemoteUrl(data.session.url);
            if (data.session.headerName) setHeaderName(data.session.headerName);
          }
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Test Connection Action
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    let payload: Record<string, unknown> = {};

    if (activeTab === "demo") {
      payload = { action: "test", mode: "demo" };
    } else if (activeTab === "local") {
      payload = {
        action: "test",
        mode: "live",
        url: localUrl,
      };
    } else {
      payload = {
        action: "test",
        mode: "live",
        url: remoteUrl,
        headerName: headerName || "api-key",
        apiKey: apiKey || undefined,
      };
    }

    try {
      const res = await fetch("/api/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (res.ok && body.data?.ok) {
        setTestResult({
          ok: true,
          message: body.data.message || "Connection successful!",
          latencyMs: body.data.latencyMs,
          height: body.data.height,
          chain: body.data.chain,
          endpoint: body.data.endpoint,
        });
      } else {
        setTestResult({
          ok: false,
          message: body.error?.message || "Failed to reach the node.",
          endpoint: body.error?.endpoint,
        });
      }
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Network error testing endpoint.",
      });
    } finally {
      setTesting(false);
    }
  };

  // Save Connection Action
  const handleSaveConnection = async () => {
    setSaving(true);
    let payload: Record<string, unknown> = {};

    if (activeTab === "demo") {
      payload = { action: "save", mode: "demo" };
    } else if (activeTab === "local") {
      payload = {
        action: "save",
        mode: "live",
        url: localUrl,
      };
    } else {
      payload = {
        action: "save",
        mode: "live",
        url: remoteUrl,
        headerName: headerName || "api-key",
        apiKey: apiKey || undefined,
      };
    }

    try {
      const res = await fetch("/api/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onClose();
        if (onChanged) onChanged();
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  };

  // Reset to Server Defaults Action
  const handleReset = async () => {
    setSaving(true);
    try {
      await fetch("/api/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      onClose();
      if (onChanged) onChanged();
      window.location.reload();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="z-modal-backdrop" onClick={onClose}>
      <div className="z-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="z-modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HiOutlineServerStack style={{ fontSize: 22, color: "var(--z-amber)" }} />
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Zcash Node Connection</h2>
              <p style={{ margin: 0, fontSize: 12, color: "var(--z-text-muted)" }}>
                Choose between Demo Sandbox, Local Node, or 3rd-Party Remote RPC.
              </p>
            </div>
          </div>
          <button type="button" className="z-btn-icon" onClick={onClose} aria-label="Close modal">
            <HiOutlineXMark style={{ fontSize: 20 }} />
          </button>
        </div>

        {/* Current Active Source Pill */}
        {currentConnection && (
          <div style={{ padding: "10px 14px", background: "var(--z-bg-deep)", borderRadius: "var(--z-radius)", marginBottom: 16, border: "1px solid var(--z-line)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`z-dot ${currentConnection.isDemo ? "z-demo" : "z-live"}`} />
              <span><strong>Active Node:</strong> {currentConnection.endpoint}</span>
            </div>
            {currentConnection.isCustomSession && (
              <span className="z-badge z-accent" style={{ fontSize: 10 }}>Session Override</span>
            )}
          </div>
        )}

        {/* Mode Selector Tabs */}
        <div className="z-tabs" style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={`z-tab ${activeTab === "demo" ? "z-active" : ""}`}
            onClick={() => {
              setActiveTab("demo");
              setTestResult(null);
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <HiOutlineShieldCheck style={{ fontSize: 15 }} />
            <span>Interactive Demo</span>
          </button>
          <button
            type="button"
            className={`z-tab ${activeTab === "local" ? "z-active" : ""}`}
            onClick={() => {
              setActiveTab("local");
              setTestResult(null);
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <HiOutlineComputerDesktop style={{ fontSize: 15 }} />
            <span>Local Node</span>
          </button>
          <button
            type="button"
            className={`z-tab ${activeTab === "remote" ? "z-active" : ""}`}
            onClick={() => {
              setActiveTab("remote");
              setTestResult(null);
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <HiOutlineCloud style={{ fontSize: 15 }} />
            <span>3rd-Party Remote RPC</span>
          </button>
        </div>

        {/* TAB 1: DEMO SANDBOX */}
        {activeTab === "demo" && (
          <div className="z-stack" style={{ gap: 14 }}>
            <div style={{ background: "var(--z-bg-raised)", padding: 14, borderRadius: "var(--z-radius)", border: "1px solid var(--z-line)" }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>Built-in Zebra Mainnet Dialect</h4>
              <p style={{ margin: 0, fontSize: 13, color: "var(--z-text-muted)", lineHeight: 1.5 }}>
                Zero credentials or local node needed. Emulates an authentic Zcash mainnet Zebra node with realistic blocks, mempool transactions, turnstile flows, and ZIP-208 mathematical supply reconciliation.
              </p>
            </div>
            <div style={{ fontSize: 12, color: "var(--z-text-faint)" }}>
              Recommended for live cloud presentations, judges, and instant evaluation.
            </div>
          </div>
        )}

        {/* TAB 2: LOCAL NODE */}
        {activeTab === "local" && (
          <div className="z-stack" style={{ gap: 12 }}>
            {isCloud ? (
              <div
                style={{
                  background: "rgba(242, 183, 33, 0.08)",
                  border: "1px solid rgba(242, 183, 33, 0.25)",
                  borderRadius: "var(--z-radius)",
                  padding: "12px 14px",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontWeight: 600, color: "var(--z-amber)" }}>
                  <HiOutlineExclamationCircle style={{ fontSize: 16 }} />
                  <span>Cloud Deployment Notice ({typeof window !== "undefined" ? window.location.hostname : "Cloud"})</span>
                </div>
                <p style={{ margin: "0 0 6px", color: "var(--z-text)" }}>
                  Because this app is hosted on Vercel cloud servers, it cannot directly reach <code>127.0.0.1</code> on your physical computer.
                </p>
                <div style={{ color: "var(--z-text-muted)" }}>
                  <strong>To connect your local Zebra node to this cloud link:</strong>
                  <ol style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    <li>
                      Run a secure tunnel locally:{" "}
                      <code style={{ background: "var(--z-bg-deep)", padding: "2px 6px", borderRadius: 3 }}>
                        npx localtunnel --port 8232
                      </code>{" "}
                      (or <code>ngrok http 8232</code>)
                    </li>
                    <li>
                      Switch to the <strong>3rd-Party Remote RPC</strong> tab and paste your tunnel URL (e.g. <code>https://...loca.lt</code>).
                    </li>
                  </ol>
                  <p style={{ margin: "8px 0 0", fontSize: 11.5 }}>
                    <em>Alternatively, run ZPulse locally with <code>npm run dev</code> for zero-config localhost integration.</em>
                  </p>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "var(--z-bg-raised)",
                  padding: 12,
                  borderRadius: "var(--z-radius)",
                  border: "1px solid var(--z-line)",
                  fontSize: 12,
                  color: "var(--z-text-muted)",
                }}
              >
                <strong>To start your local Zebra node via Docker:</strong>
                <code style={{ display: "block", marginTop: 4, padding: "4px 8px", background: "var(--z-bg-deep)", borderRadius: 4 }}>
                  npm run node:start
                </code>
              </div>
            )}

            <div>
              <label className="z-label" htmlFor="local-url-input">Local RPC Endpoint URL</label>
              <input
                id="local-url-input"
                type="text"
                className="z-input"
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                placeholder="http://127.0.0.1:8232"
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
          </div>
        )}

        {/* TAB 3: 3RD-PARTY REMOTE RPC */}
        {activeTab === "remote" && (
          <div className="z-stack" style={{ gap: 12 }}>
            {/* Privacy & Zero-Leak Callout */}
            <div style={{ background: "rgba(242, 183, 33, 0.08)", border: "1px solid rgba(242, 183, 33, 0.25)", borderRadius: "var(--z-radius)", padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
              <HiOutlineLockClosed style={{ fontSize: 16, color: "var(--z-amber)", flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong style={{ color: "var(--z-text)" }}>Private & Secure:</strong>
                <span style={{ color: "var(--z-text-muted)", marginLeft: 4 }}>
                  Your API key is sent server-to-server and saved strictly in an HttpOnly session cookie. It is never exposed in browser JavaScript or client bundles.
                </span>
              </div>
            </div>

            <div>
              <label className="z-label" htmlFor="remote-url-input">3rd-Party RPC Endpoint URL</label>
              <input
                id="remote-url-input"
                type="text"
                className="z-input"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://your-zcash-node-provider.com/rpc"
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
              <div>
                <label className="z-label" htmlFor="header-name-input">Header Name</label>
                <input
                  id="header-name-input"
                  type="text"
                  className="z-input"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="api-key"
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>

              <div>
                <label className="z-label" htmlFor="api-key-input">Private API Key / Secret Token</label>
                <input
                  id="api-key-input"
                  type="password"
                  className="z-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter private API key"
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TEST RESULT STATUS DISPLAY */}
        {testResult && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--z-radius)",
              marginTop: 14,
              border: `1px solid ${testResult.ok ? "var(--z-ok)" : "var(--z-bad)"}`,
              background: testResult.ok ? "rgba(40, 167, 69, 0.1)" : "rgba(220, 53, 69, 0.1)",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
            }}
          >
            {testResult.ok ? (
              <HiOutlineCheckCircle style={{ fontSize: 16, color: "var(--z-ok)", flexShrink: 0, marginTop: 1 }} />
            ) : (
              <HiOutlineExclamationCircle style={{ fontSize: 16, color: "var(--z-bad)", flexShrink: 0, marginTop: 1 }} />
            )}
            <div>
              <strong>{testResult.ok ? "Connection Healthy!" : "Connection Failed"}</strong>
              <div style={{ marginTop: 2 }}>{testResult.message}</div>
              {testResult.ok && testResult.latencyMs !== undefined && (
                <div style={{ marginTop: 4, color: "var(--z-text-muted)" }}>
                  Network: <code>{testResult.chain || "main"}</code> · Block: <code>#{testResult.height ?? "—"}</code> · Latency: <code>{testResult.latencyMs}ms</code>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FOOTER ACTIONS */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--z-line)" }}>
          <button
            type="button"
            className="z-btn z-btn-sm"
            onClick={handleReset}
            disabled={saving}
            title="Reset connection to server defaults"
          >
            Reset Defaults
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {activeTab !== "demo" && (
              <button
                type="button"
                className="z-btn"
                onClick={handleTestConnection}
                disabled={testing || saving}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <HiOutlineBolt className={testing ? "z-spin" : ""} style={{ fontSize: 14 }} />
                <span>{testing ? "Testing…" : "Test Connection"}</span>
              </button>
            )}

            <button
              type="button"
              className="z-btn z-primary"
              onClick={handleSaveConnection}
              disabled={saving || testing}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <HiOutlineArrowPath className={saving ? "z-spin" : ""} style={{ fontSize: 14 }} />
              <span>{saving ? "Switching…" : "Save & Switch"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
