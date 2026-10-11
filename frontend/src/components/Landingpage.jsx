import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Landingpage.css";

/* ---------- Small inline icons (no icon library dependency) ---------- */

const Icon = {
  Shield: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  Scan: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  ),
  Text: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  ),
  Spark: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  ),
  Network: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="12" cy="18" r="2.2" />
      <path d="M6.9 7.3 10.3 16M17.1 7.3 13.7 16M7.2 6h9.6" />
    </svg>
  ),
  Gavel: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 4 20 10M8.5 9.5l-6 6 2 2 6-6M12 7l5 5M2 22h12" />
    </svg>
  ),
  Upload: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  Check: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  CheckCircle: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" />
    </svg>
  ),
  Alert: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10.3 3.86 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  XCircle: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  Clock: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" /><polyline points="12 7 12 12 15.5 14" />
    </svg>
  ),
  Lock: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  User: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Key: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 19 4M16 7l2 2M13 10l2 2" />
    </svg>
  ),
  Server: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" />
      <line x1="7" y1="7.5" x2="7.01" y2="7.5" /><line x1="7" y1="16.5" x2="7.01" y2="16.5" />
    </svg>
  ),
  EyeOff: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17.9 17.9A10.4 10.4 0 0 1 12 20c-5 0-9.3-3.1-11-7.5a11.4 11.4 0 0 1 3.1-4.2M9.9 4.2A10.6 10.6 0 0 1 12 4c5 0 9.3 3.1 11 7.5a11.3 11.3 0 0 1-2.3 3.6" />
      <path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" /><line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),
  IdCard: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="12" r="2" />
      <line x1="13" y1="10" x2="18" y2="10" /><line x1="13" y1="14" x2="18" y2="14" />
    </svg>
  ),
  Menu: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  Close: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  ArrowRight: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  ChevronDown: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
};

/* ---------- Content data ---------- */

const PIPELINE_STAGES = [
  { n: "01", icon: Icon.Scan, title: "Document Classification", desc: "Identify supported KYC documents." },
  { n: "02", icon: Icon.Text, title: "OCR", desc: "Extract text from the original document." },
  { n: "03", icon: Icon.Spark, title: "AI Extraction", desc: "Convert OCR text into structured identity data." },
  { n: "04", icon: Icon.Network, title: "Graph Risk", desc: "Identify suspicious identity relationships." },
  { n: "05", icon: Icon.Gavel, title: "Decision Engine", desc: "Apply deterministic KYC rules." }
];

const HOW_IT_WORKS = [
  { n: "01", icon: Icon.Upload, title: "Upload", desc: "Securely submit an identity document through the authenticated verification workflow." },
  { n: "02", icon: Icon.Scan, title: "Classify", desc: "The CNN classifier identifies the document type." },
  { n: "03", icon: Icon.Text, title: "Extract", desc: "OCR and AI extraction convert document content into structured information." },
  { n: "04", icon: Icon.Network, title: "Analyze", desc: "Graph-based analysis evaluates identity relationships and potential anomalies." },
  { n: "05", icon: Icon.Gavel, title: "Decide", desc: "Deterministic business rules produce an Approved, Suspicious, Rejected, or Pending outcome." }
];

const FEATURES = [
  { icon: Icon.Scan, title: "Document Intelligence", desc: "Automatically identify supported KYC documents before deeper analysis." },
  { icon: Icon.Text, title: "OCR Processing", desc: "Extract readable document content for downstream verification." },
  { icon: Icon.Spark, title: "AI-Powered Extraction", desc: "Transform unstructured OCR text into structured identity information." },
  { icon: Icon.Network, title: "Graph-Based Risk Analysis", desc: "Identify potentially shared identity relationships across verification records." },
  { icon: Icon.Gavel, title: "Explainable Decisions", desc: "Generate deterministic decisions with machine-readable reasons." },
  { icon: Icon.Lock, title: "Authenticated Verification", desc: "Keep verification workflows protected behind authenticated access." }
];

const ARCHITECTURE_LAYERS = [
  { label: "React Frontend", tech: "React" },
  { label: "Node.js / Express API", tech: "Node.js · Express · JWT" },
  { label: "Flask ML Service", tech: "Python · Flask" },
  { label: "Verification Stages", tech: "TensorFlow Lite · EasyOCR · Groq · NetworkX", isGroup: true },
  { label: "Decision Engine", tech: "Deterministic rules" },
  { label: "MongoDB", tech: "Verification records" }
];

