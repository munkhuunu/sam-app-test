#!/usr/bin/env bash
# seed.sh — create a full synthetic dataset via the live API
# Usage: ./scripts/seed.sh --api-url https://xxxx.execute-api.ap-northeast-1.amazonaws.com/Prod
#
# Prerequisites: curl, jq

set -euo pipefail

# ── args ────────────────────────────────────────────────────────────────────
API_URL=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --api-url) API_URL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$API_URL" ]]; then
  # try to read from SAM outputs if deployed in current AWS account
  API_URL=$(aws cloudformation describe-stacks \
    --stack-name sam-app-test \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
    --output text 2>/dev/null || true)
fi

if [[ -z "$API_URL" ]]; then
  echo "ERROR: --api-url required (or deploy the stack first)"
  exit 1
fi

API_URL="${API_URL%/}"  # strip trailing slash
echo "=> API: $API_URL"

# ── helpers ─────────────────────────────────────────────────────────────────
post() { curl -sf -X POST -H 'Content-Type: application/json' "$@"; }
auth_post() { local url=$1; shift; curl -sf -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $JWT" "$@" "$url"; }
auth_get()  { curl -sf -H "Authorization: Bearer $JWT" "$1"; }
auth_put()  { local url=$1; shift; curl -sf -X PUT  -H 'Content-Type: application/json' -H "Authorization: Bearer $JWT" "$@" "$url"; }

# ── 1. register admin ────────────────────────────────────────────────────────
echo
echo "[1/12] Registering admin user..."
RESP=$(post "$API_URL/auth/register" \
  -d '{"email":"admin@seed.test","password":"Seed1234!","name":"Seed Admin","role":"admin"}' || true)
echo "  register: $RESP"

# ── 2. login ─────────────────────────────────────────────────────────────────
echo "[2/12] Logging in..."
RESP=$(post "$API_URL/auth/login" \
  -d '{"email":"admin@seed.test","password":"Seed1234!"}')
JWT=$(echo "$RESP" | jq -r '.token // .accessToken // .data.token')
if [[ -z "$JWT" || "$JWT" == "null" ]]; then
  echo "ERROR: login failed — $RESP"
  exit 1
fi
echo "  JWT obtained (${#JWT} chars)"

# ── 3. create school ─────────────────────────────────────────────────────────
echo "[3/12] Creating school..."
RESP=$(auth_post "$API_URL/schools" \
  -d '{"name":"Гэрэл Дунд Сургууль","address":"Улаанбаатар, Сүхбаатар дүүрэг","phone":"+97699001122","email":"gerel@school.mn"}')
SCHOOL_ID=$(echo "$RESP" | jq -r '.id // .data.id // .school.id')
echo "  schoolId: $SCHOOL_ID"

# ── 4. create classes ────────────────────────────────────────────────────────
echo "[4/12] Creating classes..."
RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/classes" \
  -d '{"name":"10А анги","grade":10,"year":2025}')
CLASS1_ID=$(echo "$RESP" | jq -r '.id // .data.id // .class.id')
echo "  class1: $CLASS1_ID"

RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/classes" \
  -d '{"name":"11Б анги","grade":11,"year":2025}')
CLASS2_ID=$(echo "$RESP" | jq -r '.id // .data.id // .class.id')
echo "  class2: $CLASS2_ID"

# ── 5. create subjects ───────────────────────────────────────────────────────
echo "[5/12] Creating subjects..."
for SUBJ in 'Математик' 'Физик' 'Монгол хэл' 'Англи хэл' 'Түүх'; do
  auth_post "$API_URL/schools/$SCHOOL_ID/subjects" \
    -d "{\"name\":\"$SUBJ\",\"classId\":\"$CLASS1_ID\"}" > /dev/null
done
RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/subjects" \
  -d '{"name":"Математик","classId":"'\'$CLASS2_ID\''"}' 2>/dev/null || true)
SUBJ_RESP=$(auth_get "$API_URL/schools/$SCHOOL_ID/subjects" 2>/dev/null || echo '{}')
SUBJ_ID=$(echo "$SUBJ_RESP" | jq -r '.[0].id // .data[0].id // .subjects[0].id // ""')
echo "  subjects created, first subjectId: $SUBJ_ID"

# ── 6. invite & create teachers ──────────────────────────────────────────────
echo "[6/12] Creating teachers..."
TEACHERS=(
  'Б.Болд|bold@seed.test|Болд'
  'Д.Мөнх|munkh@seed.test|Мөнх'
  'С.Сарнай|sarnai@seed.test|Сарнай'
)
TEACHER_IDS=()
for T in "${TEACHERS[@]}"; do
  IFS='|' read -r _name EMAIL NAME <<< "$T"
  # invite
  INV=$(auth_post "$API_URL/schools/$SCHOOL_ID/invitations" \
    -d "{\"email\":\"$EMAIL\",\"role\":\"teacher\"}" 2>/dev/null || echo '{}')
  TOKEN=$(echo "$INV" | jq -r '.token // .data.token // .invitation.token // ""')
  # register via invitation (if supported) or direct register
  if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
    REG=$(post "$API_URL/auth/register" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"Teacher1!\",\"name\":\"$NAME\",\"role\":\"teacher\",\"invitationToken\":\"$TOKEN\"}" 2>/dev/null || true)
  else
    REG=$(post "$API_URL/auth/register" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"Teacher1!\",\"name\":\"$NAME\",\"role\":\"teacher\"}" 2>/dev/null || true)
  fi
  TID=$(echo "$REG" | jq -r '.id // .data.id // .user.id // ""')
  TEACHER_IDS+=("$TID")
  echo "  teacher $NAME → $TID"
done

# ── 7. create students ───────────────────────────────────────────────────────
echo "[7/12] Creating students..."
STUDENTS=(
  'Ариун-Эрдэнэ|ариун@seed.test|2008-03-12'
  'Батмөнх|batmunkh@seed.test|2008-07-22'
  'Цэцэгмаа|tsetseg@seed.test|2009-01-05'
  'Дорж|dorj@seed.test|2008-11-30'
  'Энхжаргал|enkhjargal@seed.test|2009-04-18'
  'Номин|nomin@seed.test|2008-09-09'
  'Ганбаатар|ganbaatar@seed.test|2007-12-25'
  'Сувдаа|suvdaa@seed.test|2008-06-14'
  'Баярмаа|bayarmaa@seed.test|2009-02-28'
  'Мөнхзул|munkhzul@seed.test|2007-08-03'
)
STUDENT_IDS=()
for S in "${STUDENTS[@]}"; do
  IFS='|' read -r NAME EMAIL DOB <<< "$S"
  RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/students" \
    -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"dateOfBirth\":\"$DOB\",\"classId\":\"$CLASS1_ID\"}" 2>/dev/null || echo '{}')
  SID=$(echo "$RESP" | jq -r '.id // .data.id // .student.id // ""')
  STUDENT_IDS+=("$SID")
  echo "  student $NAME → $SID"
