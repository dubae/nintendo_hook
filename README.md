# Nintendo Switch 2 Stock Monitor

한국 닌텐도 공식 스토어의 `Nintendo Switch 2` 상품 페이지를 주기적으로 확인하고, 품절이 풀리면 Discord, 범용 Webhook, SMTP 이메일로 알려주는 작은 Node.js 모니터입니다.

현재 상품 페이지는 Magento 상품 JSON 안에 `is_available` / `is_salable` 값이 들어 있어서 그 값을 1차로 판정합니다. 사이트 구조가 바뀌는 경우를 대비해 `품절`, `stock unavailable`, `장바구니에 추가` 같은 페이지 텍스트도 보조 판정으로 사용합니다.

## 빠른 시작

```bash
cp .env.example .env
npm run check
```

`npm run check`는 한 번만 확인하고 알림은 보내지 않습니다.

24시간 감시는 다음처럼 실행합니다.

```bash
npm start
```

## Discord 알림 설정

Discord 봇 토큰보다 Webhook이 더 단순합니다.

1. Discord 서버의 채널 설정으로 들어갑니다.
2. `연동` 또는 `Integrations`에서 `Webhooks`를 엽니다.
3. 새 Webhook을 만들고 URL을 복사합니다.
4. `.env`에 넣습니다.

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

테스트 메시지:

```bash
npm run test-alert
```

## 무료 배포

Render Background Worker가 유료로 잡힌다면 GitHub Actions 스케줄러가 가장 간단한 무료 대안입니다. 이 레포에는 5분마다 확인하는 `.github/workflows/stock-monitor.yml`이 포함되어 있습니다.

GitHub repo의 `Settings` -> `Secrets and variables` -> `Actions`에 아래 secret을 추가하세요.

```text
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

그 다음 `Actions` 탭에서 `Nintendo Switch 2 stock monitor`를 수동 실행하거나, 기본 스케줄이 돌 때까지 기다리면 됩니다. 자세한 비교는 `docs/free-deploy.md`를 참고하세요.

## 이메일 알림 설정

SMTP를 사용할 수 있습니다. Gmail은 일반 비밀번호가 아니라 앱 비밀번호가 필요합니다.

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_STARTTLS=true
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=your-account@gmail.com
EMAIL_TO=your-phone-or-mail@example.com
```

## 컴퓨터를 켜놓지 않고 돌리는 방법

가장 추천하는 방법은 Render, Railway, Fly.io 같은 작은 클라우드 서비스에 배포하는 것입니다. 이 프로젝트는 외부 패키지가 없어서 Node 20 이상만 있으면 돌아갑니다.

### Docker로 배포

```bash
docker build -t nintendo-switch2-monitor .
docker run --env-file .env nintendo-switch2-monitor
```

### GitHub Actions로 감시

GitHub Actions의 cron은 무료로 쓸 수 있지만, 1분 단위 실시간 감시에는 적합하지 않습니다. 최소 5분 정도로 실행하고, 실행 지연이 생길 수 있습니다. 빠른 구매 알림이 중요하면 항상 켜진 클라우드 프로세스가 낫습니다.

## 주요 설정

```bash
PRODUCT_URL=https://store.nintendo.co.kr/beeskb6aakor
CHECK_INTERVAL_SECONDS=60
REQUEST_TIMEOUT_SECONDS=20
ALERT_ON_START=true
ALERT_REPEAT_MINUTES=0
ERROR_ALERT_THRESHOLD=3
```

`ALERT_REPEAT_MINUTES=0`이면 재고가 계속 있는 동안 반복 알림을 보내지 않습니다. 품절 상태였다가 다시 재고 있음으로 바뀌면 다시 알립니다.

공식 스토어에 과도한 요청을 보내지 않도록 `CHECK_INTERVAL_SECONDS`는 너무 낮추지 않는 것을 권장합니다.