const OUTCOMES = [
  {
    key: "approved", icon: Icon.CheckCircle, label: "Approved", tone: "approved",
    points: ["Valid KYC document", "Required information available", "Validation passed", "No configured blocking anomaly"]
  },
  {
    key: "suspicious", icon: Icon.Alert, label: "Suspicious", tone: "suspicious",
    points: ["Strong anomaly or identity relationship detected", "Additional review recommended"]
  },
  {
    key: "rejected", icon: Icon.XCircle, label: "Rejected", tone: "rejected",
    points: ["Unsupported or non-KYC document", "Invalid required identifier", "Blocking validation failure"]
  },
  {
    key: "pending", icon: Icon.Clock, label: "Pending", tone: "pending",
    points: ["Insufficient evidence", "Processing incomplete", "Temporary service failure"]
  }
];

const SECURITY_POINTS = [
  { icon: Icon.User, title: "Authenticated Access", desc: "Verification endpoints are protected by authentication." },
  { icon: Icon.Lock, title: "User Isolation", desc: "Users can access only their own verification history." },
  { icon: Icon.Server, title: "Controlled Backend Processing", desc: "Document and ML processing remain behind the backend architecture." },
  { icon: Icon.Key, title: "Secret Protection", desc: "API credentials remain server-side." },
  { icon: Icon.EyeOff, title: "Sensitive Logging Controls", desc: "Sensitive document and identity values are not intentionally written to application logs." }
];

const DOCUMENTS = ["Aadhaar", "PAN", "Passport", "Non-KYC Detection"];

const NAV_LINKS = [
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How It Works" },
  { id: "technology", label: "Technology" },
  { id: "security", label: "Security" }
];

