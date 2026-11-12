-- API de dados (Power BI, etc.): tabelas completas dos relatórios + chaves de API.

-- uma linha por relatório de cada carregamento: colunas na ORDEM ORIGINAL do cabeçalho
CREATE TABLE carregamento_tabelas (
  carregamento_id uuid NOT NULL REFERENCES carregamentos(id) ON DELETE CASCADE,
  relatorio       text NOT NULL,                         -- nome do relatório (ex.: product_availability_price)
  colunas         jsonb NOT NULL,                        -- ["visit_nu", "auditor_name", ...] pela ordem do ficheiro
  linhas          integer NOT NULL CHECK (linhas >= 0),
  paginas         integer NOT NULL CHECK (paginas >= 1),
  PRIMARY KEY (carregamento_id, relatorio)
);

-- páginas já prontas a servir: corpo JSON da resposta, comprimido (gzip)
CREATE TABLE carregamento_tabela_paginas (
  carregamento_id uuid NOT NULL,
  relatorio       text NOT NULL,
  pagina          integer NOT NULL CHECK (pagina >= 1),
  linhas          integer NOT NULL CHECK (linhas >= 0),
  dados_gz        bytea NOT NULL,
  PRIMARY KEY (carregamento_id, relatorio, pagina),
  FOREIGN KEY (carregamento_id, relatorio) REFERENCES carregamento_tabelas(carregamento_id, relatorio) ON DELETE CASCADE
);

-- versões antigas: os dados pesados são apagados (fica o histórico); não se pode voltar a uma versão arquivada
ALTER TABLE carregamentos ADD COLUMN dados_arquivados boolean NOT NULL DEFAULT false;

CREATE TABLE api_chaves (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL CHECK (length(trim(nome)) > 0),   -- para quem é (ex.: "Power BI — Equipa comercial")
  prefixo       text NOT NULL,                                   -- início da chave, para a reconhecer na lista
  chave_hash    text NOT NULL UNIQUE,                            -- sha256 da chave (a chave nunca é guardada)
  criada_por    uuid REFERENCES utilizadores(id),
  criada_em     timestamptz NOT NULL DEFAULT now(),
  revogada_em   timestamptz,
  ultimo_uso    timestamptz,
  usos          bigint NOT NULL DEFAULT 0
);
