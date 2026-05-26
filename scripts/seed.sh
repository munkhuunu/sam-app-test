#!/usr/bin/env bash
# seed.sh — create a full synthetic dataset via the live API
# Usage: ./scripts/seed.sh --api-url https://xxxx.execute-api.ap-northeast-1.amazonaws.com/Prod

set -euo pipefail

# ── args ─────────────────────────────────────────────────────────────────────
API_URL="https://1lc7o3pgg0.execute-api.ap-northeast-1.amazonaws.com/Prod"
while [[ $# -gt 0 ]]; do
  case $1 in
    --api-url) API_URL="$2"; shift 2 ;;
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
  echo "ERROR: --api-url required (or deploy the stack first)"
  exit 1
fi

API_URL="${API_URL%/}"
echo "=> API: $API_URL"

# ── helpers ───────────────────────────────────────────────────────────────────
post()      { curl -sf -X POST -H 'Content-Type: application/json' "$@"; }
auth_post() { local url=$1; shift; curl -sf -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $JWT" "$@" "$url"; }
auth_get()  { curl -sf -H "Authorization: Bearer $JWT" "$1"; }

# ── 1. register admin ─────────────────────────────────────────────────────────
echo
echo "[1/12] Registering admin user..."
RESP=$(post "$API_URL/auth/register" \
  -d '{"email":"admin@seed.test","password":"Seed1234!","name":"Seed Admin","role":"SUPER_ADMIN"}' || true)
echo "  register: $RESP"

# ── 2. login ──────────────────────────────────────────────────────────────────
echo "[2/12] Logging in..."
RESP=$(post "$API_URL/auth/login" \
  -d '{"email":"admin@seed.test","password":"Seed1234!"}')
JWT=$(echo "$RESP" | jq -r '.token // .accessToken // .data.token')
if [[ -z "$JWT" || "$JWT" == "null" ]]; then
  echo "ERROR: login failed — $RESP"
  exit 1
fi
echo "  JWT obtained (${#JWT} chars)"

# ── 3. create school ──────────────────────────────────────────────────────────
echo "[3/12] Creating school..."
RESP=$(auth_post "$API_URL/schools" \
  -d '{"name":"Гэрэл Дунд Сургууль","address":"Улаанбаатар, Сүхбаатар дүүрэг"}')
echo "  raw response: $RESP"
SCHOOL_ID=$(echo "$RESP" | jq -r '.schoolId // .id // .data.schoolId // .data.id // empty')
if [[ -z "$SCHOOL_ID" || "$SCHOOL_ID" == "null" ]]; then
  echo "ERROR: school creation failed — $RESP"
  exit 1
fi
echo "  schoolId: $SCHOOL_ID"

# ── 4. create classes ─────────────────────────────────────────────────────────
echo "[4/12] Creating classes..."
RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/classes" \
  -d '{"name":"10А анги","grade":10,"academicYear":"2025"}')
echo "  class1 raw: $RESP"
CLASS1_ID=$(echo "$RESP" | jq -r '.classId // .id // .data.classId // .data.id // empty')
echo "  class1: $CLASS1_ID"

RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/classes" \
  -d '{"name":"11Б анги","grade":11,"academicYear":"2025"}')
CLASS2_ID=$(echo "$RESP" | jq -r '.classId // .id // .data.classId // .data.id // empty')
echo "  class2: $CLASS2_ID"

# ── 5. create subjects ────────────────────────────────────────────────────────
echo "[5/12] Creating subjects..."
SUBJ_ID=""
for SUBJ in 'Математик' 'Физик' 'Монгол хэл' 'Англи хэл' 'Түүх'; do
  RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/subjects" \
    -d "{\"name\":\"$SUBJ\"}" 2>/dev/null || echo '{}')
  if [[ -z "$SUBJ_ID" || "$SUBJ_ID" == "null" ]]; then
    SUBJ_ID=$(echo "$RESP" | jq -r '.subjectId // .id // .data.subjectId // .data.id // empty')
  fi
done
echo "  subjects created, first subjectId: $SUBJ_ID"

# ── 6. create teachers (via invitation flow) ─────────────────────────────────
echo "[6/12] Creating teachers..."
TEACHERS=(
  'Б.Болд|bold@seed.test|Болд|Б'
  'Д.Мөнх|munkh@seed.test|Мөнх|Д'
  'С.Сарнай|sarnai@seed.test|Сарнай|С'
)
TEACHER_IDS=()
for T in "${TEACHERS[@]}"; do
  IFS='|' read -r _name EMAIL FIRSTNAME LASTNAME <<< "$T"
  INV=$(auth_post "$API_URL/schools/$SCHOOL_ID/invitations" \
    -d "{\"email\":\"$EMAIL\",\"role\":\"TEACHER\"}" 2>/dev/null || echo '{}')
  TOKEN=$(echo "$INV" | jq -r '.token // .data.token // .invitation.token // empty')
  if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
    # ✅ FIX: backend нь `inviteToken` хүлээдэг (invitationToken биш)
    REG=$(post "$API_URL/auth/register" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"Teacher1!\",\"inviteToken\":\"$TOKEN\"}" 2>/dev/null || echo '{}')
  else
    REG='{}'
  fi
  TID=$(echo "$REG" | jq -r '.userId // .id // .data.userId // .data.id // empty')
  TEACHER_IDS+=("${TID:-}")
  echo "  teacher $FIRSTNAME → $TID"
done

# ── 7. create students ────────────────────────────────────────────────────────
echo "[7/12] Creating students..."
STUDENTS=(
  'Ариун-Эрдэнэ|Ариун-Эрдэнэ|А|ариун@seed.test|2008-03-12'
  'Батмөнх|Батмөнх|Б|batmunkh@seed.test|2008-07-22'
  'Цэцэгмаа|Цэцэгмаа|Ц|tsetseg@seed.test|2009-01-05'
  'Дорж|Дорж|Д|dorj@seed.test|2008-11-30'
  'Энхжаргал|Энхжаргал|Э|enkhjargal@seed.test|2009-04-18'
  'Номин|Номин|Н|nomin@seed.test|2008-09-09'
  'Ганбаатар|Ганбаатар|Г|ganbaatar@seed.test|2007-12-25'
  'Сувдаа|Сувдаа|С|suvdaa@seed.test|2008-06-14'
  'Баярмаа|Баярмаа|Б|bayarmaa@seed.test|2009-02-28'
  'Мөнхзул|Мөнхзул|М|munkhzul@seed.test|2007-08-03'
)
STUDENT_IDS=()
for S in "${STUDENTS[@]}"; do
  IFS='|' read -r _disp FIRSTNAME LASTNAME EMAIL DOB <<< "$S"
  RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/students" \
    -d "{\"firstName\":\"$FIRSTNAME\",\"lastName\":\"$LASTNAME\",\"email\":\"$EMAIL\",\"dateOfBirth\":\"$DOB\",\"classId\":\"$CLASS1_ID\"}" \
    2>/dev/null || echo '{}')
  SID=$(echo "$RESP" | jq -r '.studentId // .id // .data.studentId // .data.id // empty')
  STUDENT_IDS+=("${SID:-}")
  echo "  student $FIRSTNAME → $SID"
done

# ── 8. create parents and link ────────────────────────────────────────────────
echo "[8/12] Creating parents..."
for i in 0 1 2; do
  SID="${STUDENT_IDS[$i]:-}"
  [[ -z "$SID" || "$SID" == "null" ]] && continue
  # ✅ FIX: PARENT register ч мөн inviteToken-аар flow явах ёстой
  INV=$(auth_post "$API_URL/schools/$SCHOOL_ID/invitations" \
    -d "{\"email\":\"parent${i}@seed.test\",\"role\":\"PARENT\"}" 2>/dev/null || echo '{}')
  PTOKEN=$(echo "$INV" | jq -r '.token // empty')
  if [[ -n "$PTOKEN" && "$PTOKEN" != "null" ]]; then
    RESP=$(post "$API_URL/auth/register" \
      -d "{\"email\":\"parent${i}@seed.test\",\"password\":\"Parent1!\",\"inviteToken\":\"$PTOKEN\"}" \
      2>/dev/null || echo '{}')
    PID=$(echo "$RESP" | jq -r '.userId // .id // empty')
    if [[ -n "$PID" && "$PID" != "null" ]]; then
      auth_post "$API_URL/schools/$SCHOOL_ID/parents/$PID/students" \
        -d "{\"studentId\":\"$SID\"}" > /dev/null 2>&1 || true
      echo "  parent$i ($PID) linked to student $SID"
    fi
  fi
done

# ── 9. create assignments ─────────────────────────────────────────────────────
echo "[9/12] Creating assignments..."
ASGN_IDS=()
declare -A ASGN_TYPES=(
  ['Алгебрийн даалгавар №1']='HOMEWORK'
  ['Геометр №1']='HOMEWORK'
  ['Эссэ бичих']='PROJECT'
  ['Туршилт №1']='EXAM'
)
for TITLE in 'Алгебрийн даалгавар №1' 'Геометр №1' 'Эссэ бичих' 'Туршилт №1'; do
  TYPE="${ASGN_TYPES[$TITLE]}"
  RESP=$(auth_post "$API_URL/schools/$SCHOOL_ID/assignments" \
    -d "{\"title\":\"$TITLE\",\"classId\":\"$CLASS1_ID\",\"subjectId\":\"${SUBJ_ID:-placeholder}\",\"type\":\"$TYPE\",\"dueDate\":\"2025-06-30\",\"maxScore\":100}" \
    2>/dev/null || echo '{}')
  AID=$(echo "$RESP" | jq -r '.assignmentId // .id // .data.assignmentId // .data.id // empty')
  ASGN_IDS+=("${AID:-}")
  echo "  assignment '$TITLE' ($TYPE) → $AID"
done

# ── 10. submit grades ─────────────────────────────────────────────────────────
echo "[10/12] Submitting grades..."
if [[ ${#ASGN_IDS[@]} -gt 0 && -n "${ASGN_IDS[0]:-}" && "${ASGN_IDS[0]}" != "null" ]]; then
  AID="${ASGN_IDS[0]}"
  SCORES=(95 87 72 90 68 55 83 91 77 88)
  for i in "${!STUDENT_IDS[@]}"; do
    SID="${STUDENT_IDS[$i]:-}"
    [[ -z "$SID" || "$SID" == "null" ]] && continue
    SCORE="${SCORES[$i]:-70}"
    auth_post "$API_URL/schools/$SCHOOL_ID/assignments/$AID/grades" \
      -d "{\"studentId\":\"$SID\",\"score\":$SCORE,\"comment\":\"Synthetic grade\"}" \
      > /dev/null 2>&1 || true
  done
  echo "  grades submitted for assignmentId $AID"
fi

# ── 11. create attendance ─────────────────────────────────────────────────────
echo "[11/12] Creating attendance records..."
DATES=('2025-05-01' '2025-05-05' '2025-05-06' '2025-05-07' '2025-05-08')
STATUSES=('PRESENT' 'PRESENT' 'ABSENT' 'PRESENT' 'LATE')

for i in "${!DATES[@]}"; do
  DATE="${DATES[$i]}"
  STATUS="${STATUSES[$i]}"

  RECORDS="["
  FIRST=true
  for SID in "${STUDENT_IDS[@]:0:5}"; do
    [[ -z "$SID" || "$SID" == "null" ]] && continue
    $FIRST || RECORDS+=","
    RECORDS+="{\"studentId\":\"$SID\",\"status\":\"$STATUS\"}"
    FIRST=false
  done
  RECORDS+="]"

  auth_post "$API_URL/attendance" \
    -d "{\"classId\":\"$CLASS1_ID\",\"date\":\"$DATE\",\"records\":$RECORDS}" \
    > /dev/null 2>&1 || true
  echo "  attendance $DATE ($STATUS) — $(echo "$RECORDS" | jq length 2>/dev/null || echo '?') students"
done

# ── 12. create announcements ──────────────────────────────────────────────────
echo "[12/12] Creating announcements..."
ANNOUNCEMENTS=(
  'Эхний улирлын шалгалт|2025-05-15-ны өдөр эхний улирлын шалгалт болно. Бүх сурагчид бэлдэнэ үү.|ALL'
  'Спортын наадам|2025-05-20-нд сургуулийн спортын наадам болно. Оролцогчид бүртгүүлнэ үү.|ALL'
  'Эцэг эхийн хурал|2025-05-10-нд 18:00 цагт эцэг эхийн хурал болно.|PARENT'
)
for A in "${ANNOUNCEMENTS[@]}"; do
  IFS='|' read -r TITLE CONTENT AUDIENCE <<< "$A"
  auth_post "$API_URL/schools/$SCHOOL_ID/announcements" \
    -d "{\"title\":\"$TITLE\",\"content\":\"$CONTENT\",\"audience\":\"$AUDIENCE\"}" \
    > /dev/null 2>&1 || true
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
