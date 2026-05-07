#!/usr/bin/env bash
# load-test.sh — generate API traffic to populate CloudWatch metrics & dashboard
# Usage: ./scripts/load-test.sh --api-url https://xxxx.execute-api.ap-northeast-1.amazonaws.com/Prod
#          [--requests 200] [--concurrency 5] [--jwt <token>]
#
# Prerequisites: curl, jq
# Tip: run after seed.sh — it reads JWT from /tmp/seed_jwt.txt automatically

set -euo pipefail

# ── defaults ─────────────────────────────────────────────────────────────────
API_URL=""
REQUESTS=200
CONCURRENCY=5
JWT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --api-url)     API_URL="$2";     shift 2 ;;
    --requests)    REQUESTS="$2";   shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --jwt)         JWT="$2";         shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$API_URL" ]]; then
  API_URL=$(aws cloudformation describe-stacks \
    --stack-name sam-app-test \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
    --output text 2>/dev/null || true)
fi
if [[ -z "$API_URL" ]]; then
  echo "ERROR: --api-url required"; exit 1
fi
API_URL="${API_URL%/}"

if [[ -z "$JWT" && -f /tmp/seed_jwt.txt ]]; then
  JWT=$(cat /tmp/seed_jwt.txt)
  echo "=> JWT loaded from /tmp/seed_jwt.txt"
fi
if [[ -z "$JWT" ]]; then
  echo "ERROR: --jwt required (or run seed.sh first)"; exit 1
fi

# ── discover schoolId ────────────────────────────────────────────────────────
SCHOOLS=$(curl -sf -H "Authorization: Bearer $JWT" "$API_URL/schools" || echo '[]')
SCHOOL_ID=$(echo "$SCHOOLS" | jq -r '.[0].id // .data[0].id // ""')
if [[ -z "$SCHOOL_ID" || "$SCHOOL_ID" == "null" ]]; then
  echo "WARNING: no schoolId found — only unauthenticated endpoints will be hit"
  SCHOOL_ID="unknown"
fi
echo "=> API: $API_URL"
echo "=> School: $SCHOOL_ID"
echo "=> Sending $REQUESTS requests ($CONCURRENCY concurrent)"
echo

# ── endpoint list ────────────────────────────────────────────────────────────
ENDPOINTS=(
  "/dashboard"
  "/schools"
  "/schools/$SCHOOL_ID"
  "/schools/$SCHOOL_ID/students"
  "/schools/$SCHOOL_ID/teachers"
  "/schools/$SCHOOL_ID/subjects"
  "/schools/$SCHOOL_ID/assignments"
  "/schools/$SCHOOL_ID/announcements"
  "/attendance"
)
N_EP=${#ENDPOINTS[@]}

# ── worker ───────────────────────────────────────────────────────────────────
_fire() {
  local idx=$1
  local ep="${ENDPOINTS[$((idx % N_EP))]}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $JWT" \
    "$API_URL$ep")
  echo "$status $ep"
}
export -f _fire
export API_URL JWT ENDPOINTS N_EP

# ── run with xargs parallelism ────────────────────────────────────────────────
START=$(date +%s)
OK=0; ERR=0

seq 0 $((REQUESTS - 1)) | xargs -P "$CONCURRENCY" -I{} bash -c '_fire "$@"' _ {} | \
  tee /tmp/load_test_log.txt | \
  awk '{
    code=$1
    if (code ~ /^2/ || code ~ /^3/) ok++
    else err++
    total++
    if (total % 20 == 0) printf "  progress: %d/%d (ok=%d err=%d)\n", total, '"$REQUESTS"', ok, err
  } END {
    printf "\n==============================\n"
    printf " Total   : %d\n", total
    printf " 2xx/3xx : %d\n", ok
    printf " Errors  : %d\n", err
    printf "==============================\n"
  }'

END=$(date +%s)
echo "Elapsed: $((END - START))s"
echo "Log saved to /tmp/load_test_log.txt"
echo
echo "=> CloudWatch metrics should appear within ~1 minute."
echo "   Dashboard: https://console.aws.amazon.com/cloudwatch/home#dashboards:name=sam-app-test-dashboard"
