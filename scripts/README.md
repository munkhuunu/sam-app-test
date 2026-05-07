# Scripts

These scripts help you test and manage the deployed `sam-app-test` stack.

## Prerequisites

```bash
brew install curl jq awscli   # macOS
# or
apt install curl jq awscli    # Ubuntu/Debian
```

AWS credentials must be configured (`aws configure` or environment variables).

---

## 1. `seed.sh` — Create Synthetic Data

Creates a full school dataset via the live API:
- 1 school, 2 classes, 5 subjects
- 3 teachers, 10 students, 3 parents (linked)
- 4 assignments with grades
- 5 days of attendance records
- 3 announcements

```bash
# Reads API URL from CloudFormation outputs automatically:
./scripts/seed.sh

# Or pass explicitly:
./scripts/seed.sh --api-url https://xxxx.execute-api.ap-northeast-1.amazonaws.com/Prod
```

The JWT is saved to `/tmp/seed_jwt.txt` for use by other scripts.

---

## 2. `load-test.sh` — Generate Traffic for Metrics

Fires N requests across all endpoints to populate CloudWatch dashboard metrics.

```bash
# 200 requests, 5 concurrent (reads JWT from /tmp/seed_jwt.txt)
./scripts/load-test.sh --api-url https://xxxx.execute-api.ap-northeast-1.amazonaws.com/Prod

# Heavier test:
./scripts/load-test.sh --api-url https://... --requests 500 --concurrency 10
```

Metrics appear in CloudWatch within ~1 minute.

---

## 3. `alarm-test.sh` — Test Alarms & Canary Rollback

### Mode A: Force alarm state (recommended for testing)

Instantly flips an alarm to `ALARM` state — CodeDeploy sees this during the
canary 5-minute window and rolls back the deployment.

```bash
# Trigger system health composite alarm:
./scripts/alarm-test.sh --mode set-alarm

# Trigger a specific function alarm:
./scripts/alarm-test.sh --mode set-alarm --alarm-name sam-app-test-Auth-Errors

# Restore to OK after testing:
aws cloudwatch set-alarm-state \
  --alarm-name sam-app-test-System-Health \
  --state-value OK \
  --state-reason "Test complete"
```

### Mode B: Send error traffic via API

Sends malformed requests that may trigger Lambda errors:

```bash
./scripts/alarm-test.sh --mode api-errors \
  --api-url https://xxxx.execute-api.ap-northeast-1.amazonaws.com/Prod \
  --error-count 10
```

### How canary rollback works

1. You push code → CI deploys with `Canary10Percent5Minutes`
2. CodeDeploy shifts 10% of traffic to the new Lambda version
3. **During the 5-minute wait**, if any listed alarm fires → automatic rollback
4. After 5 min with no alarms → 100% traffic shifts to new version

---

## 4. `purge.sh` — Delete All Data

Scans and batch-deletes every item in DynamoDB.

```bash
# Dry run (shows count, deletes nothing):
./scripts/purge.sh

# Actually delete:
./scripts/purge.sh --confirm

# Custom table/region:
./scripts/purge.sh --table my-table --region us-east-1 --confirm
```

**WARNING:** This is irreversible. All data will be lost.

---

## Typical Test Workflow

```bash
# 1. Deploy (push to branch → GitHub Actions)
git push

# 2. Seed synthetic data
./scripts/seed.sh

# 3. Generate dashboard traffic
./scripts/load-test.sh --requests 200

# 4a. Test canary rollback (during an active deployment)
./scripts/alarm-test.sh --mode set-alarm

# 4b. Or test with real error traffic
./scripts/alarm-test.sh --mode api-errors

# 5. Clean up when done
./scripts/purge.sh --confirm
```
