#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# wipe-and-seed.sh — macOS bash 3.2 compatible
# DynamoDB-ийг цэвэрлэж, demo data (school/class/subject/teacher/student/...) үүсгэнэ
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

API_URL="https://1lc7o3pgg0.execute-api.ap-northeast-1.amazonaws.com/Prod"
TABLE_NAME="school-management"
REGION="ap-northeast-1"
STACK_NAME="sam-app-test"
ADMIN_EMAIL="admin@school.mn"
ADMIN_PASSWORD="Admin1234!"
DEFAULT_PASSWORD="Test1234!"
SKIP_WIPE=0
YES=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --api-url)        API_URL="$2"; shift 2 ;;
    --table)          TABLE_NAME="$2"; shift 2 ;;
    --region)         REGION="$2"; shift 2 ;;
    --stack)          STACK_NAME="$2"; shift 2 ;;
    --admin-email)    ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --skip-wipe)      SKIP_WIPE=1; shift ;;
    --yes|-y)         YES=1; shift ;;
    -h|--help)        grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$API_URL" ]]; then
  echo "=> Stack-аас API URL татаж байна..."
  API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
    --output text 2>/dev/null || true)
fi

if [[ -z "$API_URL" || "$API_URL" == "None" ]]; then
  echo "ERROR: API URL олдсонгүй"; exit 1
fi
API_URL="${API_URL%/}"

echo "════════════════════════════════════════════════════════════════"
echo "  WIPE & SEED   ($API_URL)"
echo "  Admin: $ADMIN_EMAIL / $ADMIN_PASSWORD"
echo "  User pwd: $DEFAULT_PASSWORD"
echo "════════════════════════════════════════════════════════════════"

if [[ "$SKIP_WIPE" -eq 0 && "$YES" -eq 0 ]]; then
  read -p "Бүгдийг устгах уу? (yes/no) " ans
  [[ "$ans" != "yes" ]] && { echo "Цуцлав."; exit 0; }
fi

# ── helpers ─────────────────────────────────────────────────────────────────
JWT=""

apost() {
  local url=$1; shift
  curl -sS -X POST -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $JWT" "$@" "$url"
}

register_user() {
  curl -sS -X POST -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$1" --arg p "$2" --arg t "$3" \
      '{email:$e, password:$p, inviteToken:$t}')" \
    "$API_URL/auth/register"
}

# ═══════════════════════════════════════════════════════════════════════════
# 1. WIPE
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$SKIP_WIPE" -eq 0 ]]; then
  echo
  echo "[1/6] DynamoDB цэвэрлэх..."
  ITEMS=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
    --projection-expression "PK, SK" --output json)
  COUNT=$(echo "$ITEMS" | jq '.Items | length')
  echo "  → $COUNT item"
  if [[ "$COUNT" -gt 0 ]]; then
    echo "$ITEMS" | jq -c '.Items[]' | \
      jq -s 'to_entries | group_by(.key / 25 | floor) | map(map(.value))' | \
      jq -c '.[]' | while read -r batch; do
        REQ=$(echo "$batch" | jq -c \
          '{ "'"$TABLE_NAME"'": [ .[] | { DeleteRequest: { Key: { PK: .PK, SK: .SK } } } ] }')
        aws dynamodb batch-write-item --request-items "$REQ" \
          --region "$REGION" > /dev/null
        printf "."
      done
    echo
    echo "  ✅ $COUNT item устгагдлаа"
  fi
else
  echo "[1/6] Wipe алгасав"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 2. SUPER_ADMIN
# ═══════════════════════════════════════════════════════════════════════════
echo
echo "[2/6] SUPER_ADMIN..."
curl -sS -X POST -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
    '{email:$e, password:$p, role:"SUPER_ADMIN"}')" \
  "$API_URL/auth/register" > /dev/null

LOGIN=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" \
  "$API_URL/auth/login")
JWT=$(echo "$LOGIN" | jq -r '.token')
if [[ -z "$JWT" || "$JWT" == "null" ]]; then
  echo "❌ Admin login алдаа"; echo "$LOGIN" | jq .; exit 1
fi
echo "  ✅ $ADMIN_EMAIL"

# ═══════════════════════════════════════════════════════════════════════════
# 3. Schools + Classes + Subjects
# ═══════════════════════════════════════════════════════════════════════════
echo
echo "[3/6] Сургууль, анги, хичээл..."

