# Revisao de telas desktop

Data: 04/10/2026.

As dimensoes abaixo foram usadas como area util do navegador, em pixels CSS,
com zoom de 100%. Isso nao equivale a testar um monitor Retina na escala nativa
do sistema operacional. A verificacao usa Chromium/Playwright e dados isolados;
nao altera os cadastros reais.

## Matriz

Cada execucao percorre uma resolucao inteira antes de passar para a seguinte.
Sao 35 telas e janelas por resolucao, cobrindo os 16 destinos do menu, login,
oferta, propostas, OS, formularios, historicos, contas a pagar e area do operador.

| Resolucao | Visualizacoes por execucao |
| --- | ---: |
| 3456 x 2234 | 35 |
| 3024 x 1964 | 35 |
| 3072 x 1920 | 35 |
| 2880 x 1864 | 35 |
| 2880 x 1800 | 35 |
| 2560 x 1664 | 35 |
| 2560 x 1600 | 35 |
| 2304 x 1440 | 35 |
| 1440 x 900 | 35 |
| 1920 x 1080 | 35 |

A rodada final concluiu 350 visualizacoes no modo claro com Arial e outras 350
no modo escuro com Verdana. Nas duas rodadas, os controles examinados ficaram
sem texto cortado, as tabelas principais sem rolagem horizontal, os modais dentro
da janela e a opcao ativa do menu dentro da area visivel.

## Ajustes

- Progresso do painel com nomes de etapas de 13px em Full HD e superiores,
  sem quebrar palavras; processos extensos distribuem etapas inteiras em linhas.
- Menu lateral limitado a altura da janela, com rolagem independente e a opcao
  ativa visivel ao navegar.
- Colunas de Maquinas distribuidas por toda a tabela.
- Estoque e pre-cadastro lado a lado em telas amplas; tabelas sem largura maxima
  desnecessaria nas demais resolucoes desktop.
- Cadastro e lista lado a lado em monitores largos.
- Configuracoes divididas em duas ou tres colunas conforme o espaco disponivel.
- Propostas A/B/C/D lado a lado nas telas amplas, com valores alinhados e
  separacao entre prazo e quantidade no resumo.
- Calculadora com colunas de materiais e medidas controladas e mais formatos
  por linha quando ha espaco.
- Melhor distribuicao do resumo financeiro, grupos de etapas e informacoes
  do operador em monitores amplos.
- Fonte da conta: Arial original, fonte do sistema, Verdana ou Tahoma.
  A preferencia persiste no servidor e no navegador, separada por conta.

## Reproducao

Primeiro execute `npm run build`. Os testes de navegador usam o build em `dist`.

```sh
node tests/resolution-audit.browser.mjs
node tests/resolution-audit.browser.mjs --verdana --dark
node tests/account-font.browser.mjs
node tests/panel-fullhd.browser.mjs
node tests/mobile-experience.browser.mjs --verdana --large-font --dark
node --test tests/account-appearance.test.js
```

O teste de resolucoes mede transbordamento da pagina, texto cortado em botoes e
titulos, largura das tabelas principais, posicao da navegacao ativa e limites
dos modais. As capturas e medicoes ficam em `test-results/resolutions-*`.
Use `--only=1920x1080` para investigar uma dimensao ou `--before` para registrar
problemas sem interromper a coleta.

A verificacao adicional de fontes cobre as 16 telas de menu com cada familia
alternativa, os tamanhos pequena/grande, falha de salvamento, recarregamento e
isolamento entre contas. O teste mobile usa WebKit em iPhone 15 e 15 Pro Max.

## Limites

Nao se trata de validacao em monitores fisicos ou de todas as combinacoes
possiveis de dados e zoom. Formularios longos continuam permitindo rolagem
vertical, sem esconder campos para caber artificialmente na tela.

A suite geral `npm test` tem uma falha preexistente em `tests/reports.test.js:85`:
o periodo termina em 03/10/2026, mas a sessao de trabalho usa a data atual.
Em 04/10/2026, 71 dos 72 testes passam. Nenhuma regra de relatorio foi alterada.
