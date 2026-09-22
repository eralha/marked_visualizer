# Banco de Dados

PostgreSQL 16 como base principal.

## Esquema

| Tabela | Descrição |
| --- | --- |
| `users` | utilizadores e credenciais (ver [[autenticacao]]) |
| `sessions` | tokens ativos |
| `events` | log de auditoria |

## Migrações

- Usa-se `knex migrate:latest` no arranque do serviço
- As migrações vivem em `db/migrations`

## Backup

O dump noturno corre como cron job no [[deploy]].