# bash 3.2 — associative array-ийг файлд хадгална
WORKDIR=$(mktemp -d)
trap "rm -rf $WORKDIR" EXIT

SCHOOL_NAMES=("23-р сургууль" "Шинэ Эрин ахлах сургууль" "Сэлэнгэ Дэгдээхэй")
SCHOOL_IDS=()

CLASS_DEFS=("1A:1" "1B:1" "2A:2" "5A:5" "9A:9" "11A:11")
SUBJECTS=("Математик" "Монгол хэл" "Англи хэл" "Биологи" "Физик" "Хими" "Түүх" "Газарзүй")

for name in "${SCHOOL_NAMES[@]}"; do
  R=$(apost "$API_URL/schools" -d "$(jq -nc --arg n "$name" '{name:$n}')")
  SID=$(echo "$R" | jq -r '.schoolId // empty')
  if [[ -z "$SID" ]]; then
    echo "  ❌ '$name': $(echo "$R" | jq -r '.message // .')"
    continue
  fi
  SCHOOL_IDS+=("$SID")
  echo "  🏫 $name"

  CLASS_LIST=""
  for cd in "${CLASS_DEFS[@]}"; do
    CNAME="${cd%%:*}"; GRADE="${cd##*:}"
    R=$(apost "$API_URL/schools/$SID/classes" \
      -d "$(jq -nc --arg n "$CNAME" --argjson g "$GRADE" '{name:$n,grade:$g}')")
    CID=$(echo "$R" | jq -r '.classId // empty')
    [[ -n "$CID" ]] && CLASS_LIST="$CLASS_LIST $CID"
  done
  echo "$CLASS_LIST" > "$WORKDIR/classes_$SID"

  SUBJ_LIST=""
  for sub in "${SUBJECTS[@]}"; do
    R=$(apost "$API_URL/schools/$SID/subjects" \
      -d "$(jq -nc --arg n "$sub" '{name:$n}')")
    SUID=$(echo "$R" | jq -r '.subjectId // empty')
    [[ -n "$SUID" ]] && SUBJ_LIST="$SUBJ_LIST $SUID"
  done
  echo "$SUBJ_LIST" > "$WORKDIR/subjects_$SID"

  echo "     📚 $(echo $CLASS_LIST | wc -w | tr -d ' ') анги, 📖 $(echo $SUBJ_LIST | wc -w | tr -d ' ') хичээл"
done

# ═══════════════════════════════════════════════════════════════════════════
# 4. Teachers
# ═══════════════════════════════════════════════════════════════════════════
echo
echo "[4/6] Багш нар..."

TEACHERS=(
  "Болд|Батбаяр"
  "Сарнай|Дамдин"
  "Мөнх|Цэрэн"
  "Энхтуяа|Бат-Эрдэнэ"
)

