# Kubernetes Docker Deployment Guide

**Last Updated:** 2025-12-26
**Application:** NestJS + Bun Service Template
**Target Platform:** Kubernetes (Production)

---

## Table of Contents

- [Overview](#overview)
- [Building Docker Images](#building-docker-images)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Security Configuration](#security-configuration)
- [Health Checks & Probes](#health-checks--probes)
- [Resource Management](#resource-management)
- [Secrets Management](#secrets-management)
- [Monitoring & Observability](#monitoring--observability)
- [Security Scanning](#security-scanning)
- [Troubleshooting](#troubleshooting)

---

## Overview

This guide covers production-ready Kubernetes deployment for the NestJS + Bun application using the optimized multi-stage Dockerfile.

**Architecture:**
- **Runtime:** Bun 1.x
- **Framework:** NestJS with Clean Architecture + CQRS
- **Transports:** HTTP (Express), Kafka (Redpanda), gRPC
- **Dependencies:** PostgreSQL, MongoDB, Redis, Kafka

**Docker Image Features:**
- Multi-stage build (dependencies → build → production-deps → production)
- Non-root user execution (nonroot from DHI base image)
- Optimized layer caching for fast rebuilds
- Native Bun health checks (no curl dependency)
- Security hardening with --ignore-scripts flag

---

## Building Docker Images

### Prerequisites

- Docker 23.0+ with BuildKit enabled
- Multi-platform build support (optional): Docker Buildx

### Basic Build Commands

#### Local Development Build

```bash
# Build production image
docker build --target production -t service-template:latest .

# Build with BuildKit (faster builds)
DOCKER_BUILDKIT=1 docker build --target production -t service-template:latest .

# Build development image (includes dev dependencies)
docker build --target development -t service-template:dev .
```

#### Production Build with Versioning

```bash
# Build with version tags (semantic versioning + git SHA)
VERSION=$(cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[[:space:]]')
GIT_SHA=$(git rev-parse --short HEAD)

docker build \
  --target production \
  -t registry.example.com/service-template:${VERSION} \
  -t registry.example.com/service-template:${GIT_SHA} \
  -t registry.example.com/service-template:latest \
  .
```

### Multi-Platform Builds

Build for both AMD64 and ARM64 architectures:

```bash
# Create buildx builder (first time only)
docker buildx create --name multiplatform --use

# Build and push multi-platform image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --target production \
  -t registry.example.com/service-template:latest \
  --push \
  .
```

### Build Performance

**Expected Build Times:**

| Build Type | Time | Notes |
|------------|------|-------|
| First build (no cache) | 2-4 min | Full dependency installation + compilation |
| Cached rebuild (source change) | 10-30 sec | Only rebuild and production stages execute |
| Cached rebuild (no changes) | <10 sec | All stages cached |

**Image Size:**
- Production image: ~366MB (ARM64), ~350-400MB (AMD64)
- Development image: ~450-500MB

### Build Optimization Tips

1. **Layer Caching:** Package files (package.json, bun.lock) are copied before source code to maximize cache reuse
2. **Multi-Stage:** Build artifacts and dev dependencies excluded from final image
3. **BuildKit:** Enable for parallel stage execution and better caching

---

## Kubernetes Deployment

### Basic Deployment YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: service-template
  namespace: production
  labels:
    app: service-template
    version: v1
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: service-template
  template:
    metadata:
      labels:
        app: service-template
        version: v1
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      # Security Context (Pod-level)
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532  # nonroot user from DHI base image
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault

      # Image Pull Secrets (if using private registry)
      imagePullSecrets:
        - name: registry-credentials

      containers:
        - name: service-template
          image: registry.example.com/service-template:latest
          imagePullPolicy: IfNotPresent

          # Container Security Context
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: false  # Bun needs write access to /tmp
            capabilities:
              drop:
                - ALL

          # Ports
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP

          # Environment Variables (non-sensitive)
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3000"
            - name: LOG_LEVEL
              value: "info"

          # Secrets (from Kubernetes Secrets)
          envFrom:
            - secretRef:
                name: service-template-secrets

          # Resource Limits (see Resource Management section)
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1.5Gi"
              cpu: "1000m"

          # Liveness Probe
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
              scheme: HTTP
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 3
            failureThreshold: 3
            successThreshold: 1

          # Readiness Probe
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
              scheme: HTTP
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 2
            successThreshold: 1

          # Startup Probe (for slow-starting applications)
          startupProbe:
            httpGet:
              path: /health
              port: 3000
              scheme: HTTP
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 12  # 60 seconds total (12 * 5s)

      # Termination Grace Period (for graceful shutdown)
      terminationGracePeriodSeconds: 30

      # Pod Anti-Affinity (spread pods across nodes)
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: service-template
                topologyKey: kubernetes.io/hostname
```

### Service YAML

```yaml
apiVersion: v1
kind: Service
metadata:
  name: service-template
  namespace: production
  labels:
    app: service-template
spec:
  type: ClusterIP
  selector:
    app: service-template
  ports:
    - name: http
      port: 80
      targetPort: 3000
      protocol: TCP
  sessionAffinity: None
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: service-template
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: service-template
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
        - type: Pods
          value: 2
          periodSeconds: 30
      selectPolicy: Max
```

---

## Security Configuration

### Security Best Practices

#### 1. Non-Root User Execution

The Docker image runs as `nonroot` user (UID 65532, GID 65532) from the DHI base image.

**Kubernetes Security Context:**
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65532
  runAsGroup: 65532
  fsGroup: 65532
```

#### 2. Capability Restrictions

Drop all Linux capabilities to minimize attack surface:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

#### 3. Read-Only Root Filesystem

**Note:** Bun requires write access to `/tmp` for runtime operations.

```yaml
securityContext:
  readOnlyRootFilesystem: false  # Bun needs write access
```

If you need read-only root filesystem, mount a writable tmpfs volume:

```yaml
securityContext:
  readOnlyRootFilesystem: true

volumeMounts:
  - name: tmp
    mountPath: /tmp

volumes:
  - name: tmp
    emptyDir: {}
```

#### 4. Seccomp Profile

Use runtime default seccomp profile:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

#### 5. Prevent Privilege Escalation

```yaml
securityContext:
  allowPrivilegeEscalation: false
```

### Network Policies

Restrict network access using Kubernetes Network Policies:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: service-template-netpol
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: service-template
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3000
  egress:
    # Allow DNS
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53
    # Allow PostgreSQL
    - to:
        - podSelector:
            matchLabels:
              app: postgresql
      ports:
        - protocol: TCP
          port: 5432
    # Allow MongoDB
    - to:
        - podSelector:
            matchLabels:
              app: mongodb
      ports:
        - protocol: TCP
          port: 27017
    # Allow Redis
    - to:
        - podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379
    # Allow Kafka
    - to:
        - podSelector:
            matchLabels:
              app: kafka
      ports:
        - protocol: TCP
          port: 9092
```

---

## Health Checks & Probes

### Health Check Endpoint

**Endpoint:** `GET /health`

**Current Checks:**
- ✅ Application status (SimpleHealthIndicator)
- ✅ Redis connectivity

**Response Format:**
```json
{
  "status": "ok",
  "info": {
    "application": {
      "status": "up",
      "message": "Up and running"
    },
    "redis": {
      "status": "up"
    }
  },
  "error": {},
  "details": {
    "application": {
      "status": "up",
      "message": "Up and running"
    },
    "redis": {
      "status": "up"
    }
  }
}
```

### Kubernetes Probes Configuration

#### Liveness Probe

Checks if the application process is responsive. If it fails, Kubernetes restarts the container.

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
    scheme: HTTP
  initialDelaySeconds: 10  # Wait 10s after container start
  periodSeconds: 30        # Check every 30s
  timeoutSeconds: 3        # Timeout after 3s
  failureThreshold: 3      # Restart after 3 consecutive failures
  successThreshold: 1      # Consider healthy after 1 success
```

#### Readiness Probe

Checks if the application is ready to receive traffic. If it fails, Kubernetes removes the pod from service endpoints.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
    scheme: HTTP
  initialDelaySeconds: 5   # Wait 5s after container start
  periodSeconds: 10        # Check every 10s
  timeoutSeconds: 3        # Timeout after 3s
  failureThreshold: 2      # Mark unready after 2 consecutive failures
  successThreshold: 1      # Mark ready after 1 success
```

#### Startup Probe

Protects slow-starting containers from being killed by liveness probe.

```yaml
startupProbe:
  httpGet:
    path: /health
    port: 3000
    scheme: HTTP
  initialDelaySeconds: 0
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 12     # Allow up to 60s for startup (12 * 5s)
```

### Docker Health Check

The Dockerfile includes a native health check using Bun's fetch API:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" || exit 1
```

---

## Resource Management

### Bun Runtime Resource Considerations

**Important:** Research shows Bun can experience memory/CPU spikes in production environments (500MB → 1.2GB on Kubernetes).

### Recommended Resource Limits

#### Conservative (Recommended for Production Start)

```yaml
resources:
  requests:
    memory: "512Mi"   # Guaranteed memory
    cpu: "500m"       # Guaranteed CPU (0.5 cores)
  limits:
    memory: "1.5Gi"   # Maximum memory (allows headroom for spikes)
    cpu: "1000m"      # Maximum CPU (1 core)
```

**Rationale:**
- Requests ensure pod gets scheduled with sufficient resources
- Limits prevent resource exhaustion on node
- 1.5Gi memory limit provides headroom for Bun runtime spikes
- CPU limits prevent CPU throttling during normal operations

#### Aggressive (Resource-Constrained Environments)

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"
```

**Warning:** Monitor closely for OOMKilled events and CPU throttling.

### Monitoring Resource Usage

**Key Metrics to Monitor:**
- Memory usage (current, max, average)
- CPU usage and throttling
- OOMKilled events
- Pod restart count

**Prometheus Queries:**

```promql
# Memory usage by pod
container_memory_usage_bytes{pod=~"service-template.*"}

# CPU usage by pod
rate(container_cpu_usage_seconds_total{pod=~"service-template.*"}[5m])

# OOMKilled events
kube_pod_container_status_terminated_reason{reason="OOMKilled", pod=~"service-template.*"}
```

### Resource Adjustment Strategy

1. **Initial Deployment:** Start with conservative limits (512Mi/1.5Gi)
2. **Monitor:** Collect metrics for 1-2 weeks
3. **Analyze:** Identify peak usage patterns
4. **Adjust:** Set limits to peak usage + 20-30% headroom
5. **Test:** Validate under load testing

### Bun Runtime Fallback Strategy

If Bun exhibits stability issues in production:

**Fallback to Node.js:**

1. Update Dockerfile CMD:
   ```dockerfile
   # Change from:
   CMD ["bun", "run", "dist/main.js"]

   # To:
   CMD ["node", "dist/main.js"]
   ```

2. Rebuild and deploy image
3. No other code changes required (compiled JavaScript compatible with both runtimes)

---

## Secrets Management

### Security Requirements

**NEVER:**
- ❌ Hardcode secrets in Dockerfile
- ❌ Store secrets in environment variables in YAML files
- ❌ Commit secrets to version control
- ❌ Use ARG for secrets (exposed in image history)

### Kubernetes Secrets (Basic)

#### Create Secret

```bash
# From literal values
kubectl create secret generic service-template-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@host:5432/db' \
  --from-literal=MONGODB_URI='mongodb://user:pass@host:27017/db' \
  --from-literal=REDIS_URL='redis://host:6379' \
  --from-literal=KAFKA_BROKERS='kafka:9092' \
  --namespace=production

# From .env file
kubectl create secret generic service-template-secrets \
  --from-env-file=.env.production \
  --namespace=production
```

#### Use Secret in Deployment

**Environment Variables:**

```yaml
containers:
  - name: service-template
    envFrom:
      - secretRef:
          name: service-template-secrets
```

**Individual Environment Variables:**

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: service-template-secrets
        key: DATABASE_URL
```

### File-Based Secrets Mounting

Mount secrets as files for enhanced security:

```yaml
containers:
  - name: service-template
    volumeMounts:
      - name: secrets
        mountPath: /run/secrets
        readOnly: true

volumes:
  - name: secrets
    secret:
      secretName: service-template-secrets
      defaultMode: 0400  # Read-only for owner
```

**Application reads secrets from files:**

```typescript
import { readFileSync } from 'fs';

const databaseUrl = readFileSync('/run/secrets/DATABASE_URL', 'utf-8').trim();
```

### External Secrets Operator (Advanced)

Sync secrets from external secret management systems (Vault, AWS Secrets Manager, Azure Key Vault).

#### Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets \
  external-secrets/external-secrets \
  --namespace external-secrets-system \
  --create-namespace
```

#### Example: AWS Secrets Manager Integration

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets
  namespace: production
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: service-template-secrets
  namespace: production
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets
    kind: SecretStore
  target:
    name: service-template-secrets
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: production/service-template/database-url
    - secretKey: MONGODB_URI
      remoteRef:
        key: production/service-template/mongodb-uri
```

---

## Monitoring & Observability

### Prometheus Metrics

#### Pod Annotations

Add Prometheus scrape annotations to pod template:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
```

#### ServiceMonitor (Prometheus Operator)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: service-template
  namespace: production
  labels:
    app: service-template
spec:
  selector:
    matchLabels:
      app: service-template
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
      scrapeTimeout: 10s
```

### Logging

#### Structured Logging

The application uses custom logger service with structured JSON output.

**Log Format:**
```json
{
  "timestamp": "2025-12-26T10:30:00.000Z",
  "level": "info",
  "context": "NestApplication",
  "message": "Application started successfully",
  "correlationId": "abc-123",
  "metadata": {}
}
```

#### Log Aggregation

**Fluentd/Fluent Bit:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-config
  namespace: logging
data:
  parsers.conf: |
    [PARSER]
        Name   nestjs-json
        Format json
        Time_Key timestamp
        Time_Format %Y-%m-%dT%H:%M:%S.%LZ

  fluent-bit.conf: |
    [INPUT]
        Name              tail
        Path              /var/log/containers/service-template*.log
        Parser            docker
        Tag               kube.*
        Refresh_Interval  5

    [FILTER]
        Name                parser
        Match               kube.*
        Key_Name            log
        Parser              nestjs-json
        Reserve_Data        On

    [OUTPUT]
        Name  es
        Match kube.*
        Host  elasticsearch
        Port  9200
        Index service-template
```

### Distributed Tracing

**OpenTelemetry Integration:**

Add to Deployment:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector:4317"
  - name: OTEL_SERVICE_NAME
    value: "service-template"
  - name: OTEL_TRACES_SAMPLER
    value: "parentbased_traceidratio"
  - name: OTEL_TRACES_SAMPLER_ARG
    value: "0.1"  # 10% sampling
```

### Dashboards

**Grafana Dashboard Recommendations:**

1. **Application Metrics:**
   - Request rate, latency, error rate (RED metrics)
   - Health check status
   - Business metrics

2. **Infrastructure Metrics:**
   - CPU usage, memory usage
   - Pod count, restart count
   - Network I/O

3. **Dependency Metrics:**
   - Redis connection pool status
   - Database query performance
   - Kafka consumer lag

---

## Security Scanning

### Trivy Vulnerability Scanning

#### Installation

```bash
# macOS
brew install aquasecurity/trivy/trivy

# Linux
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee -a /etc/apt/sources.list.d/trivy.list
sudo apt-get update
sudo apt-get install trivy
```

#### Scan Docker Image

```bash
# Basic scan
trivy image service-template:latest

# Scan with severity threshold (fail on HIGH/CRITICAL)
trivy image --severity HIGH,CRITICAL --exit-code 1 service-template:latest

# Scan with detailed output
trivy image --format table --severity HIGH,CRITICAL service-template:latest

# Generate JSON report
trivy image --format json --output scan-results.json service-template:latest

# Generate SBOM (Software Bill of Materials)
trivy image --format spdx-json --output sbom.json service-template:latest
```

#### CI/CD Integration

**GitHub Actions:**

```yaml
name: Docker Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build --target production -t service-template:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: service-template:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'HIGH,CRITICAL'
          exit-code: '1'

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'
```

#### Continuous Scanning

Scan images regularly in container registry:

```bash
# Scan image from registry
trivy image registry.example.com/service-template:latest

# Automated daily scan (cronjob)
0 2 * * * trivy image --severity HIGH,CRITICAL \
  registry.example.com/service-template:latest \
  --format json --output /reports/trivy-scan-$(date +\%Y\%m\%d).json
```

### Admission Controllers

Use Kubernetes admission controllers to prevent vulnerable images from being deployed:

**OPA Gatekeeper Policy:**

```yaml
apiVersion: templates.gatekeeper.sh/v1beta1
kind: ConstraintTemplate
metadata:
  name: k8sblockimageswithvulnerabilities
spec:
  crd:
    spec:
      names:
        kind: K8sBlockImagesWithVulnerabilities
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sblockimageswithvulnerabilities

        violation[{"msg": msg}] {
          # Check if image has HIGH/CRITICAL vulnerabilities
          # Integrate with Trivy or other scanner
          input.review.object.spec.containers[_].image
          msg := "Image contains HIGH or CRITICAL vulnerabilities"
        }
```

---

## Troubleshooting

### Common Issues

#### 1. Container Fails to Start

**Symptoms:** Pod in CrashLoopBackOff state

**Diagnosis:**
```bash
# Check pod status
kubectl get pods -n production | grep service-template

# View pod events
kubectl describe pod <pod-name> -n production

# Check logs
kubectl logs <pod-name> -n production
kubectl logs <pod-name> -n production --previous  # Previous crash
```

**Common Causes:**
- Missing environment variables
- Database connection failures
- Port already in use
- Insufficient permissions

#### 2. Health Check Failures

**Symptoms:** Pod restarts frequently, marked as unhealthy

**Diagnosis:**
```bash
# Test health endpoint manually
kubectl exec -it <pod-name> -n production -- \
  bun -e "fetch('http://localhost:3000/health').then(r => r.json()).then(console.log)"

# Check health check configuration
kubectl get pod <pod-name> -n production -o yaml | grep -A 20 livenessProbe
```

**Common Causes:**
- Application not fully started (increase initialDelaySeconds)
- Dependencies (Redis/DB) unreachable
- Health check timeout too short
- Resource constraints causing slow responses

#### 3. OOMKilled (Out of Memory)

**Symptoms:** Pod terminates with reason "OOMKilled"

**Diagnosis:**
```bash
# Check OOMKilled events
kubectl get events -n production | grep OOMKilled

# View pod resource usage
kubectl top pod <pod-name> -n production

# Check resource limits
kubectl get pod <pod-name> -n production -o yaml | grep -A 10 resources
```

**Solutions:**
- Increase memory limits (see [Resource Management](#resource-management))
- Monitor Bun runtime memory usage
- Consider fallback to Node.js if persistent

#### 4. Image Pull Failures

**Symptoms:** Pod stuck in ImagePullBackOff or ErrImagePull

**Diagnosis:**
```bash
# Check pod events
kubectl describe pod <pod-name> -n production | grep -A 10 Events

# Verify image exists
docker pull registry.example.com/service-template:latest

# Check image pull secrets
kubectl get secrets -n production | grep registry
```

**Solutions:**
- Verify image name and tag correct
- Check registry credentials (imagePullSecrets)
- Ensure network connectivity to registry
- Verify image architecture matches node (AMD64/ARM64)

#### 5. Network Connectivity Issues

**Symptoms:** Cannot connect to dependencies (Redis, PostgreSQL, etc.)

**Diagnosis:**
```bash
# Test DNS resolution
kubectl exec -it <pod-name> -n production -- nslookup redis

# Test network connectivity
kubectl exec -it <pod-name> -n production -- \
  bun -e "fetch('http://redis:6379').catch(e => console.log(e))"

# Check network policies
kubectl get networkpolicies -n production
```

**Solutions:**
- Verify service names and DNS resolution
- Check network policies allow traffic
- Verify firewall rules
- Check environment variables for connection strings

### Debug Mode

Enable debug logging for troubleshooting:

```yaml
env:
  - name: LOG_LEVEL
    value: "debug"
  - name: DEBUG
    value: "*"
```

### Interactive Debugging

```bash
# Get shell access to running container
kubectl exec -it <pod-name> -n production -- /bin/sh

# Run commands inside container
whoami                    # Check user (should be nonroot)
env | grep DATABASE      # Check environment variables
ls -la /usr/src/app     # Check file permissions
```

### Resource Metrics

```bash
# View resource usage
kubectl top pods -n production

# View node resource usage
kubectl top nodes

# Detailed pod metrics
kubectl describe pod <pod-name> -n production | grep -A 20 "Resource Requests"
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Build and test Docker image locally
- [ ] Run Trivy security scan (no HIGH/CRITICAL vulnerabilities)
- [ ] Verify image size acceptable (~366MB)
- [ ] Test health check endpoint responds correctly
- [ ] Verify non-root user execution (`whoami` returns `nonroot`)
- [ ] Review and update resource limits based on testing
- [ ] Prepare Kubernetes secrets (database credentials, API keys)
- [ ] Configure monitoring and alerting
- [ ] Test database migrations (if applicable)

### Deployment

- [ ] Create namespace (if new environment)
- [ ] Apply secrets to cluster
- [ ] Deploy infrastructure dependencies (PostgreSQL, Redis, etc.)
- [ ] Apply deployment manifest
- [ ] Apply service manifest
- [ ] Apply HPA manifest
- [ ] Verify pods running and healthy
- [ ] Test health check endpoint from within cluster
- [ ] Test application endpoints (smoke tests)
- [ ] Verify metrics collection (Prometheus)
- [ ] Verify log aggregation (Elasticsearch/Loki)

### Post-Deployment

- [ ] Monitor resource usage for first 24-48 hours
- [ ] Check for OOMKilled events
- [ ] Monitor health check failures
- [ ] Review application logs for errors
- [ ] Verify autoscaling behavior under load
- [ ] Test rolling update process
- [ ] Document any issues or adjustments made
- [ ] Update runbooks with troubleshooting steps

---

## Additional Resources

### Documentation

- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Bun Documentation](https://bun.sh/docs)
- [NestJS Terminus Health Checks](https://docs.nestjs.com/recipes/terminus)

### Tools

- [Trivy Security Scanner](https://github.com/aquasecurity/trivy)
- [Docker Buildx](https://docs.docker.com/buildx/working-with-buildx/)
- [Kubernetes Dashboard](https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/)
- [Prometheus Operator](https://github.com/prometheus-operator/prometheus-operator)

### Support

For issues or questions:
1. Check application logs: `kubectl logs <pod-name> -n production`
2. Review this troubleshooting guide
3. Contact DevOps team
4. Create incident ticket

---

**End of Document**
