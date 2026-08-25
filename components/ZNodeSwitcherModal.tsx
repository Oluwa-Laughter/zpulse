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
    cookieFile?: string;
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
  const [cookieFile, setCookieFile] = useState("");

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
            if (data.session.cookieFile) setCookieFile(data.session.cookieFile);
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
        cookieFile: cookieFile || undefined,
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
                  background: "var(--z-bg-raised)",
                  border: "1px solid var(--z-line)",
                  borderRadius: "var(--z-radius)",
                  padding: "14px 16px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontWeight: 600, color: "var(--z-amber)" }}>
                  <HiOutlineComputerDesktop style={{ fontSize: 18 }} />
                  <span style={{ fontSize: 13.5 }}>Running with a Local Zebra Node</span>
                </div>
                <p style={{ margin: "0 0 10px", color: "var(--z-text)", fontSize: 13 }}>
                  To connect directly to your local Zebra node (<code>127.0.0.1:8232</code>), clone the repo and run ZPulse locally on your machine:
                </p>
                <div
                  style={{
                    background: "var(--z-bg-deep)",
                    padding: "10px 12px",
                    borderRadius: "var(--z-radius)",
                    border: "1px solid var(--z-line)",
                    fontFamily: "var(--z-mono)",
                    fontSize: 11.5,
                    color: "var(--z-text)",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ color: "var(--z-text-muted)", marginBottom: 4 }}># 1. Clone repo & install</div>
                  <div style={{ color: "var(--z-amber)" }}>
                    git clone https://github.com/Oluwa-Laughter/zpulse.git && cd zpulse && npm install
                  </div>
                  <div style={{ color: "var(--z-text-muted)", margin: "8px 0 4px" }}># 2. Start local Zebra node (Native zebrad)</div>
                  <div style={{ color: "var(--z-amber)" }}>npm run node:mainnet</div>
                  <div style={{ color: "var(--z-text-muted)", margin: "8px 0 4px" }}># 3. Start local web dashboard</div>
                  <div style={{ color: "var(--z-amber)" }}>npm run dev</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <a
                    href="https://github.com/Oluwa-Laughter/zpulse#quick-start-running-locally-with-live-zebra-node"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="z-btn z-btn-sm z-primary"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <span>View GitHub Setup Guide ↗</span>
                  </a>
                  <span style={{ fontSize: 11.5, color: "var(--z-text-dim)" }}>
                    On this live cloud link, use <strong>Interactive Demo</strong> or <strong>3rd-Party Remote RPC</strong>.
                  </span>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "var(--z-bg-raised)",
                  padding: "12px 14px",
                  borderRadius: "var(--z-radius)",
                  border: "1px solid var(--z-line)",
                  fontSize: 12,
                  color: "var(--z-text-muted)",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--z-text)", marginBottom: 4 }}>Native Zebra Node (Terminal Scripts):</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                  <div style={{ background: "var(--z-bg-deep)", padding: "6px 10px", borderRadius: 4, fontFamily: "var(--z-mono)", fontSize: 11 }}>
                    <span style={{ color: "var(--z-text-dim)" }}># Mainnet (8232):</span><br />
                    <span style={{ color: "var(--z-amber)" }}>npm run node:mainnet</span>
                  </div>
                  <div style={{ background: "var(--z-bg-deep)", padding: "6px 10px", borderRadius: 4, fontFamily: "var(--z-mono)", fontSize: 11 }}>
                    <span style={{ color: "var(--z-text-dim)" }}># Testnet (18232):</span><br />
                    <span style={{ color: "var(--z-amber)" }}>npm run node:testnet</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label className="z-label" htmlFor="local-url-input" style={{ margin: 0 }}>Local RPC Endpoint URL</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="z-btn z-btn-xs"
                    onClick={() => setLocalUrl("http://127.0.0.1:8232")}
                    style={{
                      background: localUrl.includes("8232") && !localUrl.includes("18232") ? "var(--z-accent-faint)" : "var(--z-bg-deep)",
                      borderColor: localUrl.includes("8232") && !localUrl.includes("18232") ? "var(--z-accent)" : "var(--z-line)",
                      color: localUrl.includes("8232") && !localUrl.includes("18232") ? "var(--z-accent)" : "var(--z-text-muted)",
                      fontSize: 11,
                      padding: "2px 8px",
                    }}
                  >
                    Mainnet (8232)
                  </button>
                  <button
                    type="button"
                    className="z-btn z-btn-xs"
                    onClick={() => setLocalUrl("http://127.0.0.1:18232")}
                    style={{
                      background: localUrl.includes("18232") ? "var(--z-accent-faint)" : "var(--z-bg-deep)",
                      borderColor: localUrl.includes("18232") ? "var(--z-accent)" : "var(--z-line)",
                      color: localUrl.includes("18232") ? "var(--z-accent)" : "var(--z-text-muted)",
                      fontSize: 11,
                      padding: "2px 8px",
                    }}
                  >
                    Testnet (18232)
                  </button>
                </div>
              </div>
              <input
                id="local-url-input"
                type="text"
                className="z-input"
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                placeholder="http://127.0.0.1:8232"
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label className="z-label" htmlFor="local-cookie-input">Cookie Auth File (optional, auto-detected if empty)</label>
              <input
                id="local-cookie-input"
                type="text"
                className="z-input"
                value={cookieFile}
                onChange={(e) => setCookieFile(e.target.value)}
                placeholder="~/.cache/zebra/.cookie"
                style={{ width: "100%", marginTop: 4, fontFamily: "var(--z-mono)", fontSize: 12 }}
              />
              <span style={{ fontSize: 11, color: "var(--z-text-faint)", marginTop: 2, display: "block" }}>
                Auto-reads session secret from <code>~/.cache/zebra/.cookie</code> on Linux/macOS.
              </span>
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
