#!/usr/bin/env bash
# alarm-test.sh — trigger Lambda errors & CloudWatch alarms to test canary rollback
#
# Two modes:
#   --mode api-errors  : send requests guaranteed to throw unhandled exceptions
#                        (oversized body, JSON parse crash, missing required fields)
#   --mode set-alarm   : use aws cloudwatch set-alarm-state to instantly flip an alarm
#                        (safe, reversible — does NOT affect live traffic)
#
# Usage:
#   ./scripts/alarm-test.sh --mode set-alarm  [--alarm-name sam-app-test-Auth-Errors] [--region ap-northeast-1]
#   ./scripts/alarm-test.sh --mode api-errors --api-url https://xxx.execute-api.../Prod [--error-count 10]

set -euo pipefail

# ── args ──────────────────────────────────────────────────────────────────────
MODE="set-alarm"
ALARM_NAME="sam-app-test-System-Health"
REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"
API_URL="https://1lc7o3pgg0.execute-api.ap-northeast-1.amazonaws.com/Prod"
ERROR_COUNT=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)        MODE="$2";         shift 2 ;;
    --alarm-name)  ALARM_NAME="$2";   shift 2 ;;
    --region)      REGION="$2";       shift 2 ;;
    --api-url)     API_URL="$2";      shift 2 ;;
    --error-count) ERROR_COUNT="$2";  shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ═════════════════════════════════════════════════════════════════════════════
# MODE: set-alarm  — instant, reversible alarm flip (best for canary testing)
# ═════════════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "set-alarm" ]]; then
  echo "====================================================="
  echo " Mode: set-alarm"
  echo " Alarm: $ALARM_NAME"
  echo " Region: $REGION"
  echo "====================================================="
  echo

  echo "[1/3] Forcing alarm → ALARM state..."
  aws cloudwatch set-alarm-state \
    --alarm-name "$ALARM_NAME" \
    --state-value ALARM \
    --state-reason "Manual test via alarm-test.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --region "$REGION"
  echo "  => Done. SNS email should arrive within ~1 minute."

  echo
  echo "[2/3] Waiting 15s for CodeDeploy canary to detect the alarm..."
  sleep 15

  echo
  echo "[3/3] Checking active CodeDeploy deployments..."
  aws deploy list-deployments \
    --query 'deployments' \
    --output table \
    --region "$REGION" 2>/dev/null || echo "  (no active deployments or insufficient IAM access)"

  echo
  echo "Restore alarm to OK when done:"
  echo "  aws cloudwatch set-alarm-state \\"
  echo "    --alarm-name '$ALARM_NAME' \\"
  echo "    --state-value OK \\"
  echo "    --state-reason 'Test complete' \\"
  echo "    --region $REGION"