function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollToSection = (id) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToVerification = () => navigate("/upload");
  const handleLogout = () => {
    logout();
    setMenuOpen(false);
  };

  return (
    <div className="vai">
      {/* ===== Navbar ===== */}
      <header className="vai-navbar">
        <div className="vai-navbar-inner">
          <div className="vai-brand" onClick={() => navigate("/")}>
            <Icon.Shield className="vai-brand-icon" />
            <span>VerifyAI</span>
          </div>

          <nav className="vai-nav-links" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <button key={l.id} className="vai-nav-link" onClick={() => scrollToSection(l.id)}>
                {l.label}
              </button>
            ))}
          </nav>

          <div className="vai-nav-actions">
            {isAuthenticated ? (
              <>
                <button className="vai-btn vai-btn-ghost" onClick={() => navigate("/account")}>Account</button>
                <button className="vai-btn vai-btn-ghost" onClick={handleLogout}>Logout</button>
                <button className="vai-btn vai-btn-primary" onClick={goToVerification}>
                  Start Verification <Icon.ArrowRight className="vai-btn-icon" />
                </button>
              </>
            ) : (
              <>
                <button className="vai-btn vai-btn-ghost" onClick={() => navigate("/login")}>Sign In</button>
                <button className="vai-btn vai-btn-primary" onClick={() => navigate("/register")}>
                  Get Started <Icon.ArrowRight className="vai-btn-icon" />
                </button>
              </>
            )}
          </div>

          <button
            className="vai-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <Icon.Close /> : <Icon.Menu />}
          </button>
        </div>

        {menuOpen && (
          <div className="vai-mobile-menu">
            {NAV_LINKS.map((l) => (
              <button key={l.id} className="vai-mobile-link" onClick={() => scrollToSection(l.id)}>
                {l.label}
              </button>
            ))}
            <div className="vai-mobile-divider" />
            {isAuthenticated ? (
              <>
                <button className="vai-mobile-link" onClick={() => { setMenuOpen(false); navigate("/account"); }}>Account</button>
                <button className="vai-mobile-link" onClick={handleLogout}>Logout</button>
                <button className="vai-btn vai-btn-primary vai-mobile-cta" onClick={() => { setMenuOpen(false); goToVerification(); }}>
                  Start Verification
                </button>
              </>
            ) : (
              <>
                <button className="vai-mobile-link" onClick={() => { setMenuOpen(false); navigate("/login"); }}>Sign In</button>
                <button className="vai-btn vai-btn-primary vai-mobile-cta" onClick={() => { setMenuOpen(false); navigate("/register"); }}>
                  Get Started
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* ===== Hero ===== */}
      <section className="vai-hero">
        <div className="vai-hero-bg" aria-hidden="true" />
        <div className="vai-hero-grid">
          <div className="vai-hero-copy">
            <span className="vai-badge">⚡ AI-POWERED KYC VERIFICATION</span>
            <h1 className="vai-hero-title">
              Verify identities.
              <br />
              Detect risk.
              <br />
              <span className="vai-hero-title-accent">Make smarter KYC decisions.</span>
            </h1>
            <p className="vai-hero-desc">
              VerifyAI automates the KYC verification workflow using document intelligence,
              OCR, AI-powered identity extraction, graph-based risk analysis, and explainable
              decision rules.
            </p>
            <div className="vai-hero-buttons">
              <button className="vai-btn vai-btn-primary vai-btn-lg" onClick={goToVerification}>
                Start Verification <Icon.ArrowRight className="vai-btn-icon" />
              </button>
              <button className="vai-btn vai-btn-outline vai-btn-lg" onClick={() => scrollToSection("how-it-works")}>
                Explore How It Works
              </button>
            </div>
            <div className="vai-hero-trust">
              <span>Secure backend processing</span>
              <span className="vai-dot">•</span>
              <span>Authenticated access</span>
              <span className="vai-dot">•</span>
              <span>Explainable decisions</span>
            </div>
          </div>

          <div className="vai-hero-visual">
            <div className="vai-preview-card">
              <div className="vai-preview-header">
                <span className="vai-preview-label">Example Verification</span>
                <span className="vai-preview-tag">Demo Result</span>
              </div>
              <div className="vai-preview-row">
                <span className="vai-preview-key">Document</span>
                <span className="vai-preview-val">PAN / Aadhaar / Passport</span>
              </div>
              {[
                "Document Classification",
                "OCR",
                "AI Extraction",
                "Graph Analysis"
              ].map((step, i) => (
                <div className="vai-preview-step" key={step} style={{ animationDelay: `${i * 0.25}s` }}>
                  <span className="vai-preview-check"><Icon.Check /></span>
                  <span>{step}</span>
                  <span className="vai-preview-complete">Complete</span>
                </div>
              ))}
              <div className="vai-preview-row">
                <span className="vai-preview-key">Risk Level</span>
                <span className="vai-preview-val vai-risk-low">Low</span>
              </div>
              <div className="vai-preview-decision">
                <span>Decision</span>
                <span className="vai-preview-decision-badge">APPROVED</span>
              </div>
              <p className="vai-preview-footnote">Illustrative example — not a real verification record.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Capability Strip ===== */}
      <section className="vai-strip" aria-label="Verification pipeline overview">
        <h2 className="vai-strip-title">One intelligent KYC pipeline</h2>
        <div className="vai-strip-row">
          {PIPELINE_STAGES.map((s, i) => (
            <React.Fragment key={s.title}>
              <div className="vai-strip-stage">
                <div className="vai-strip-icon"><s.icon /></div>
                <div className="vai-strip-num">{s.n}</div>
                <div className="vai-strip-stage-title">{s.title}</div>
                <div className="vai-strip-stage-desc">{s.desc}</div>
              </div>
              {i < PIPELINE_STAGES.length - 1 && <div className="vai-strip-arrow" aria-hidden="true"><Icon.ArrowRight /></div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ===== How It Works ===== */}
      <section className="vai-section" id="how-it-works">
        <div className="vai-section-head">
          <span className="vai-eyebrow">How VerifyAI Works</span>
          <h2>From document to decision in one intelligent workflow.</h2>
          <p>Multiple verification stages work together to transform an uploaded identity document into an explainable KYC decision.</p>
        </div>
        <div className="vai-steps-grid">
          {HOW_IT_WORKS.map((s) => (
            <div className="vai-step-card" key={s.title}>
              <div className="vai-step-top">
                <div className="vai-step-icon"><s.icon /></div>
                <span className="vai-step-num">{s.n}</span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Features ===== */}
      <section className="vai-section vai-section-alt" id="features">
        <div className="vai-section-head">
          <span className="vai-eyebrow">Capabilities</span>
          <h2>Built for intelligent KYC verification</h2>
        </div>
        <div className="vai-features-grid">
          {FEATURES.map((f) => (
            <div className="vai-feature-card" key={f.title}>
              <div className="vai-feature-icon"><f.icon /></div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Technology ===== */}
      <section className="vai-section vai-section-dark" id="technology">
        <div className="vai-section-head">
          <span className="vai-eyebrow vai-eyebrow-light">Architecture</span>
          <h2 className="vai-light-heading">Built as a modular AI verification architecture</h2>
        </div>
        <div className="vai-arch">
          {ARCHITECTURE_LAYERS.map((layer, i) => (
            <React.Fragment key={layer.label}>
              <div className={`vai-arch-layer ${layer.isGroup ? "vai-arch-layer-group" : ""}`}>
                <div className="vai-arch-label">{layer.label}</div>
                <div className="vai-arch-tech">{layer.tech}</div>
              </div>
              {i < ARCHITECTURE_LAYERS.length - 1 && (
                <div className="vai-arch-connector" aria-hidden="true">
                  <Icon.ChevronDown />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ===== Decision Outcomes ===== */}
      <section className="vai-section">
        <div className="vai-section-head">
          <span className="vai-eyebrow">Verification Outcomes</span>
          <h2>Every verification produces a clear, explainable outcome</h2>
          <p>Decisions are generated by the verification workflow's deterministic rules — "Suspicious" means a risk signal needs review, not that fraud is confirmed.</p>
        </div>
        <div className="vai-outcomes-grid">
          {OUTCOMES.map((o) => (
            <div className={`vai-outcome-card vai-outcome-${o.tone}`} key={o.key}>
              <div className="vai-outcome-icon"><o.icon /></div>
              <h3>{o.label}</h3>
              <ul>
                {o.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Security ===== */}
      <section className="vai-section vai-section-alt" id="security">
        <div className="vai-section-head">
          <span className="vai-eyebrow">Security</span>
          <h2>Security built into the verification workflow</h2>
        </div>
        <div className="vai-security-grid">
          {SECURITY_POINTS.map((s) => (
            <div className="vai-security-card" key={s.title}>
              <div className="vai-security-icon"><s.icon /></div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Supported Documents ===== */}
      <section className="vai-section">
        <div className="vai-section-head">
          <span className="vai-eyebrow">Coverage</span>
          <h2>Supported KYC document types</h2>
        </div>
        <div className="vai-docs-grid">
          {DOCUMENTS.map((d) => (
            <div className="vai-doc-card" key={d}>
              <Icon.IdCard className="vai-doc-icon" />
              <span>{d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Final CTA ===== */}
      <section className="vai-cta">
        <h2>Ready to verify an identity?</h2>
        <p>Experience an intelligent KYC workflow from document upload to explainable decision.</p>
        <div className="vai-cta-buttons">
          <button className="vai-btn vai-btn-primary vai-btn-lg" onClick={goToVerification}>
            Start Verification <Icon.ArrowRight className="vai-btn-icon" />
          </button>
          <button className="vai-btn vai-btn-outline vai-btn-lg" onClick={() => navigate("/login")}>
            Sign In
          </button>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="vai-footer">
        <div className="vai-footer-grid">
          <div className="vai-footer-brand">
            <div className="vai-brand vai-brand-light">
              <Icon.Shield className="vai-brand-icon" />
              <span>VerifyAI</span>
            </div>
            <p>AI-powered KYC verification and risk analysis.</p>
          </div>

          <div className="vai-footer-col">
            <h4>Product</h4>
            <button onClick={() => scrollToSection("features")}>Features</button>
            <button onClick={() => scrollToSection("how-it-works")}>How It Works</button>
            <button onClick={() => scrollToSection("technology")}>Technology</button>
            <button onClick={() => scrollToSection("security")}>Security</button>
          </div>

          <div className="vai-footer-col">
            <h4>Account</h4>
            <button onClick={() => navigate("/login")}>Sign In</button>
            <button onClick={() => navigate("/register")}>Create Account</button>
          </div>

          <div className="vai-footer-col">
            <h4>Resources</h4>
            <a href="https://github.com/sadafkhanhgt-svg/Infosys_AI_KYC_Compliance" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
        <div className="vai-footer-bottom">
          <span>© 2026 VerifyAI</span>
          <span>AI-powered KYC compliance platform.</span>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
