# Deploy

Pipeline de produção em 3 camadas.

## Estágios

1. **CI** — lint + testes (GitHub Actions)
2. **Build** — imagem Docker com o serviço e o [[banco-de-dados]] migration runner
3. **Release** — rollout canário de 10% durante 15 min

## Cron jobs

- `02:00` backup do banco (ver [[banco-de-dados]])
- `03:00` rotação de logs
- `04:00` verificação de certificados TLS

O rate limiting da [[autenticacao]] aplica-se aqui no reverse proxy.
