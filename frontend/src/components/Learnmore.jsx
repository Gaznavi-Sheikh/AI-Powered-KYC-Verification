import React from "react";
import "./Learnmore.css";

function LearnMore() {
  return (
    <div className="learn-container">

      <h1 className="learn-title">
        Intelligent Verification Engine
      </h1>

      <p className="learn-subtitle">
        Multi-layered AI approach combining cutting-edge technologies for unmatched accuracy.
      </p>

      <div className="features-grid">

        <div className="feature-card">
          <h3>Graph Neural Networks</h3>
          <p>
            Detect complex fraud patterns and anomalous relationships
            across identity networks using advanced GNN models.
          </p>
        </div>

        <div className="feature-card highlight">
          <h3>Document Intelligence</h3>
          <p>
            NLP-powered analysis of AADHAR cards, utility bills,
            and KYC documents with Azure OpenAI integration.
          </p>
        </div>

        <div className="feature-card">
          <h3>Computer Vision</h3>
          <p>
            Automated document authenticity checks using
            deep learning-based image analysis and OCR extraction.
          </p>
        </div>

        <div className="feature-card">
          <h3>Real-Time Fraud Alerts</h3>
          <p>
            Live monitoring pipelines that flag suspicious
            identities and trigger instant compliance workflows.
          </p>
        </div>

      </div>

    </div>
  );
}

export default LearnMore;