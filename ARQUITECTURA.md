# Arquitectura — Mapa de Lojas

## Visão geral

```
 Browser (React)                     Vercel                                 Neon
 ─────────────────                   ─────────────────────────              ─────────────────────
 ecrã inicial = painel do     ───►   site estático (dist/)
 último mês publicado                api/index.js  ── 1 função ──────────►  PostgreSQL 16
 assistente de carregamento   ───►   (server/router.js)                     (tabelas abaixo)
 (só administradores)
```

- **Vercel**: serve a app React e uma única função Node (`api/index.js`). O `vercel.json` reencaminha `/api/*` para essa
  função e define cabeçalhos de segurança (CSP, HSTS, sem iframes).
- **Neon**: PostgreSQL com os utilizadores, as sessões, os carregamentos (versões de cada mês) e as lojas de cada mês.
- **Mesmo código nos dois lados**: `src/lib/` (leitura dos relatórios, modelo, províncias, referência, assinatura) corre
  no browser e no servidor. É isto que garante que os números do browser e do servidor são iguais.

## Ecrãs

| Rota | Quem | O quê |
|---|---|---|
| (sem sessão) | todos | Entrar (email + palavra-passe) |
| `#/` | leitor, admin | **Ecrã inicial**: painel do último mês publicado; selector de meses |
| `#/carregar` | admin | Assistente: Ficheiros → Verificar → Enviar → Publicar → Feito |
| `#/carregamentos` | admin | Histórico de versões; publicar uma validada; voltar a uma versão anterior |
| `#/utilizadores` | admin | Criar utilizadores, papel, desactivar, nova palavra-passe |

## Ciclo de vida de um carregamento

```
 criar ──► a_receber ──validar──► validado ──publicar──► publicado ──(nova versão publicada)──► substituido
              │                      │                                                          │
              └── erro ──► falhado   └── cancelar ──► cancelado              voltar a esta versão ┘ (publicar)
```

| Passo | Onde | Verificação |
|---|---|---|
| 1. Ficheiros | browser | cada relatório reconhecido pelas colunas; cópias e duplicados ignorados e listados |
| 2. Verificar | browser | modelo completo feito localmente com as lojas esperadas e os auditores **da base de dados**; mostra totais, diferenças para a versão publicada e verificações |
| 3. Enviar | browser → API | partes de ~1,2 MB, cada uma com sha256; o servidor recusa partes corrompidas; repetir uma parte é seguro; falhas de rede são repetidas automaticamente |
| 3. Validar | API | confirma que chegaram todas as partes e linhas; refaz o modelo com o mesmo código; a **assinatura** (sha256 dos totais, províncias, auditores, verificações) tem de ser igual à do browser; compara com a versão publicada; gera o pacote comprimido |
| 4. Publicar | API (transacção) | trava o mês; recusa se outra versão foi publicada depois da validação; exige confirmação se desaparecerem visitas; anterior → `substituido`, esta → `publicado` |

Garantias da base de dados:
- Índice único parcial: no máximo **1 carregamento publicado por mês**, mesmo que a app falhe.
- Tudo o que muda fica em `registo`: quem, quando e o quê.

## Lojas esperadas ("visitadas / esperadas")

As lojas esperadas de um mês são as lojas dos carregamentos **publicados dos meses anteriores**
(`carregamento_lojas`). Setembro e Outubro foram importados como `referencia`. Novembro, quando estiver publicado,
passa a contar automaticamente para Dezembro. A referência usada fica congelada no pacote de cada versão.

## Tabelas (db/migracoes/001_inicial.sql)

| Tabela | Conteúdo |
|---|---|
| `utilizadores` | email, nome, papel (admin/leitor), hash scrypt da palavra-passe, activo |
| `sessoes` | sha256 do token da sessão (o token só existe no cookie httpOnly), validade de 12 h |
| `tentativas_login` | bloqueio após 10 falhas em 15 min |
| `carregamentos` | uma versão de um mês: estado, ficheiros, resumo, assinatura, sha256 do pacote |
| `carregamento_partes` | partes recebidas, comprimidas (temporárias; apagadas ao validar) |
| `carregamento_pacote` | o pacote do painel (JSON gzip, fatias ≤ 3 MB; ~0,9 MB em Novembro) |
| `carregamento_lojas` | lojas de cada versão (base das lojas esperadas) |
| `meses` | uma linha por mês (trava a publicação) |
| `auditores` | nome + iniciais (lista inicial em `db/seed/auditores.json`; actualizada com os ficheiros brutos do BeatRoute) |
| `registo` | auditoria de todas as acções |
| `carregamento_tabelas` | (002) as 5 tabelas completas de cada versão: colunas pela ordem original, nº de linhas e páginas |
| `carregamento_tabela_paginas` | (002) páginas da API de dados: corpo JSON já comprimido (até 10 000 linhas / ~2,5 MB) |
| `api_chaves` | (002) chaves da API de dados: nome, prefixo, sha256 (a chave nunca é guardada), revogação, uso |

## API de dados (`/api/v1`)

- Autenticação por chave de API (`X-API-Key`, `Authorization: Bearer` ou `?api_key=`, que é o modo do Power BI).
  Só GET e só versões publicadas.
- O carregamento envia as 5 tabelas **completas** como `{ colunas, linhas: [[texto…]] }`. A ordem das colunas é
  a do cabeçalho do ficheiro e o servidor confirma que as colunas são desse relatório. Ao validar, o servidor grava
  as páginas já prontas (gzip). A API devolve-as sem as recalcular.
- O painel continua a usar o pacote leve (só as colunas de que o mapa precisa).
- Espaço: por mês ficam com dados completos a versão publicada e as 2 anteriores. Ao publicar, as mais antigas são
  arquivadas (`dados_arquivados`) e as validações obsoletas são canceladas.

## Segurança

- Login obrigatório para ver qualquer dado das lojas. Leitor só vê o mapa; admin carrega, publica e gere utilizadores.
- Cookie `HttpOnly; Secure; SameSite=Lax`. Pedidos que alteram dados exigem o cabeçalho `X-Requested-With` (protecção CSRF).
- SQL sempre parametrizado. Palavras-passe com scrypt e sal. Comparação em tempo constante.
- `public/` só tem o mapa das províncias. Os dados das lojas nunca são ficheiros públicos.
- `.env` (DATABASE_URL) nunca vai para o git nem para a Vercel; na Vercel define-se no painel do projecto.

## Testes (`npm test`, 29 testes)

- `tests/unidades.test.mjs`: datas, IDs, províncias, reconhecimento dos relatórios.
- `tests/dados_novembro.test.mjs`: relatórios reais. CSV = XLSX, nada se perde, estados, totais, auditores comparados
  com os ficheiros brutos, mapa simplificado = mapa oficial.
- `tests/servidor.test.mjs`: PostgreSQL real (PGlite) e API HTTP real. Referência Set/Out = ficheiro verificado;
  login, permissões e CSRF; Novembro pela API com pacote igual ao modelo local; partes em falta, corrompidas e repetidas;
  assinatura diferente; mês errado; nova versão; visitas removidas; concorrência; reverter; bloqueio do login;
  formato de pedidos da Vercel; API de dados: chaves (criar, usar, revogar), erros, e as 15 tabelas de Set/Out/Nov iguais célula a célula aos CSV originais (JSON, CSV e sem compressão), páginas abaixo de 3 MB, arquivo de versões antigas.
