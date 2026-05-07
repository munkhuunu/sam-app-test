#!/usr/bin/env bash
# alarm-test.sh — trigger Lambda errors & CloudWatch alarms to test canary rollback
#
# Two modes:
#   --mode api-errors   : send malformed requests to cause Lambda errors (real traffic)
#   --mode set-alarm    : use aws cloudwatch set-alarm-state to instantly flip an alarm
#                         (safe, reversible — does NOT affect live traffic)
#
# Usage:
#   ./scripts/alarm-test.sh --mode set-alarm   [--alarm-name sam-app-test-Auth-Errors] [--region ap-northeast-1]
#   ./scripts/alarm-test.sh --mode api-errors  --api-url https://xxx.execute-api.../Prod

set -euo pipefail

# ── args ─────────────────────────────────────────────────────────────────────
MODE="set-alarm"
ALARM_NAME="sam-app-test-System-Health"
REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"
API_URL=""
ERROR_COUNT=5

while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)        MODE="$2";        shift 2 ;;
    --alarm-name)  ALARM_NAME="$2"; shift 2 ;;
    --region)      REGION="$2";     shift 2 ;;
    --api-url)     API_URL="$2";    shift 2 ;;
    --error-count) ERROR_COUNT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── mode: set-alarm ──────────────────────────────────────────────────────────
if [[ "$MODE" == "set-alarm" ]]; then
  echo "====================================================="
  echo " Mode: set-alarm (manual alarm state override)"
  echo " Alarm: $ALARM_NAME"
  echo "====================================================="
  echo
  echo "[1/3] Forcing alarm into ALARM state..."
  aws cloudwatch set-alarm-state \
    --alarm-name "$ALARM_NAME" \
    --state-value ALARM \
    --state-reason "Manual test via alarm-test.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --region "$REGION"
  echo "  => ALARM state set"

  echo
  echo "[2/3] Waiting 10 seconds so CodeDeploy canary sees the alarm..."
  sleep 10

  echo
  echo "[3/3] Checking canary deployments in CodeDeploy (if active)..."
  aws deploy list-deployments \
    --query 'deployments' \
    --output table \
    --region "$REGION" 2>/dev/null || echo "  (no active deployments or no CodeDeploy access)"

  echo
  echo "To restore alarm to OK state:"
  echo "  aws cloudwatch set-alarm-state --alarm-name '$ALARM_NAME' --state-value OK \\"
  echo "    --state-reason 'Test complete' --region $REGION"

# ── mode: api-errors ─────────────────────────────────────────────────────────
elif [[ "$MODE" == "api-errors" ]]; then
  if [[ -z "$API_URL" ]]; then
    API_URL=$(aws cloudformation describe-stacks \
      --stack-name sam-app-test \
      --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
      --output text 2>/dev/null || true)
  fi
  if [[ -z "$API_URL" ]]; then
    echo "ERROR: --api-url required for api-errors mode"; exit 1
  fi
  API_URL="${API_URL%/}"

  echo "====================================================="
  echo " Mode: api-errors"
  echo " API : $API_URL"
  echo " Sending $ERROR_COUNT malformed requests to trigger Lambda errors"
  echo "====================================================="
  echo

  # Payloads designed to bypass validation and reach Lambda error paths
  PAYLOADS=(
    '{"__test":"trigger_error","malformed":true}'
    '{"email":null,"password":null}'
    '{"$invalid":"<<injected>>"}'
    'not-json-at-all'
    '{"deeply":{"nested":{"object":{"that":{"will":{"fail":{"schema":true}}}}}}}'
  )
  N_P=${#PAYLOADS[@]}

  echo "Firing $ERROR_COUNT requests..."
  ALARM_FIRED=false
  for i in $(seq 1 "$ERROR_COUNT"); do
    PAYLOAD="${PAYLOADS[$((i % N_P))]}"
    # hit auth with garbage JWT + malformed body — guaranteed Lambda execution
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H 'Content-Type: application/json' \
      -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.INVALID_SIG' \
      -d "$PAYLOAD" \
      "$API_URL/auth/login")
    echo "  [$i/$ERROR_COUNT] POST /auth/login → HTTP $STATUS"
    sleep 0.2
  done

  echo
  echo "Requests sent. Lambda may log errors depending on handler behaviour."
  echo "Check CloudWatch Logs for exceptions:"
  echo "  aws logs tail /aws/lambda/sam-app-test-AuthFunction --follow --region $REGION"
  echo
  echo "Or use --mode set-alarm to force-flip an alarm immediately for canary rollback testing."

else
  echo "ERROR: --mode must be 'set-alarm' or 'api-errors'"
  exit 1
fi

echo
echo "Done."
