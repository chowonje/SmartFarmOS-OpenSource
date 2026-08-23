#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

required_files=(
  "AGENTS.md"
  "README.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "SUPPORT.md"
  "CODE_OF_CONDUCT.md"
  "package.json"
  "package-lock.json"
  "tsconfig.base.json"
  ".nvmrc"
  ".env.example"
  ".gitignore"
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/dependabot.yml"
  ".github/ISSUE_TEMPLATE/bug_report.yml"
  ".github/ISSUE_TEMPLATE/feature_request.yml"
  ".github/ISSUE_TEMPLATE/config.yml"
  ".github/workflows/ci.yml"
  "docs/README.md"
  "docs/getting-started.md"
  "docs/architecture.md"
  "docs/baseline.md"
  "docs/credential-rotation.md"
  "docs/external-services.md"
  "docs/feature-parity.md"
  "docs/usability/field-test-protocol.md"
  "docs/usability/facilitator-quickstart.md"
  "docs/usability/session-template.md"
  "docs/usability/session-result.example.json"
  "docs/submission/README.md"
  "docs/submission/non-human-readiness.md"
  "docs/submission/official-requirements.md"
  "docs/submission/release-checklist.md"
  "docs/submission/result-report.md"
  "docs/submission/demo-rehearsal.md"
  "docs/submission/presentation-outline.md"
  "docs/submission/ai-use-disclosure.md"
  "docs/submission/video-proof.example.json"
  "docs/provenance.md"
  "docs/deployment/cloud-pilot.md"
  "docs/deployment/cloud-pilot-checklist.md"
  "docs/deployment/weather-provider.md"
  "docs/deployment/raspberry-pi-edge.md"
  "docs/testing/field-test-checklist.md"
  "docs/decisions/0001-integration-repository-strategy.md"
  "docs/decisions/0002-runtime-contract-validation.md"
  "docs/decisions/0003-central-api-boundary.md"
  "docs/decisions/0004-edge-http-gateway.md"
  "docs/decisions/0005-sqlite-persistence.md"
  "docs/decisions/0006-local-demo-pwa.md"
  "docs/decisions/0007-full-user-pwa-parity.md"
  "docs/decisions/0008-catalog-and-crop-persistence.md"
  "docs/decisions/0009-open-platform-module-kernel.md"
  "docs/decisions/0010-device-local-timed-irrigation.md"
  "docs/decisions/0011-durable-edge-ack-outbox.md"
  "docs/decisions/0012-device-local-manual-stop-priority.md"
  "docs/decisions/0013-unscoped-direct-command-audit.md"
  "docs/decisions/0014-edge-device-credential-binding.md"
  "docs/decisions/0015-data-only-farm-control-personalization.md"
  "docs/contracts/v1.md"
  "docs/contracts/http-v1.md"
  "docs/contracts/legacy-parity-map.md"
  "docs/contracts/module-manifest-v1.md"
  "packages/contracts/package.json"
  "packages/contracts/src/alarm.ts"
  "packages/contracts/src/irrigation.ts"
  "packages/contracts/src/irrigation.test.ts"
  "packages/contracts/src/weather.ts"
  "packages/contracts/src/weather.test.ts"
  "packages/contracts/src/farm-control.ts"
  "packages/contracts/src/farm-control.test.ts"
  "packages/contracts/src/gateway-auth.ts"
  "packages/contracts/src/gateway-auth.test.ts"
  "packages/contracts/src/index.ts"
  "packages/module-sdk/package.json"
  "packages/module-sdk/src/index.ts"
  "packages/module-sdk/src/builtins.ts"
  "tools/device-simulator/package.json"
  "tools/device-simulator/src/simulator.ts"
  "scripts/verify-simulator-output.mjs"
  "scripts/verify-api-roundtrip.mjs"
  "scripts/verify-edge-roundtrip.mjs"
  "scripts/verify-persistence-roundtrip.mjs"
  "scripts/verify-pwa-build.mjs"
  "scripts/verify-pwa-browser.mjs"
  "scripts/run-usability-session.mjs"
  "scripts/record-usability-result.mjs"
  "scripts/record-usability-result.test.mjs"
  "scripts/summarize-usability-results.mjs"
  "scripts/summarize-usability-results.test.mjs"
  "scripts/verify-dependency-licenses.mjs"
  "scripts/verify-dependency-licenses.test.mjs"
  "scripts/verify-github-actions-pins.mjs"
  "scripts/verify-github-actions-pins.test.mjs"
  "scripts/create-demo-video.mjs"
  "scripts/create-demo-video.test.mjs"
  "scripts/create-video-proof.mjs"
  "scripts/create-video-proof.test.mjs"
  "scripts/rehearse-submission.mjs"
  "scripts/rehearse-submission.test.mjs"
  "scripts/run-cloud-pilot-compose.mjs"
  "scripts/run-cloud-pilot-compose.test.mjs"
  "scripts/verify-cloud-pilot-package.mjs"
  "scripts/verify-cloud-pilot-package.test.mjs"
  "deploy/cloud-pilot/.env.example"
  "deploy/cloud-pilot/Caddyfile"
  "deploy/cloud-pilot/Dockerfile"
  "deploy/cloud-pilot/Dockerfile.dockerignore"
  "deploy/cloud-pilot/docker-compose.yml"
  "deploy/cloud-pilot/entrypoint.sh"
  "services/api/package.json"
  "services/api/src/app.ts"
  "services/api/src/auth.ts"
  "services/api/src/alarm-center.ts"
  "services/api/src/command-audit.ts"
  "services/api/src/http-boundary.ts"
  "services/api/src/gateway-auth.ts"
  "services/api/src/gateway-auth.test.ts"
  "services/api/src/irrigation-center.ts"
  "services/api/src/openweather-provider.ts"
  "services/api/src/weather-provider.ts"
  "services/api/src/modules/alarm-center-server.ts"
  "services/api/src/modules/admin-gateway-enrollment-server.ts"
  "services/api/src/modules/admin-gateway-enrollment-server.test.ts"
  "services/api/src/modules/crop-operations-server.ts"
  "services/api/src/modules/weather-location-server.ts"
  "services/api/src/modules/weather-location-server.test.ts"
  "services/api/src/server-module-registry.ts"
  "services/api/src/store.ts"
  "services/api/src/sqlite-store.ts"
  "services/edge/package.json"
  "services/edge/src/api-client.ts"
  "services/edge/src/agent-config.ts"
  "services/edge/src/agent-runtime.ts"
  "services/edge/src/cli.ts"
  "services/edge/src/credential-store.ts"
  "services/edge/src/enrollment-client.ts"
  "services/edge/src/execution-repository.ts"
  "services/edge/src/gateway.ts"
  "services/edge/src/system-account.ts"
  "deploy/edge/config.example.json"
  "deploy/edge/smartfarm-edge.service.example"
  "tools/local-demo/package.json"
  "tools/local-demo/src/runtime.ts"
  "apps/pwa/package.json"
  "apps/pwa/src/App.tsx"
  "apps/pwa/src/admin-console.ts"
  "apps/pwa/src/api/smart-farm-api.ts"
  "apps/pwa/src/components/alarm-center-view.tsx"
  "apps/pwa/src/components/page-state.ts"
  "apps/pwa/src/components/settings-page.tsx"
  "apps/pwa/src/components/crop-operations-view.tsx"
  "apps/pwa/src/components/crop-operations-view.test.tsx"
  "apps/pwa/src/components/weather-shell-view.tsx"
  "apps/pwa/src/components/weather-shell-view.test.tsx"
  "apps/pwa/src/modules/web-module-registry.tsx"
  "apps/pwa/vitest.config.ts"
  "apps/pwa/public/manifest.webmanifest"
  "apps/pwa/scripts/generate-service-worker.mjs"
  "apps/admin/package.json"
  "apps/admin/src/App.tsx"
  "apps/admin/src/api/admin-gateway-api.ts"
  "apps/admin/src/components/gateway-admin-page.tsx"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required project file: $file" >&2
    exit 1
  fi
done

node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))'
node scripts/run-usability-session.mjs --help >/dev/null
node scripts/record-usability-result.mjs --help >/dev/null
node scripts/summarize-usability-results.mjs --help >/dev/null
node scripts/verify-dependency-licenses.mjs --help >/dev/null
node scripts/verify-dependency-licenses.mjs >/dev/null
node scripts/verify-github-actions-pins.mjs >/dev/null
node scripts/verify-cloud-pilot-package.mjs >/dev/null
node scripts/create-demo-video.mjs --help >/dev/null
node scripts/create-video-proof.mjs --help >/dev/null
node scripts/rehearse-submission.mjs --help >/dev/null
node --test scripts/record-usability-result.test.mjs scripts/summarize-usability-results.test.mjs scripts/verify-dependency-licenses.test.mjs scripts/verify-github-actions-pins.test.mjs scripts/create-demo-video.test.mjs scripts/create-video-proof.test.mjs scripts/rehearse-submission.test.mjs scripts/run-cloud-pilot-compose.test.mjs scripts/verify-cloud-pilot-package.test.mjs

