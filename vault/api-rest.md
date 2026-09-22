# API REST

Endpoints públicos da aplicação.

## Autenticação

- `POST /login` — ver [[autenticacao]]
- `POST /refresh`
- `GET /me`

## Dados

- `GET /notes` — lista de notas (fonte: [[banco-de-dados]])
- `GET /notes/:id`
- `POST /notes`

Todas as respostas seguem o envelope `{ data, error }`.
