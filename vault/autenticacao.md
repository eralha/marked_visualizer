# Autenticação

Sistema de login com JWT e refresh tokens.

## Fluxo

1. O utilizador envia credenciais para `POST /login` (ver [[api-rest]])
2. O servidor valida contra o [[banco-de-dados]]
3. Emite um access token curto + refresh token longo
4. O cliente guarda o refresh em `localStorage` e o access em memória

## Segurança

- Hash de passwords com **argon2**
- Rate limiting por IP (ver [[deploy]])
- Rotatividade de tokens a cada 15 minutos

Ver também: [[auditoria-seguranca]]
