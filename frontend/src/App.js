import React, { useState, useEffect } from 'react';

function App() {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'
  const [responseMsg, setResponseMsg] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [step, setStep] = useState('idle'); // 'idle' | 'submitted' | 'processing' | 'completed' | 'error'

  // Generate a unique clientId for this browser session on mount
  const [clientId] = useState(() => 'client-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString().slice(-4));

  // Connect to the Server-Sent Events (SSE) stream on Middleware Gateway
  useEffect(() => {
    console.log(`[Frontend] Establishing persistent SSE connection with clientId: ${clientId}`);
    const gatewayHost = window.location.hostname;
    const eventSource = new EventSource(`http://${gatewayHost}:3001/stream?clientId=${clientId}`);

    eventSource.onopen = () => {
      console.log('[Frontend] SSE stream successfully established.');
      setSseConnected(true);
    };

    // Listen for custom job completion events pushed from the Gateway
    eventSource.addEventListener('job_completed', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Frontend] SSE Event Received: job_completed', data);
        setResponseMsg(data.result || 'Successfully processed job.');
        setStatus('success');
        setStep('completed');
      } catch (err) {
        console.error('[Frontend] Failed to parse SSE event payload:', err);
        setResponseMsg('Invalid response format received from server.');
        setStatus('error');
        setStep('error');
      }
    });

    // Listen for edge toxicity violations pushed from the Gateway
    eventSource.addEventListener('speechViolation', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Frontend] SSE Event Received: speechViolation', data);
        setResponseMsg(data.error || 'Offensive Speech Detected');
        setStatus('error');
        setStep('violation');
        setSecondsLeft(0);
      } catch (err) {
        console.error('[Frontend] Failed to parse SSE speechViolation payload:', err);
        setResponseMsg('Offensive Speech Detected');
        setStatus('error');
        setStep('violation');
        setSecondsLeft(0);
      }
    });

    eventSource.onerror = (err) => {
      console.error('[Frontend] SSE connection encountered an error:', err);
      setSseConnected(false);
    };

    // Cleanup on unmount
    return () => {
      console.log('[Frontend] Closing active SSE stream.');
      eventSource.close();
    };
  }, [clientId]);

  // A local UI visual countdown to help users visually track the 5-second delay.
  useEffect(() => {
    let timer;
    if (status === 'loading' && secondsLeft > 0) {
      timer = setTimeout(() => {
        setSecondsLeft(prev => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(timer);
  }, [status, secondsLeft]);

  const handleInputChange = (e) => {
    setName(e.target.value);
    // Reset pipeline layout if starting a new request
    if (status !== 'loading' && step !== 'idle') {
      setStep('idle');
      setStatus('idle');
      setResponseMsg('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setStatus('loading');
    setStep('submitted');
    setSecondsLeft(5);
    setResponseMsg('');

    try {
      console.log(`[Frontend] Submitting job for "${name}" with clientId: ${clientId}`);
      
      // Submit job via POST to Middleware Gateway running on Port 3001
      const gatewayHost = window.location.hostname;
      const response = await fetch(`http://${gatewayHost}:3001/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, clientId }),
      });

      if (!response.ok) {
        if (response.status === 502) {
          throw new Error('Server Down');
        }
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      // Check for immediate HTTP 202 Accepted ACK
      if (response.status === 202) {
        console.log('[Frontend] Received HTTP 202 Accepted. Job is processing in background.');
        setStep('processing');
      } else {
        const data = await response.json();
        console.log('[Frontend] Received response:', data);
        setStep('processing');
      }
    } catch (err) {
      console.error('[Frontend] Submission failed:', err);
      let errorMsg = err.message;
      if (err.message === 'Failed to fetch') {
        errorMsg = 'Server Down';
      }
      setResponseMsg(errorMsg || 'Failed to submit job to API Gateway.');
      setStatus('error');
      setStep('error');
    }
  };

  return (
    <>
      {/* Decorative background blobs */}
      <div className="bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>

      <div className="container">
        <div className="glass-card">
          {/* SSE Stream status indicator badge */}
          <div className={`sse-badge ${sseConnected ? 'connected' : 'disconnected'}`}>
            <span className="sse-dot"></span>
            {sseConnected ? 'SSE Connected' : 'SSE Offline'}
          </div>

          <h1 className="title">Delayed Processor</h1>
          <p className="subtitle">
            Submit your name to trigger an asynchronous 3-tier pipeline. Results are pushed back instantly once backend processing completes.
          </p>

          <form onSubmit={handleSubmit} className="form-group">
            <input
              type="text"
              className="text-input"
              placeholder="Enter your name..."
              value={name}
              onChange={handleInputChange}
              disabled={status === 'loading'}
              maxLength={30}
              required
            />
            <button
              type="submit"
              className="submit-btn"
              disabled={status === 'loading' || !name.trim()}
            >
              {status === 'loading' ? 'Processing Pipeline...' : 'Submit Request'}
            </button>
          </form>

          {/* 3-Tier Pipeline Visualizer */}
          <div className="pipeline-card">
            <div className="pipeline-title">3-Tier Execution Pipeline</div>
            <div className="pipeline-flow">
              {/* Node 1: Client */}
              <div className={`pipeline-node ${step === 'submitted' ? 'active' : (step === 'processing' || step === 'completed' || step === 'violation') ? 'success' : ''}`}>
                <div className="node-circle">💻</div>
                <div className="node-label">Client</div>
                <div className="node-subtext">
                  {step === 'submitted' ? 'Sending POST...' : (step === 'processing' || step === 'completed' || step === 'violation') ? 'POST Sent' : 'Ready'}
                </div>
              </div>

              {/* Connector 1 -> 2 */}
              <div className={`pipeline-connector ${step === 'submitted' ? 'active' : (step === 'processing' || step === 'completed' || step === 'violation') ? 'completed' : ''}`}>
                <div className="connector-line-active"></div>
              </div>

              {/* Node 2: Gateway */}
              <div className={`pipeline-node ${step === 'processing' ? 'active' : step === 'completed' ? 'success' : step === 'violation' ? 'error' : ''}`}>
                <div className="node-circle">🔀</div>
                <div className="node-label">Gateway</div>
                <div className="node-subtext">
                  {step === 'processing' ? 'ACK 202' : step === 'completed' ? 'SSE Broadcast' : step === 'violation' ? 'Bypassed (Violation)' : 'Idle'}
                </div>
              </div>

              {/* Connector 2 -> 3 */}
              <div className={`pipeline-connector ${step === 'processing' ? 'active' : step === 'completed' ? 'completed' : ''}`}>
                <div className="connector-line-active"></div>
              </div>

              {/* Node 3: Backend */}
              <div className={`pipeline-node ${step === 'processing' ? 'waiting' : step === 'completed' ? 'success' : ''}`}>
                <div className="node-circle">
                  {step === 'processing' ? `${secondsLeft}s` : '⚙️'}
                </div>
                <div className="node-label">Backend</div>
                <div className="node-subtext">
                  {step === 'processing' ? 'Processing...' : step === 'completed' ? 'Completed' : 'Idle'}
                </div>
              </div>
            </div>
          </div>

          <div className="status-container">
            {status === 'success' && (
              <div className="status-box success-box animate-fade-in">
                <span className="success-icon">✓</span>
                <p className="success-msg">{responseMsg}</p>
              </div>
            )}

            {status === 'error' && (
              <div className="status-box error-box animate-fade-in">
                <span className="error-icon">✕</span>
                <p className="error-msg">{responseMsg}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
