# Toxic-BERT Integration Project

An enterprise-ready proof-of-concept demonstrating a 3-tier containerized pipeline with Server-Sent Events (SSE) push notifications, out-of-band callback webhooks, and local edge-moderation using Toxic-BERT (compiled to ONNX format).

---

## 1. Architectural Overview

This system utilizes a non-blocking push model. Clients submit jobs to an API Gateway, which immediately returns an HTTP 202 acknowledgment. The gateway routes tasks and streams notifications to the client over an established SSE channel, executing an instant bypass if content violations are discovered.

### System Routing Model (ASCII)

```text
+-------------------------------------------------------------------------------------------------------+
|                                         DOCKER BRIDGE NETWORK                                         |
|                                                                                                       |
|  [frontend]                         [middleware-gateway]                           [backend-service]  |
|  (Port 3000)                            (Port 3001)                                   (Port 3002)     |
+------+------+                           +----+-----+                                  +-------+-------+
       |                                       |                                                |
       | ----- 1. GET /stream (Handshake) ---> |                                                |
       | <---- 2. HTTP 200 Stream Live ACK --- |                                                |
       |                                       |                                                |
       | ----- 3. POST /api/v1/jobs ---------> | [ Runs Toxic-BERT Check ]                      |
       |                                       |                                                |
       |                                       |-- IF TOXIC:                                    |
       | <---- 4a. HTTP 202 (Request ACK) -----|  * Abort Backend Routing                       |
       | <---- 4b. SSE Push: "Offensive Speech"|  * Instant Channel Push                        |
       |                                       |                                                |
       |                                       |-- IF CLEAN:                                    |
       | <---- 5a. HTTP 202 (Request ACK) -----|  * 4c. Forward Job --------------------------> | [ Enters 5s Delay ]
       |                                       |                                                | [ setTimeout Loop ]
       |                                       |                                                |
       |                                       |                                                | *5 Seconds Pass*
       |                                       | <--- 6. HTTP Webhook Callback (Job Completed) -|
       | <---- 7. SSE Push (Render Result) ----|                                                |
```

---

## 2. Prerequisites

To execute and run the microservices architecture, ensure the following tools are installed:
- **Docker**: Version 20.10+
- **Docker Compose**: Version 2.0+
- **Node.js** (Optional, for local non-containerized execution): Version 18.0+

---

## 3. Quick-Start Orchestration

The services are fully containerized and orchestrated via Docker Compose.

### Starting the Pipeline
To build, configure, and boot the entire 3-tier system in the background, execute:
```bash
docker-compose up --build -d
```

### Monitoring Live Streams
You can stream logs dynamically from the API Gateway (Middleware) to view pipeline flow notifications:
```bash
docker-compose logs -f middleware-gateway
```

### Stopping the System
To spin down the network interface and remove the active containers, run:
```bash
docker-compose down
```

---

## 4. System Endpoints & Routing Interface

### I. Middleware API Gateway (Port 3001)

| Endpoint | Method | Protocol | Description |
| :--- | :--- | :--- | :--- |
| `/stream` | `GET` | SSE (HTTP) | Establishes persistent unidirectional connection. Requires query parameter `?clientId=xyz`. |
| `/api/v1/jobs` | `POST` | HTTP | Submits job for classification and processing. Payload: `{"name": "string", "clientId": "string"}`. |
| `/internal/callback`| `POST` | HTTP | Inward webhook callback endpoint used by the Backend Service to resolve clean inputs. |
| `/admin/logs` | `GET` | HTTP | Restricted admin web log dashboard protected by Basic HTTP Authentication. |

### II. Isolated Backend Service (Port 3002)

| Endpoint | Method | Protocol | Description |
| :--- | :--- | :--- | :--- |
| `/internal/process` | `POST` | HTTP | Internal endpoint to receive sanitized job payloads from the Middleware Gateway. |
| `/internal/logs` | `GET` | HTTP | Admin-only route querying raw logs directly from the backend system. |
