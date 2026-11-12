-- Mapa de Lojas — esquema inicial (PostgreSQL 16, Render)
-- Um "carregamento" = uma versão dos relatórios de um mês. Só um carregamento publicado por mês.
-- Estados: a_receber -> validado -> publicado -> substituido   (ou falhado / cancelado)

CREATE TABLE utilizadores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' in email) > 1),
  nome          text NOT NULL CHECK (length(trim(nome)) > 0),
  papel         text NOT NULL CHECK (papel IN ('admin', 'leitor')),
  senha_hash    text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessoes (
  token_hash    text PRIMARY KEY,                       -- sha256 do token do cookie (o token nunca é guardado)
  utilizador_id uuid NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL
);
CREATE INDEX sessoes_expira ON sessoes (expira_em);

CREATE TABLE tentativas_login (
  email         text NOT NULL,
  quando        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tentativas_login_email ON tentativas_login (email, quando);

CREATE TABLE carregamentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes            char(7) NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tipo           text NOT NULL DEFAULT 'mensal' CHECK (tipo IN ('mensal', 'referencia')),
  estado         text NOT NULL DEFAULT 'a_receber'
                 CHECK (estado IN ('a_receber', 'validado', 'publicado', 'substituido', 'falhado', 'cancelado')),
  criado_por     uuid REFERENCES utilizadores(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  validado_em    timestamptz,
  publicado_em   timestamptz,
  publicado_por  uuid REFERENCES utilizadores(id),
  ficheiros      jsonb NOT NULL DEFAULT '[]',            -- [{nome, tipo, linhas, partes, sha256}]
  resumo         jsonb,                                  -- totais, províncias, verificações, comparação
  assinatura     text,                                   -- sha256 dos totais (browser == servidor)
  erros          jsonb NOT NULL DEFAULT '[]',
  pacote_sha256  text,
  pacote_bytes   integer,
  pacote_partes  integer
);
-- só UMA versão publicada por mês (garantia da base de dados, não só da app)
CREATE UNIQUE INDEX carregamentos_um_publicado_por_mes ON carregamentos (mes) WHERE estado = 'publicado';
CREATE INDEX carregamentos_mes ON carregamentos (mes, criado_em DESC);

-- partes recebidas do browser (temporário: apagadas depois da validação)
CREATE TABLE carregamento_partes (
  carregamento_id uuid NOT NULL REFERENCES carregamentos(id) ON DELETE CASCADE,
  relatorio       text NOT NULL,
  parte           integer NOT NULL CHECK (parte >= 0),
  total_partes    integer NOT NULL CHECK (total_partes > 0 AND parte < total_partes),
  linhas          integer NOT NULL CHECK (linhas >= 0),
  sha256          text NOT NULL,
  dados_gz        bytea NOT NULL,
  PRIMARY KEY (carregamento_id, relatorio, parte)
);

-- pacote final do mês (JSON comprimido, em fatias <= 3 MB) — é o que o painel descarrega
CREATE TABLE carregamento_pacote (
  carregamento_id uuid NOT NULL REFERENCES carregamentos(id) ON DELETE CASCADE,
  parte           integer NOT NULL CHECK (parte >= 0),
  dados           bytea NOT NULL,
  PRIMARY KEY (carregamento_id, parte)
);

-- lojas de cada carregamento: base das "lojas esperadas" dos meses seguintes
CREATE TABLE carregamento_lojas (
  carregamento_id uuid NOT NULL REFERENCES carregamentos(id) ON DELETE CASCADE,
  store_id        text NOT NULL,
  estado          text NOT NULL DEFAULT '',
  so_pap          boolean NOT NULL DEFAULT false,        -- ficha incompleta (loja só no PAP nesse mês)
  demo            jsonb NOT NULL,
  PRIMARY KEY (carregamento_id, store_id)
);

-- um registo por mês: serve para trancar a publicação (SELECT ... FOR UPDATE)
CREATE TABLE meses (
  mes                  char(7) PRIMARY KEY,
  carregamento_publicado uuid REFERENCES carregamentos(id)
);

CREATE TABLE auditores (
  nome          text PRIMARY KEY,
  iniciais      text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- registo de tudo o que muda (quem, quando, o quê)
CREATE TABLE registo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quando        timestamptz NOT NULL DEFAULT now(),
  utilizador_id uuid REFERENCES utilizadores(id),
  acao          text NOT NULL,
  detalhe       jsonb NOT NULL DEFAULT '{}'
);