# ═════════════════════════════════════════════════════════════════════════════
# MODE: api-errors  — real traffic designed to cause unhandled Lambda exceptions
# ═════════════════════════════════════════════════════════════════════════════
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
  echo " Mode: api-errors (real Lambda error traffic)"
  echo " API : $API_URL"
  echo " Count: $ERROR_COUNT"
  echo "====================================================="
  echo
  echo "Strategy: requests that bypass 400-level validation and reach"
  echo "  unhandled code paths, causing real Lambda Errors metric to increment."
  echo

  # ── error strategy breakdown ────────────────────────────────────────────
  # 1. Valid JWT signature but payload claims non-existent userId
  #    → authenticate() fetches from DynamoDB → Item is null → throws TypeError
  FAKE_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJub25leGlzdGVudC11c2VyLTAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMCIsInJvbGUiOiJTVVBFUl9BRE1JTiIsInNjaG9vbElkIjpudWxsLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6OTk5OTk5OTk5OX0.BADSIG"

  # 2. Oversized body — API Gateway passes it through, JSON.parse may throw
  BIG_BODY=$(python3 -c "import json; print(json.dumps({'x': 'A'*8000}))" 2>/dev/null || \
             node -e "console.log(JSON.stringify({x:'A'.repeat(8000)}))" 2>/dev/null || \
             printf '{"x":"%0.s' {1..100} && printf 'end"}')

  # 3. Body that is valid JSON but contains null prototype poisoning keys
  POISON_BODY='{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}'

  # 4. Content-Type mismatch — body is binary, handler calls JSON.parse → throws SyntaxError
  # 5. Extremely deep nesting — JSON.parse stack overflow on some runtimes
  DEEP_BODY='{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"x":1}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}'

  ENDPOINTS_TO_HIT=(
    "POST /auth/login"
    "POST /auth/register"
    "GET  /schools"
    "GET  /dashboard"
    "POST /schools"
  )

  fire_error() {
    local method=$1
    local path=$2
    local body=$3
    local extra_headers=${4:-}
    local status
    status=$(curl -s -o /tmp/alarm_resp.txt -w "%{http_code}" \
      -X "$method" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $FAKE_JWT" \
      ${extra_headers:+-H "$extra_headers"} \
      -d "$body" \
      "$API_URL$path")
    echo "$status"
  }

  echo "Firing $ERROR_COUNT error-inducing requests..."
  SUCCESS=0; FAIL=0

  for i in $(seq 1 "$ERROR_COUNT"); do
    VARIANT=$(( i % 5 ))
    case $VARIANT in
      0)
        # Fake JWT with non-existent userId → DynamoDB GetItem returns null → TypeError in handler
        STATUS=$(fire_error "GET" "/schools" '{}')
        DESC="Fake userId JWT → GET /schools"
        ;;
      1)
        # Oversized payload → possible JSON.parse failure or handler crash
        STATUS=$(fire_error "POST" "/auth/login" "$BIG_BODY")
        DESC="Oversized body → POST /auth/login"
        ;;
      2)
        # Prototype poisoning → unexpected key access in handler
        STATUS=$(fire_error "POST" "/schools" "$POISON_BODY")
        DESC="Prototype poison body → POST /schools"
        ;;
      3)
        # Deeply nested JSON → potential stack overflow in JSON.parse
        STATUS=$(fire_error "POST" "/auth/register" "$DEEP_BODY")
        DESC="Deep nested JSON → POST /auth/register"
        ;;
      4)
        # Binary body with JSON Content-Type → JSON.parse throws SyntaxError
        RAW_STATUS=$(curl -s -o /tmp/alarm_resp.txt -w "%{http_code}" \
          -X POST \
          -H 'Content-Type: application/json' \
          -H "Authorization: Bearer $FAKE_JWT" \
          --data-binary $'\x00\x01\x02\x03\xff\xfe' \
          "$API_URL/auth/login")
        STATUS="$RAW_STATUS"
        DESC="Binary body → POST /auth/login"
        ;;
    esac

    # 5xx = Lambda threw an unhandled error (counted in CloudWatch Errors metric)
    # 4xx = handler caught it gracefully (errorResponse) — NOT counted as Lambda Error
    if [[ "$STATUS" =~ ^5 ]]; then
      echo "  [$i/$ERROR_COUNT] HTTP $STATUS ← LAMBDA ERROR ✓  ($DESC)"
      (( FAIL++ )) || true
    else
      echo "  [$i/$ERROR_COUNT] HTTP $STATUS   (handled gracefully — $DESC)"
      (( SUCCESS++ )) || true
    fi
    sleep 0.3
  done

  echo
  echo "========================================"
  echo " Requests fired : $ERROR_COUNT"
  echo " Lambda errors  : $FAIL   (5xx — counted in CloudWatch Errors metric)"
  echo " Handled (4xx)  : $SUCCESS (errorResponse — NOT counted as Lambda Error)"
  echo "========================================"
  echo
  if [[ $FAIL -eq 0 ]]; then
    echo "NOTE: All requests were handled gracefully (no unhandled Lambda errors)."
    echo "  This means errorResponse() caught everything — which is good code quality,"
    echo "  but won't trigger the CloudWatch Errors alarm."
    echo
    echo "  To force an alarm immediately, use:"
    echo "    ./scripts/alarm-test.sh --mode set-alarm --alarm-name sam-app-test-Auth-Errors"
  else
    echo "=> Lambda Errors metric incremented $FAIL times."
    echo "   CloudWatch alarm should fire within 1-2 minutes if threshold reached."
  fi

  echo
  echo "Watch logs live:"
  echo "  aws logs tail /aws/lambda/sam-app-test-AuthFunction --follow --region $REGION"

else
  echo "ERROR: --mode must be 'set-alarm' or 'api-errors'"
  exit 1
fi

echo
echo "Done."