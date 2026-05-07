#!/usr/bin/env bash
# purge.sh — delete ALL items from the school-management DynamoDB table
#
# Usage:
#   ./scripts/purge.sh                            # dry-run (shows count only)
#   ./scripts/purge.sh --confirm                  # actually deletes
#   ./scripts/purge.sh --table my-table --region us-east-1 --confirm
#
# WARNING: This is IRREVERSIBLE. All data will be lost.
# Prerequisites: aws cli v2, jq

set -euo pipefail

# ── args ─────────────────────────────────────────────────────────────────────
TABLE="school-management"
REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"
CONFIRM=false
BATCH_SIZE=25  # DynamoDB batch-write max

while [[ $# -gt 0 ]]; do
  case $1 in
    --confirm)         CONFIRM=true;   shift   ;;
    --table)  TABLE="$2";  shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "====================================================="
echo " Table  : $TABLE"
echo " Region : $REGION"
if $CONFIRM; then
  echo " Mode   : LIVE DELETE — items will be permanently removed!"
else
  echo " Mode   : DRY RUN — pass --confirm to actually delete"
fi
echo "====================================================="
echo

# ── discover key schema ───────────────────────────────────────────────────────
SCHEMA=$(aws dynamodb describe-table \
  --table-name "$TABLE" \
  --region "$REGION" \
  --query 'Table.KeySchema' \
  --output json)
HASH_KEY=$(echo "$SCHEMA" | jq -r '.[] | select(.KeyType=="HASH") | .AttributeName')
RANGE_KEY=$(echo "$SCHEMA" | jq -r '.[] | select(.KeyType=="RANGE") | .AttributeName // ""')
echo "Key schema: HASH=$HASH_KEY RANGE=${RANGE_KEY:-(none)}"
echo

# ── scan all items ────────────────────────────────────────────────────────────
echo "Scanning table..."
TMPFILE=$(mktemp)
LAST_KEY=""
TOTAL=0

while true; do
  if [[ -n "$LAST_KEY" ]]; then
    RESP=$(aws dynamodb scan \
      --table-name "$TABLE" \
      --region "$REGION" \
      --exclusive-start-key "$LAST_KEY" \
      --output json)
  else
    RESP=$(aws dynamodb scan \
      --table-name "$TABLE" \
      --region "$REGION" \
      --output json)
  fi

  COUNT=$(echo "$RESP" | jq '.Count')
  TOTAL=$((TOTAL + COUNT))
  echo "  scanned page: $COUNT items (total so far: $TOTAL)"

  # append keys to tempfile
  if [[ -n "$RANGE_KEY" ]]; then
    echo "$RESP" | jq -c --arg pk "$HASH_KEY" --arg sk "$RANGE_KEY" \
      '.Items[] | {DeleteRequest:{Key:{($pk):.[$pk],($sk):.[$sk]}}}' >> "$TMPFILE"
  else
    echo "$RESP" | jq -c --arg pk "$HASH_KEY" \
      '.Items[] | {DeleteRequest:{Key:{($pk):.[$pk]}}}' >> "$TMPFILE"
  fi

  LAST_KEY=$(echo "$RESP" | jq -c '.LastEvaluatedKey // empty')
  [[ -z "$LAST_KEY" ]] && break
done

echo
echo "Total items found: $TOTAL"

if [[ $TOTAL -eq 0 ]]; then
  echo "Table is already empty."
  rm -f "$TMPFILE"
  exit 0
fi

if ! $CONFIRM; then
  echo
  echo "DRY RUN — nothing deleted."
  echo "Run with --confirm to delete all $TOTAL items."
  rm -f "$TMPFILE"
  exit 0
fi

# ── batch delete ─────────────────────────────────────────────────────────────
echo
echo "Deleting $TOTAL items in batches of $BATCH_SIZE..."
DELETED=0

# split into batches of 25
BATCH_TMP=$(mktemp)
BATCH_COUNT=0

while IFS= read -r LINE; do
  echo "$LINE" >> "$BATCH_TMP"
  BATCH_COUNT=$((BATCH_COUNT + 1))

  if [[ $BATCH_COUNT -eq $BATCH_SIZE ]]; then
    REQUESTS=$(paste -sd',' "$BATCH_TMP" | sed 's/^/[/' | sed 's/$/]/')
    PAYLOAD="{\"$TABLE\": $REQUESTS}"
    aws dynamodb batch-write-item \
      --region "$REGION" \
      --request-items "$PAYLOAD" \
      --output json > /dev/null
    DELETED=$((DELETED + BATCH_COUNT))
    echo "  deleted $DELETED / $TOTAL"
    > "$BATCH_TMP"
    BATCH_COUNT=0
  fi
done < "$TMPFILE"

# flush remaining
if [[ $BATCH_COUNT -gt 0 ]]; then
  REQUESTS=$(paste -sd',' "$BATCH_TMP" | sed 's/^/[/' | sed 's/$/]/')
  PAYLOAD="{\"$TABLE\": $REQUESTS}"
  aws dynamodb batch-write-item \
    --region "$REGION" \
    --request-items "$PAYLOAD" \
    --output json > /dev/null
  DELETED=$((DELETED + BATCH_COUNT))
fi

rm -f "$TMPFILE" "$BATCH_TMP"

echo
echo "====================================================="
echo " Deleted : $DELETED items"
echo " Table   : $TABLE"
echo "====================================================="
echo "Table is now empty."