duplicate_sources="$(
  find apps packages services tools \
    -path '*/node_modules' -prune -o \
    -path '*/dist' -prune -o \
    -type f \
    \( -name '* [0-9].ts' -o -name '* [0-9].tsx' -o -name '* [0-9].js' \) \
    -print
)"

if [[ -n "$duplicate_sources" ]]; then
  echo "Number-suffixed duplicate source files are not allowed in runtime trees:" >&2
  printf '%s\n' "$duplicate_sources" | sed 's/^/  /' >&2
  exit 1
fi

forbidden_paths="$(
  find . \
    -path './.git' -prune -o \
    -path './node_modules' -prune -o \
    -type f \
    \( -name '.env' -o -name '.env.local' -o -name 'serviceAccountKey.json' -o -name '*.pem' -o -name '*.key' \) \
    -print
)"

if [[ -n "$forbidden_paths" ]]; then
  echo "Forbidden local credential files are present:" >&2
  printf '%s\n' "$forbidden_paths" | sed 's/^/  /' >&2
  exit 1
fi

if rg -l --hidden \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!package-lock.json' \
  -- '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----' . >/dev/null; then
  echo "Private-key material was detected in the canonical repository." >&2
  exit 1
fi

npm run build
npm run typecheck
npm run test:workspaces
npm run smoke:simulator
npm run smoke:api
npm run smoke:edge
npm run smoke:persistence
npm run smoke:pwa
npm run smoke:pwa:browser

echo "SmartFarmOS structure, credential-path, build, typecheck, test, simulator, central API, Edge HTTP, SQLite persistence, local demo, PWA bundle, and available browser checks passed."
echo "Exact farm/device Edge credential binding, durable command-result/ACK recovery, simulator software-stop priority, and opt-in unscoped direct-command audit passed; telemetry buffering, ambiguous mid-execution device reconciliation, multi-gateway leases, MQTT, physical emergency-stop/interlocks/closed-loop safety, production identity, realtime delivery, production database scale, and physical-hardware checks remain pending."