for i in "${!SCHOOL_IDS[@]}"; do
  SID="${SCHOOL_IDS[$i]}"
  SNAME="${SCHOOL_NAMES[$i]}"
  echo "  ── $SNAME"

  CLASS_IDS=($(cat "$WORKDIR/classes_$SID"))
  SUBJ_IDS=($(cat "$WORKDIR/subjects_$SID"))

  for j in 0 1 2 3; do
    IFS='|' read -r FIRSTNAME LASTNAME <<< "${TEACHERS[$j]}"
    EMAIL="teacher${i}${j}@school.mn"

    # 1) Invite
    INV=$(apost "$API_URL/schools/$SID/invitations" \
      -d "$(jq -nc --arg r "TEACHER" --arg e "$EMAIL" '{role:$r, email:$e}')")
    TOKEN=$(echo "$INV" | jq -r '.token // empty')
    [[ -z "$TOKEN" ]] && { echo "     ⚠️  invite failed: $EMAIL"; continue; }

    # 2) Register USER
    REG=$(register_user "$EMAIL" "$DEFAULT_PASSWORD" "$TOKEN")
    USERID=$(echo "$REG" | jq -r '.userId // empty')
    [[ -z "$USERID" ]] && { echo "     ⚠️  register $EMAIL: $(echo "$REG" | jq -r '.message // .')"; continue; }

    # 3) TEACHER entity
    T=$(apost "$API_URL/schools/$SID/teachers" \
      -d "$(jq -nc --arg f "$FIRSTNAME" --arg l "$LASTNAME" --arg e "$EMAIL" \
        '{firstName:$f, lastName:$l, email:$e}')")
    TID=$(echo "$T" | jq -r '.teacherId // empty')
    [[ -z "$TID" ]] && { echo "     ⚠️  teacher entity failed: $EMAIL"; continue; }

    # 4) Assign 2 анги × 1 хичээл
    ACOUNT=0
    for k in 0 1; do
      CIDX=$(( (j + k) % ${#CLASS_IDS[@]} ))
      SIDX=$(( j % ${#SUBJ_IDS[@]} ))
      CID="${CLASS_IDS[$CIDX]}"
      SUID="${SUBJ_IDS[$SIDX]}"
      [[ -z "$CID" || -z "$SUID" ]] && continue
      A=$(apost "$API_URL/schools/$SID/teachers/assign" \
        -d "$(jq -nc --arg t "$TID" --arg c "$CID" --arg s "$SUID" \
          '{teacherId:$t, classId:$c, subjectId:$s}')")
      if echo "$A" | jq -e '.teacherId' > /dev/null 2>&1; then
        ACOUNT=$((ACOUNT+1))
      fi
    done
    echo "     👨‍🏫 $LASTNAME $FIRSTNAME ($EMAIL) → $ACOUNT анги"
  done
done

# ═══════════════════════════════════════════════════════════════════════════
# 5. Students
# ═══════════════════════════════════════════════════════════════════════════
echo
echo "[5/6] Сурагчид..."

STUDENT_NAMES=(
  "Ариунаа|Бат"
  "Батмөнх|Дорж"
  "Цэцэгмаа|Энх"
  "Энхжаргал|Ган"
  "Номин-Эрдэнэ|Лхагва"
  "Ганбаатар|Мөнх"
  "Сувдаа|Нямын"
  "Баярмаа|Очир"
  "Мөнхзул|Пүрэв"
  "Хүслэн|Раш"
  "Тэмүүлэн|Содном"
  "Анхбаяр|Туяа"
  "Долгормаа|Үлэмж"
  "Эрхэмбаяр|Хадбаатар"
  "Уянга|Цогт"
  "Лхагвасүрэн|Чимэд"
)

for i in "${!SCHOOL_IDS[@]}"; do
  SID="${SCHOOL_IDS[$i]}"
  SNAME="${SCHOOL_NAMES[$i]}"
  echo "  ── $SNAME"

  CLASS_IDS=($(cat "$WORKDIR/classes_$SID"))
  SLIST=""
  COUNT=0

  for j in "${!STUDENT_NAMES[@]}"; do
    IFS='|' read -r FNAME LNAME <<< "${STUDENT_NAMES[$j]}"
    # 0-7 → 1A (index 0), 8-15 → 5A (index 3)
    if [[ $j -lt 8 ]]; then
      CID="${CLASS_IDS[0]:-}"
    else
      CID="${CLASS_IDS[3]:-}"
    fi
    [[ -z "$CID" ]] && continue

    EMAIL="student${i}$(printf '%02d' "$j")@school.mn"
    PHONE="990012$(printf '%02d' "$j")"
    R=$(apost "$API_URL/schools/$SID/students" \
      -d "$(jq -nc --arg f "$FNAME" --arg l "$LNAME" --arg c "$CID" \
        --arg e "$EMAIL" --arg p "$PHONE" \
        '{firstName:$f, lastName:$l, classId:$c, email:$e, phone:$p}')")
    STID=$(echo "$R" | jq -r '.studentId // empty')
    if [[ -n "$STID" ]]; then
      SLIST="$SLIST $STID"
      COUNT=$((COUNT+1))
    fi
  done
  echo "$SLIST" > "$WORKDIR/students_$SID"
  echo "     👨‍🎓 $COUNT сурагч"
done

# ═══════════════════════════════════════════════════════════════════════════
# 6. Directors, Parents, Announcements, Assignments
# ═══════════════════════════════════════════════════════════════════════════
echo
echo "[6/6] Захирал, эцэг эх, мэдээ, даалгавар..."

for i in "${!SCHOOL_IDS[@]}"; do
  SID="${SCHOOL_IDS[$i]}"
  SNAME="${SCHOOL_NAMES[$i]}"
  echo "  ── $SNAME"

  CLASS_IDS=($(cat "$WORKDIR/classes_$SID"))
  SUBJ_IDS=($(cat "$WORKDIR/subjects_$SID"))
  STUD_IDS=($(cat "$WORKDIR/students_$SID" 2>/dev/null || echo ""))

  # Director
  DIR_EMAIL="director$((i+1))@school.mn"
  R=$(apost "$API_URL/schools/$SID/invitations" \
    -d "$(jq -nc --arg r "DIRECTOR" --arg e "$DIR_EMAIL" '{role:$r,email:$e}')")
  TOK=$(echo "$R" | jq -r '.token // empty')
  if [[ -n "$TOK" ]]; then
    REG=$(register_user "$DIR_EMAIL" "$DEFAULT_PASSWORD" "$TOK")
    if echo "$REG" | jq -e '.userId' > /dev/null; then
      echo "     👔 Захирал: $DIR_EMAIL"
    fi
  fi

  # Parents — эхний 2 сурагчтай холбоно
  for k in 0 1; do
    [[ -z "${STUD_IDS[$k]:-}" ]] && continue
    PEMAIL="parent${i}${k}@school.mn"
    R=$(apost "$API_URL/schools/$SID/invitations" \
      -d "$(jq -nc --arg r "PARENT" --arg e "$PEMAIL" '{role:$r,email:$e}')")
    TOK=$(echo "$R" | jq -r '.token // empty')
    [[ -z "$TOK" ]] && continue

    REG=$(register_user "$PEMAIL" "$DEFAULT_PASSWORD" "$TOK")
    PID=$(echo "$REG" | jq -r '.userId // empty')
    if [[ -n "$PID" ]]; then
      apost "$API_URL/schools/$SID/parents/$PID/students" \
        -d "$(jq -nc --arg s "${STUD_IDS[$k]}" '{studentId:$s}')" > /dev/null
      echo "     👨‍👩‍👧 $PEMAIL"
    fi
  done

  # Announcements
  for a in \
    "Эцэг эхийн хурал|Маргааш 18:00 цагт сургуулийн үндсэн танхимд эцэг эхийн хурал болно.|ALL" \
    "Багш нарын зөвлөгөөн|Долоо хоног бүрийн Лхагва 14:00 цагт зөвлөгөөн.|TEACHER" \
    "Шалгалтын хуваарь|Жил эцсийн шалгалтын хуваарийг 6-р сарын 1-нд зарлана.|STUDENT"; do
    IFS='|' read -r T C AUD <<< "$a"
    apost "$API_URL/schools/$SID/announcements" \
      -d "$(jq -nc --arg t "$T" --arg c "$C" --arg au "$AUD" \
        '{title:$t, content:$c, audience:$au}')" > /dev/null
  done
  echo "     📢 3 мэдээ"

  # Assignments — 1A ангид Математик хичээлд
  CID="${CLASS_IDS[0]:-}"
  SUID="${SUBJ_IDS[0]:-}"
  if [[ -n "$CID" && -n "$SUID" ]]; then
    for a in \
      "Алгебрийн даалгавар №1|HOMEWORK|100|2026-06-15" \
      "Геометрийн шалгалт|EXAM|50|2026-06-20"; do
      IFS='|' read -r T TY M D <<< "$a"
      apost "$API_URL/schools/$SID/assignments" \
        -d "$(jq -nc --arg t "$T" --arg ty "$TY" --argjson m "$M" \
          --arg d "$D" --arg c "$CID" --arg s "$SUID" \
          '{title:$t, type:$ty, maxScore:$m, dueDate:$d, classId:$c, subjectId:$s}')" > /dev/null
    done
    echo "     📝 2 даалгавар"
  fi
done

echo
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ БЭЛЭН"
echo "════════════════════════════════════════════════════════════════"
echo "  Super Admin : $ADMIN_EMAIL / $ADMIN_PASSWORD"
echo "  Directors   : director1@school.mn ... director3@school.mn"
echo "  Teachers    : teacher00@school.mn ... teacher23@school.mn"
echo "  Parents     : parent00@school.mn ... parent21@school.mn"
echo "  Default pwd : $DEFAULT_PASSWORD"
echo ""
echo "  Сургууль/Анги/Багш/Сурагч : ${#SCHOOL_IDS[@]}/$(( ${#SCHOOL_IDS[@]}*6 ))/$(( ${#SCHOOL_IDS[@]}*4 ))/$(( ${#SCHOOL_IDS[@]}*16 ))"
echo "════════════════════════════════════════════════════════════════"