import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanId, parseDate, initialsOf, displayValue } from './_imports.mjs';
import { provinceFromReport, detectReport } from './_imports.mjs';

test('cleanId: CSV e XLSX dão o mesmo ID', () => {
  assert.equal(cleanId('23724.0'), '23724');
  assert.equal(cleanId(23724), '23724');
  assert.equal(cleanId(' 1091344 '), '1091344');
  assert.equal(cleanId(null), '');
});

test('parseDate: cada relatório com a sua ordem, sem adivinhar', () => {
  assert.equal(parseDate('2/11/2026', 'dmy'), '2026-11-02');
  assert.equal(parseDate('11/3/2026', 'mdy'), '2026-11-03');
  assert.equal(parseDate('2026-11-02', 'ymd'), '2026-11-02');
  assert.equal(parseDate('', 'dmy'), '');
  assert.throws(() => parseDate('31/2/2026', 'dmy'));
  assert.throws(() => parseDate('13/13/2026', 'dmy'));
});

test('displayValue', () => {
  assert.equal(displayValue('856655758.0'), '856655758');
  assert.equal(displayValue(856655758), '856655758');
  assert.equal(displayValue(-17.86409667), '-17.86409667');
  assert.equal(displayValue('-17.86409667'), '-17.86409667');
});

test('iniciais do auditor', () => {
  assert.equal(initialsOf('NCM20261102105900344'), 'NCM');
  assert.equal(initialsOf('AJC - Survey - 40855986'), 'AJC');
});

test('províncias dos relatórios -> mapa', () => {
  assert.equal(provinceFromReport('Maputo (City)'), 'Cidade de Maputo');
  assert.equal(provinceFromReport('Maputo (Province)'), 'Maputo');
  assert.equal(provinceFromReport('Zambézia'), 'Zambézia');
  assert.equal(provinceFromReport('Zambezia'), 'Zambézia');
  assert.equal(provinceFromReport('Cabo Delgado'), 'Cabo Delgado');
  assert.equal(provinceFromReport('Lisboa'), '');
});

test('identificação dos relatórios pelas colunas', () => {
  assert.equal(detectReport(['visit_nu', 'store_nu', 'sem_id', 'survey_date', 'status', 'survey_number']), 'visitDb');
  assert.equal(detectReport(['visit_nu', 'region', 'province', 'neighborhood', 'market', 'channel', 'store_nu', 'sem_id', 'shop_name', 'category', 'details', 'survey_date', 'survey_number'], 'survey_feedback_cleaned.csv'), 'feedbackCleaned');
  assert.equal(detectReport(['﻿Read ID', 'Store No', 'Province', 'StoreLatitude', 'StoreLongitude']), 'demographic');
  assert.equal(detectReport(['a', 'b']), null);
});
