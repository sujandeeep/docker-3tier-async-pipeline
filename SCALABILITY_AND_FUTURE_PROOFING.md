# Scalability and Future-Proofing Technical Evaluation

This document outlines the performance limitations of the proof-of-concept (POC) design and defines an enterprise-grade migration path to support high-throughput, horizontally scalable processing.

---

## 1. Gateway AI Inference Evaluation: Local Hosting vs. Dedicated Containerization

In the current POC architecture, the Hugging Face Toxic-BERT model runs directly inside the Node.js API Gateway container using the ONNX Runtime (`@xenova/transformers`). 

### Performance and Reliability Drawbacks of Gateway-Embedded Inference:
- **Event Loop Blockage**: Node.js operates on a single-threaded event loop. While ONNX runtime executes native WASM or C++ bindings under the hood, the serialization/deserialization of input tensors and CPU-intensive tokenization steps run on the main execution thread. Heavy inference requests can block incoming HTTP connections, leading to latency spikes across the entire API gateway.
- **Resource Contention**: Deep learning models have significant memory and CPU footprints. Bundling inference inside the gateway couples routing capacity (which requires minimal CPU/high I/O) with machine learning compute requirements (which require high CPU/GPU).
- **Scale Mismatch**: API Gateways must scale horizontally to handle millions of lightweight I/O requests. ML models scale based on token length and model parameters. Scaling the gateway just to handle ML load is highly resource-inefficient.

### Recommended Enterprise Target Topology:
Isolate the machine learning model into a dedicated inference container running an optimized serving framework such as **Triton Inference Server** or **TorchServe**.

```
                           ┌──────────────────────────┐
                           │      API Gateway         │
                           └─────────────┬────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │ (Internal gRPC / REST Request)            │
                   ▼                                           ▼
      ┌──────────────────────────┐                ┌──────────────────────────┐
      │   Triton ML Container 1  │                │   Triton ML Container 2  │
      │   [Running Toxic-BERT]   │                │   [Running Toxic-BERT]   │
      └──────────────────────────┘                └──────────────────────────┘
```

- **gRPC Routing**: The Gateway forwards incoming text inputs to Triton over high-speed gRPC channels.
- **Decoupled Autoscaling**: The ML tier and Gateway tier scale independently using Kubernetes Horizontal Pod Autoscalers (HPA) based on CPU/GPU metrics.

---

## 2. Horizontal Scaling via Message Broker Integration

To scale background processes without risking message loss or gateway memory exhaustion under load spikes, a persistent messaging tier must be introduced. 

### Transition Architecture (RabbitMQ / Apache Kafka)
By introducing a message broker, the API gateway immediately queues validated payloads and offloads them from its memory space. Decoupled worker processes consume these messages at their own pace.

```
                  ┌─────────────────────────────────┐
                  │          API Gateway            │
                  └────────┬────────────────────────┘
                           │
                           │ Publish (Clean Job Request)
                           ▼
                  ┌─────────────────────────────────┐
                  │ Message Queue (RabbitMQ Exchange)│
                  └────────┬────────────────────────┘
                           │
                           ├────────────────────────┐
                           ▼                        ▼
              ┌────────────────────────┐┌────────────────────────┐
              │    Worker Service 1    ││    Worker Service 2    │
              │   [Consumes Queue]     ││   [Consumes Queue]     │
              └────────────┬───────────┘└───────────┬────────────┘
                           │                        │
                           └───────────┬────────────┘
                                       │
                                       │ HTTP POST callback
                                       ▼
                  ┌─────────────────────────────────┐
                  │        Gateway Webhook          │
                  └─────────────────────────────────┘
```

### Architectural Benefits:
- **Durability**: Messages are persisted to disk in the broker queue, protecting transactions against worker service crashes.
- **Backpressure Handling**: Workers pull messages from the queue only when they have capacity, preventing the backend service from being overwhelmed.
- **Decoupled Codebase**: Changes to processing algorithms or timeouts can be deployed directly to the worker microservices without impacting gateway availability.

---

## 3. Scaling the SSE Gateway Tier

Because Server-Sent Events (SSE) rely on stateful TCP connections held open by specific server instances, scaling the gateway tier across a cluster of servers requires specialized network strategies:

### A. Session Persistence (Sticky Sessions)
Standard load balancers (e.g., NGINX, HAProxy, AWS ALB) distribute connections randomly or via round-robin. To ensure a client's job submission and subsequent SSE notifications target the same gateway container holding their connection state, you must configure **Session Affinity (Sticky Sessions)** using cookies or client IP hashes.

### B. Redis Pub/Sub Event Broadcasting
When the gateway scales horizontally across multiple servers, a background worker might send its callback webhook to `Gateway Instance B`, while the target client's SSE socket is held open by `Gateway Instance A`. 

To resolve this routing mismatch, introduce a shared **Redis Pub/Sub** instance:
1. **Subscription**: Each Gateway instance subscribes to a global Redis channel (e.g., `job-notifications`).
2. **Callback Dispatch**: When any Gateway instance receives a callback from a worker, it publishes the event payload to the Redis channel.
3. **Broadcasting**: All Gateway instances receive the event from Redis. The instance holding the target client's active SSE socket pushes the event down to the client, while other instances safely discard it.
