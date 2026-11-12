// Textos em português e cores dos estados (paleta de estados: nunca usada só por cor — sempre com ícone + texto).

export const ESTADOS = {
  auditada: { label: 'Auditada', icon: '✓', cor: '#0ca30c', desc: 'Pelo menos uma visita com auditoria feita este mês' },
  nao_auditada: { label: 'Não auditada', icon: '✕', cor: '#d03b3b', desc: 'Visitada, mas sem auditoria (fechada, recusou, não localizada…)' },
  so_feedback: { label: 'Só feedback', icon: '!', cor: '#ec835a', desc: 'O auditor foi à loja e só deixou feedback (sem leitura de stock)' },
  por_visitar: { label: 'Por visitar', icon: '○', cor: '#898781', desc: 'Visitada em meses anteriores, ainda sem visita este mês' },
};
export const ORDEM_ESTADOS = ['auditada', 'nao_auditada', 'so_feedback', 'por_visitar'];

// Set/Out: o status do survey_visit_db era a categoria do feedback ("Done" = sem feedback = auditoria feita)
export const STATUS_PT = { 'Audit done': 'Auditoria feita', 'Audit not done': 'Auditoria não feita', Done: 'Auditoria feita' };

/** Categoria do feedback (inglês, como no survey_feedback) -> português (como no survey_feedback_cleaned) */
export const CATEGORIA_PT = {
  Other: 'Outro',
  'No Fridge': 'Não tem geleira',
  'Closed at time of visit': 'Fechado no ato da visita',
  'Temporarily closed': 'Fechado temporariamente',
  'Permanently closed': 'Fechado definitivamente',
  Refused: 'Recusado',
  'Changed activities': 'Mudou de atividades',
  'Under rehabilitation': 'Em reabilitação',
  'Closed, opens late': 'Fechado, abre tarde',
  'Delivery truck does not reach the area': 'O caminhão de entregas não chega à zona',
  'Prefers competitor brand': 'Prefere a marca da concorrência',
  'Feedback issue reported': 'Problema de feedback relatado',
  'Out of stock': 'Sem estoque',
  'Delivery delay': 'Atraso na entrega',
  'Establishment removed': 'Estabelecimento removido',
  'Refused to give price': 'Recusou-se a dar o preço',
  'Additional display': 'Expositor adicional',
  'Not sold': 'Não vendido',
  Vandalized: 'Vandalizado',
  'Low quality': 'Baixa qualidade',
};
export const categoriaPT = (c) => (c ? CATEGORIA_PT[c] ?? c : '');

export const PRATELEIRA = {
  on_shelf: { label: 'Na prateleira', cor: '#0ca30c' },
  out_of_stock: { label: 'Esgotado', cor: '#d03b3b' },
  not_stocked: { label: 'Não vende', cor: '#898781' },
  sem_leitura: { label: 'Sem leitura', cor: '#c3c2b7' },
};

/** Grupos de campos do demographic_file no painel da loja */
export const CAMPOS_LOJA = [
  ['Identificação', ['Store No', 'S.E.M. ID', 'Store Name', 'Read ID', 'Date Modified']],
  ['Classificação', ['Channel', 'Classification', 'Business Segmentation', 'Category', 'Dimension', 'Market', 'If other, specify']],
  ['Localização', ['Region', 'Province', 'District', 'Neighborhood', 'Street no.', 'Street address', 'StoreLatitude', 'StoreLongitude']],
  ['Dono / gerente', ['Owner-Manager name', 'Owner-Manager surname', 'Age', 'Gender', 'Contact no.']],
  ['Equipamento', ['Tills', 'Tills Display']],
];
