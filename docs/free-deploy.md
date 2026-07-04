# 무료 배포 옵션

Render Background Worker가 유료로 잡히면, 이 모니터에는 GitHub Actions 스케줄러가 제일 간단한 무료 대안입니다.

## 1. GitHub Actions

이 레포에는 `.github/workflows/stock-monitor.yml`가 들어 있습니다. GitHub에 올리면 5분마다 상품 페이지를 확인하고, 재고가 있으면 Discord Webhook으로 알림을 보냅니다.

장점:

- 별도 서버가 필요 없습니다.
- public repo에서는 표준 GitHub-hosted runner 사용이 무료입니다.
- private repo도 GitHub Free 기준 월 2,000분 무료 할당량 안에서 쓸 수 있습니다.

단점:

- GitHub scheduled workflow의 최단 간격은 5분입니다.
- GitHub 부하가 높으면 지연되거나 드물게 누락될 수 있습니다.
- public repo에서 60일간 repo 활동이 없으면 scheduled workflow가 자동 비활성화될 수 있습니다.
- workflow는 GitHub Actions cache에 `.monitor-state.json`을 저장해서, 재고 있음 상태가 계속 유지될 때 알림이 매번 반복되지 않게 합니다.

설정:

1. GitHub에 이 프로젝트를 push합니다.
2. GitHub repo의 `Settings` -> `Secrets and variables` -> `Actions`로 갑니다.
3. `New repository secret`을 누르고 아래 secret을 추가합니다.

```text
Name: DISCORD_WEBHOOK_URL
Value: https://discord.com/api/webhooks/...
```

4. `Actions` 탭에서 `Nintendo Switch 2 stock monitor` workflow를 선택합니다.
5. `Run workflow`로 수동 실행해서 로그를 확인합니다.

Discord까지 GitHub에서 정상 연결됐는지 확인하려면 `Run workflow`를 누를 때 `Send a Discord test alert instead of checking stock` 옵션을 켜세요. Discord 채널에 테스트 메시지가 오면 secret 설정이 정상입니다.

현재 workflow는 `2-59/5 * * * *`로 설정되어 있습니다. 매시 정각 부하를 피하려고 00분이 아니라 02, 07, 12분처럼 돕니다.

재고가 처음 감지되면 알림을 보내고, 이후 계속 재고 있음 상태이면 기본적으로 반복 알림을 보내지 않습니다. 다시 품절 상태를 확인한 뒤 재고가 풀리면 다시 알립니다.

## 2. Cloudflare Workers Cron

조금 더 손이 가지만, 장기적으로는 Cloudflare Workers Cron도 좋은 무료 대안입니다.

장점:

- Workers Free plan에 하루 100,000 requests가 포함됩니다.
- Cron Trigger로 주기 실행할 수 있습니다.
- 서버를 켜둘 필요가 없습니다.

단점:

- 현재 Node.js 코드 그대로는 못 올립니다. Workers 런타임용으로 작은 스크립트를 따로 만들어야 합니다.
- Discord 알림 중심으로 단순화하는 것이 좋습니다.

## 3. Netlify Scheduled Functions

Netlify Scheduled Functions도 모든 pricing plan에서 사용할 수 있지만, 이 용도에서는 GitHub Actions나 Cloudflare Workers보다 특별히 유리하진 않습니다.

## 추천

돈 안 쓰고 바로 시작하려면 GitHub Actions를 쓰세요. 5분 간격이 아쉽다면 Cloudflare Workers Cron으로 옮기는 게 다음 선택지입니다.