done

# ── 8. create parents and link ───────────────────────────────────────────────
echo "[8/12] Creating parents..."
for i in 0 1 2; do
  SID="${STUDENT_IDS[$i]:-}"
  [[ -z "$SID" || "$SID" == "null" ]] && continue
  RESP=$(post "$API_URL/auth/register" \
    -d "{\"email\":\"parent${i}@seed.test\",\"password\":\"Parent1!\",\"name\":\"Эцэг эх ${i}\",\"role\":\"parent\"}" 2>/dev/null || echo '{}')
  PID=$(echo "$RESP" | jq -r '.id // .data.id // .user.id // ""')
  if [[ -n "$PID" && "$PID" != "null" ]]; then
    auth_post "$API_URL/schools/$SCHOOL_ID/parents/$PID/students" \
      -d "{\"studentId\":\"$SID\"}" > /dev/null 2>&1 || true
    echo "  parent$i ($PID) linked to student $SID"
  fi
done

# ── 9. create assignments ────────────────────────────────────────────────────
echo "[9/12] Creating assignments..."
ASGN_IDS=()
for TITLE in 'Алгебрийн даалгавар №1' 'Геометр №1' 'Эссэ бичих' 'Туршилт №1'; do
  RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/assignments" \
    -d "{\"title\":\"$TITLE\",\"classId\":\"$CLASS1_ID\",\"subjectId\":\"${SUBJ_ID:-s1}\",\"dueDate\":\"2025-06-30\",\"maxScore\":100}" 2>/dev/null || echo '{}')
  AID=$(echo "$RESP" | jq -r '.id // .data.id // .assignment.id // ""')
  ASNG_IDS+=("$AID")
  echo "  assignment '$TITLE' → $AID"
