# Mapa de Lojas

Site com o mapa de Moçambique (11 províncias) e todas as lojas dos relatórios do mês.
Ao entrar, abre logo o painel do último mês publicado: lojas visitadas / esperadas por província, estado de cada loja,
auditores e a ficha completa de cada loja.
O carregamento de novos dados é um assistente só para administradores.

Como funciona por dentro: ver **[ARQUITECTURA.md](ARQUITECTURA.md)**.

## Uso no dia-a-dia

**Ver o mapa** (todos): abrir o endereço do site e entrar com email e palavra-passe.

**Carregar novos relatórios** (administrador): menu ☰ → **Carregar dados**.
1. **Ficheiros**: largue a pasta do mês (ex.: `FReport30`) ou escolha os ficheiros. Junte o `QA_WD30.xlsx` e, se quiser,
   os ficheiros brutos `response-Feedback-Report-*.csv` (nomes dos auditores).
2. **Verificar**: vê os números e as diferenças para a versão publicada. Também pode ver no mapa antes de publicar.
3. **Enviar e validar**: o servidor recebe tudo, refaz as contas e confirma que chegou aos mesmos números.
4. **Publicar**: a nova versão substitui a anterior. Se desaparecerem visitas, a app pede confirmação.

A versão anterior fica no **Histórico de carregamentos** e pode voltar a ser publicada. Cada mês guarda os dados
completos da versão publicada e das 2 anteriores; as mais antigas ficam arquivadas (só o histórico).

## API de dados (Power BI, Excel, outras ferramentas)

Quem tiver uma **chave de API** pode ler as **tabelas completas** dos meses publicados (Setembro, Outubro, Novembro…),
só leitura. São as 5 tabelas: `demographic_file`, `survey_visit_db`, `survey_feedback`, `product_availability_price`
e `Visibility_Quality`. As colunas vêm **pela ordem dos relatórios originais** e os valores vêm como texto, exactamente
como nos ficheiros. Isto está verificado por testes: as 15 tabelas (3 meses × 5) são iguais célula a célula aos CSV.

- **Chaves**: menu ☰ → **API de dados**. A chave é mostrada uma só vez e pode ser revogada a qualquer momento.
- **Power BI**: o mesmo ecrã tem o código pronto a colar (função `HeinekenTabela` + consulta que junta todos os meses).
  Credencial: **API Web** (chave). Funciona também na actualização agendada do serviço Power BI.
- **Rotas** (chave em `X-API-Key: <chave>`, `Authorization: Bearer <chave>` ou `?api_key=<chave>`):

| Rota | Devolve |
|---|---|
| `GET /api/v1/meses` | meses publicados, tabelas, nº de linhas/páginas, colunas com a posição |
| `GET /api/v1/tabelas/{tabela}?mes=AAAA-MM&pagina=N` | `{ colunas: [...], linhas: [[...]], pagina, paginas, linhas_total }` |
| `…&formato=csv` | a mesma página em CSV (UTF-8, para o Excel) |

As páginas têm até 10 000 linhas (e até ~2,5 MB). Leia as páginas 1 até `paginas`.

> Atenção: uma chave dá acesso a todos os dados, incluindo nomes e contactos dos donos das lojas. Dê uma chave por
> pessoa ou relatório e revogue as que já não forem precisas.

## Publicar o site (uma vez)

### 1. Base de dados no Neon — ✅ FEITO (12/11/2026)
Base `neondb` (Neon, PostgreSQL 18, região us-east-2): tabelas criadas (`npm run migrar`), 26 auditores,
Setembro e Outubro importados como **referência** (lojas esperadas) e Novembro **publicado**.
O endereço da base está no `.env` deste computador (nunca no GitHub).

Para refazer numa base nova:
```
copy .env.example .env          (DATABASE_URL = endereço do Neon: Dashboard → Connect)
npm install
npm run migrar                  (cria as tabelas + lista de auditores)
npm run importar -- --pasta "../Tangerine/WorkDay19/FReport19/CSV" --tipo referencia
npm run importar -- --pasta "../Tangerine/WorkDay27/FReport27/CSV" --tipo referencia
```

### 2. Criar o seu administrador (falta — só você deve escolher a palavra-passe)
```
npm run criar-admin -- o.seu.email@tangerine.co.mz "O Seu Nome"
```
Os outros utilizadores (leitores) criam-se depois no site: menu ☰ → Utilizadores.

### 3. Site na Vercel
1. Em <https://vercel.com/new> importe o repositório GitHub `Ivany23/BucketReport`.
2. **Settings → Environment Variables**: `DATABASE_URL` = o mesmo endereço do `.env`.
3. A função corre em Cleveland (`cle1`, já definido no `vercel.json`), ao lado da base Neon (Ohio).
4. Deploy. Confirme em `https://<o-seu-site>/api/saude` → `{"ok":true,...}`.

> O repositório GitHub é **público**: o `.gitignore` deixa de fora o `.env`, a lista de auditores e `dados_locais/`.
> Os dados das lojas só existem na base de dados (com login).

> O plano Hobby (gratuito) da Vercel é só para uso **pessoal, não comercial**. Para uso de trabalho, a Vercel pede o
> plano Pro.

## Testar no computador (sem publicar)

- `Abrir_Mapa.bat`, ou `npm run dev` → <http://127.0.0.1:5173>. Usa o `.env`: `DATABASE_URL` (Neon), ou
  `PGLITE_DIR=dados_locais/pg` para uma base local numa pasta.
- `npm test`: 29 testes com os relatórios reais (`HEINEKEN_DADOS=...` para outra pasta).

## Comandos

| Comando | Para quê |
|---|---|
| `npm run dev` | site + API locais |
| `npm run migrar` | criar / actualizar tabelas (seguro repetir) |
| `npm run criar-admin -- email "Nome" [admin\|leitor]` | criar utilizador pela linha de comandos |
| `npm run importar -- --pasta X [--tipo referencia] [--extra ficheiro] [--nao-publicar] [--confirmar]` | carregar uma pasta pelo mesmo fluxo do site |
| `npm test` | testes |
| `npm run preparar-mapa` | refazer o mapa das províncias a partir da fonte OCHA |
| `npm run gerar-auditores -- "C:/Users/.../Downloads" Dez2026` | actualizar `db/seed/auditores.json` com os ficheiros brutos |

## Ficheiros

- `src/`: app React. `src/lib/` é partilhado com o servidor (leitura, modelo, províncias, referência, assinatura).
- `server/`: API (router, autenticação, carregamentos, base de dados). `api/index.js` é a entrada da Vercel.
- `db/migracoes/`: tabelas. `db/seed/auditores.json`: lista inicial de auditores.
- `public/data/provincias_mz.geojson`: 11 províncias (OCHA COD-AB, CC BY-IGO). É o único ficheiro de dados público.
- `dados_locais/`: só no seu computador (não vai para o git): referência verificada e bases locais de teste.
