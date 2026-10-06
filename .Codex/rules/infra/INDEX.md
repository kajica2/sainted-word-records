---
description: "Infra Rules"
paths: ["Dockerfile*", "docker-compose*", ".dockerignore", ".claude/agents/**", ".claude/rules/**", "**/*.tf", "k8s/**", ".github/workflows/**", "infra/**"]
---

# Infra Rules

## Files

- `docker.md` — Dockerfile best practices, multi-stage builds, layer caching, non-root user, .dockerignore, health checks
- `ci-cd.md` — CI/CD pipeline conventions, GitHub Actions workflow structure, test/lint/build gates, secret handling in CI
- `kubernetes.md` — Workloads (Deployment/StatefulSet/Job), resource requests/limits, readiness/liveness probes, ConfigMaps, Secrets, security context, labels
- `terraform.md` — Module structure, state backend, variable naming, provider pinning, plan/apply workflow, sensitive variable handling

## Triggers

Inject these rules when working on: Docker, CI/CD, Kubernetes, Terraform, `infra/**`,
`Dockerfile`, `.github/workflows/**`, `k8s/**`, `*.tf`, `docker-compose.yml`,
Helm, Kustomize, EKS, GKE, resource limits, probes, secrets management,
streaming workload, no-sticky, SSE ingress timeout, preStop drain,
HPA on active connections.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../security/` (security checklist for infrastructure hardening)