done

# ── 10. submit grades ────────────────────────────────────────────────────────
echo "[10/12] Submitting grades..."
if [[ ${#ASNG_IDS[@]} -gt 0 && -n "${ASNG_IDS[0]:-}" && "${ASNG_IDS[0]}" != "null" ]]; then
  AID="${ASNG_IDS[0]}"
  SCORES=(95 87 72 90 68 55 83 91 77 88)
  for i in "${!STUDENT_IDS[@]}"; do
    SID="${STUDENT_IDS[$i]:-}"
    [[ -z "$SID" || "$SID" == "null" ]] && continue
    SCORE="${SCORES[$i]:-70}"
    auth_post "$API_URL/schools/$SCHOOL_ID/assignments/$AID/grades" \
      -d "{\"studentId\":\"$SID\",\"score\":$SCORE,\"comment\":\"Synthetic grade\"}" > /dev/null 2>&1 || true
  done
  echo "  grades submitted for assignmentId $AID"
fi

# ── 11. create attendance ────────────────────────────────────────────────────
echo "[11/12] Creating attendance records..."
DATES=('2025-05-01' '2025-05-05' '2025-05-06' '2025-05-07' '2025-05-08')
STATUSES=('present' 'present' 'absent' 'present' 'late')
for i in "${!DATES[@]}"; do
  DATE="${DATES[$i]}"
  STATUS="${STATUSES[$i]}"
  for SID in "${STUDENT_IDS[@]:0:5}"; do
    [[ -z "$SID" || "$SID" == "null" ]] && continue
    auth_post "$API_URL/attendance" \
      -d "{\"studentId\":\"$SID\",\"date\":\"$DATE\",\"status\":\"$STATUS\",\"classId\":\"$CLASS1_ID\"}" \
      > /dev/null 2>&1 || true
  done
done
echo "  attendance records created"

# ── 12. create announcements ─────────────────────────────────────────────────
echo "[12/12] Creating announcements..."
ANNOUNCEMENTS=(
  'Эхний улирлын шалгалт|2025-05-15-ны өдөр эхний улирлын шалгалт болно. Бүх сурагчид бэлдэнэ үү.'
  'Спортын наадам|2025-05-20-нд сургуулийн спортын наадам болно. Оролцогчид бүртгүүлнэ үү.'
  'Эцэг эхийн хурал|2025-05-10-нд 18:00 цагт эцэг эхийн хурал болно.'
)
for A in "${ANNOUNCEMENTS[@]}"; do
  IFS='|' read -r TITLE BODY <<< "$A"
  auth_post "$API_URL/schools/$SCHOOL_ID/announcements" \
    -d "{\"title\":\"$TITLE\",\"body\":\"$BODY\",\"audience\":\"all\"}" > /dev/null 2>&1 || true
  echo "  announcement: $TITLE"
done

echo
echo "====================================================="
echo " Seed complete!"
echo "  School ID : $SCHOOL_ID"
echo "  Class 1   : $CLASS1_ID"
echo "  Class 2   : $CLASS2_ID"
echo "  Students  : ${#STUDENT_IDS[@]}"
echo "  JWT       : (saved to /tmp/seed_jwt.txt)"
echo "====================================================="
echo "$JWT" > /tmp/seed_jwt.txt
