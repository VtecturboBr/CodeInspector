// 1. Tipos usados pelo analisador
interface Posicao {
  linha: number;
  coluna: number;
}

interface DelimitadorAberto extends Posicao {
  simbolo: string;
  indice: number;
}

interface Erro extends Posicao {
  mensagem: string;
  indice: number;
  tipo?: string;
  aspas?: string;
}

interface Analise {
  erros: Erro[];
  codigoLimpo: string;
}

interface IndicadorErro {
  textoLinha: string;
  espacosAteErro: string;
}

interface DeclaracaoEscopo {
  nome: string;
  inicio: number;
  fim: number;
}

interface NomesDefinidos {
  nomes: Set<string>;
  propriedades: Set<string>;
  declaracoesComEscopo?: DeclaracaoEscopo[];
  codigoLimpo: string;
}

interface ContextoTemplate {
  profundidadeChaves: number;
  linhaInicio: number;
  colunaInicio: number;
  inicio: number;
}

interface TokenLexico {
  tipo: "comentario" | "string" | "template";
  inicio: number;
  fim: number;
  texto: string;
}

interface ScanResultado {
  codigoLimpo: string;
  erros: Erro[];
  tokens: TokenLexico[];
}

interface DadosLinhaCache {
  textoLinha: string;
  inicioLinha: number;
}

// 2. Elementos da página
function obterElemento<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);

  if (!elemento) {
    throw new Error(`Elemento #${id} não encontrado.`);
  }

  return elemento as T;
}

const campoCodigo = obterElemento<HTMLTextAreaElement>("codigo");
const botaoAnalisar = obterElemento<HTMLButtonElement>("botao-analisar");
const painelResultado = obterElemento<HTMLElement>("painel-resultado");
const resumoResultado = obterElemento<HTMLParagraphElement>("resumo-resultado");
const listaErros = obterElemento<HTMLUListElement>("lista-erros");
const editorCodigo = obterElemento<HTMLElement>("editor-codigo");
const camadaDestaque = obterElemento<HTMLPreElement>("camada-destaque");
const codigoDestacado = obterElemento<HTMLElement>("codigo-destacado");
const codigoAnalise = obterElemento<HTMLElement>("codigo-analise");


// 3. Pares de delimitadores, padrões compilados e regras de destaque
const pares: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const padraoNumeros = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n?|\d[\d_]*n|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?/;
const padraoPalavras = /[\p{ID_Continue}$\u200c\u200d]+/u;

const palavrasReservadas = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
  "finally", "for", "function", "if", "implements", "import", "in",
  "instanceof", "interface", "let", "new", "null", "package", "private",
  "protected", "public", "return", "static", "super", "switch", "this",
  "throw", "try", "typeof", "var", "void", "while", "with", "yield"
]);

// 4. Scanner Léxico: Reconhece comentários, strings, RegExp e interpolações de template
function ehInicioRegExp(codigo: string, indice: number): boolean {
  let j = indice - 1;
  while (j >= 0 && /\s/.test(codigo[j])) j--;
  if (j < 0) return true;
  const char = codigo[j];
  if ((char === "+" && codigo[j - 1] === "+") || (char === "-" && codigo[j - 1] === "-")) return false;
  if ("(,;:[{=!?&|+-*%/^~<>}".includes(char)) return true;
  if (/[\w$]/.test(char)) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(codigo[k])) k--;
    const palavra = codigo.slice(k + 1, j + 1);
    const palavrasExpressao = new Set([
      "return", "case", "throw", "yield", "await", "delete",
      "void", "typeof", "instanceof", "in", "of", "else", "default", "do"
    ]);
    if (palavrasExpressao.has(palavra)) return true;
  }
  return false;
}

function escanearCodigo(codigo: string): ScanResultado {
  let codigoLimpo = "";
  const erros: Erro[] = [];
  const tokens: TokenLexico[] = [];
  let linha = 1;
  let coluna = 0;
  let indice = 0;
  const pilhaTemplates: ContextoTemplate[] = [];

  while (indice < codigo.length) {
    const caractere = codigo[indice];
    const proximo = codigo[indice + 1];

    if ("\r\n\u2028\u2029".includes(caractere)) {
      codigoLimpo += caractere;
      coluna = 0;
      linha++;
      if (caractere === "\r" && proximo === "\n") {
        codigoLimpo += "\n";
        indice += 2;
        continue;
      }
      indice++;
      continue;
    }

    coluna++;

    // Linha de comentário //
    if (caractere === "/" && proximo === "/") {
      const inicio = indice;
      while (indice < codigo.length && !"\r\n\u2028\u2029".includes(codigo[indice])) {
        indice++;
      }
      const len = indice - inicio;
      codigoLimpo += " ".repeat(len);
      tokens.push({ tipo: "comentario", inicio, fim: indice, texto: codigo.slice(inicio, indice) });
      coluna += len - 1;
      continue;
    }

    // Comentário de bloco /* ... */
    if (caractere === "/" && proximo === "*") {
      const linhaInicio = linha;
      const colunaInicio = coluna;
      const inicio = indice;
      indice += 2;
      coluna++;
      let fechado = false;
      let espacos = "  ";

      while (indice < codigo.length) {
        const c = codigo[indice];
        if (c === "*" && codigo[indice + 1] === "/") {
          indice += 2;
          coluna += 2;
          fechado = true;
          espacos += "  ";
          break;
        }
        if ("\r\n\u2028\u2029".includes(c)) {
          codigoLimpo += espacos + c;
          espacos = "";
          linha++;
          coluna = 0;
          if (c === "\r" && codigo[indice + 1] === "\n") {
            codigoLimpo += "\n";
            indice += 2;
            continue;
          }
          indice++;
          continue;
        }
        espacos += " ";
        indice++;
        coluna++;
      }

      codigoLimpo += espacos;
      if (!fechado) {
        erros.push({
          tipo: "comentario_bloco",
          mensagem: `Comentário de bloco iniciado na linha ${linhaInicio}, coluna ${colunaInicio}, mas não finalizado.`,
          indice: inicio,
          linha: linhaInicio,
          coluna: colunaInicio
        });
        break;
      }
      tokens.push({ tipo: "comentario", inicio, fim: indice, texto: codigo.slice(inicio, indice) });
      continue;
    }

    // Strings simples com aspas duplas ou simples
    if (caractere === '"' || caractere === "'") {
      const aspas = caractere;
      const linhaInicio = linha;
      const colunaInicio = coluna;
      const inicio = indice;
      indice++;
      let fechado = false;
      let espacos = " ";

      while (indice < codigo.length) {
        const c = codigo[indice];
        if (c === "\\") {
          const proximoC = codigo[indice + 1];
          if (proximoC === "\r" && codigo[indice + 2] === "\n") {
            espacos += " ";
            codigoLimpo += espacos + "\r\n";
            espacos = "";
            indice += 3;
            linha++;
            coluna = 0;
            continue;
          } else if (proximoC === "\n" || proximoC === "\r" || proximoC === "\u2028" || proximoC === "\u2029") {
            espacos += " ";
            codigoLimpo += espacos + proximoC;
            espacos = "";
            indice += 2;
            linha++;
            coluna = 0;
            continue;
          } else {
            espacos += "  ";
            indice += 2;
            coluna += 2;
            continue;
          }
        }
        if ("\r\n\u2028\u2029".includes(c)) {
          break;
        }
        espacos += " ";
        indice++;
        coluna++;
        if (c === aspas) {
          fechado = true;
          break;
        }
      }

      codigoLimpo += espacos;
      if (!fechado) {
        erros.push({
          tipo: "string",
          mensagem: `String sem fechamento em ${formatarPosicao({ linha: linhaInicio, coluna: colunaInicio })}. `
            + `Esperado “${aspas}”. Corrija a string para continuar a análise.`,
          indice: inicio,
          linha: linhaInicio,
          coluna: colunaInicio,
          aspas
        });
        break;
      }
      tokens.push({ tipo: "string", inicio, fim: indice, texto: codigo.slice(inicio, indice) });
      continue;
    }

    // Template literals com crase
    if (caractere === "`") {
      const linhaInicio = linha;
      const colunaInicio = coluna;
      const inicio = indice;
      indice++;
      codigoLimpo += " ";

      let fechado = false;
      while (indice < codigo.length) {
        const c = codigo[indice];
        if (c === "\\") {
          codigoLimpo += "  ";
          indice += 2;
          coluna += 2;
          continue;
        }
        if (c === "`") {
          codigoLimpo += " ";
          indice++;
          coluna++;
          fechado = true;
          tokens.push({ tipo: "string", inicio, fim: indice, texto: codigo.slice(inicio, indice) });
          break;
        }
        if (c === "$" && codigo[indice + 1] === "{") {
          tokens.push({ tipo: "string", inicio, fim: indice, texto: codigo.slice(inicio, indice) });
          codigoLimpo += "  ";
          indice += 2;
          coluna += 2;
          pilhaTemplates.push({
            profundidadeChaves: 0,
            linhaInicio,
            colunaInicio,
            inicio
          });
          break;
        }
        if ("\r\n\u2028\u2029".includes(c)) {
          codigoLimpo += c;
          linha++;
          coluna = 0;
          if (c === "\r" && codigo[indice + 1] === "\n") {
            codigoLimpo += "\n";
            indice += 2;
            continue;
          }
          indice++;
          continue;
        }
        codigoLimpo += " ";
        indice++;
        coluna++;
      }

      if (!fechado && pilhaTemplates.length === 0) {
        erros.push({
          tipo: "string",
          mensagem: `String sem fechamento em ${formatarPosicao({ linha: linhaInicio, coluna: colunaInicio })}. `
            + `Esperado “\`”. Corrija a string para continuar a análise.`,
          indice: inicio,
          linha: linhaInicio,
          coluna: colunaInicio,
          aspas: "`"
        });
        break;
      }
      continue;
    }

    // Fechamento de interpolação } dentro de template
    if (caractere === "}" && pilhaTemplates.length > 0) {
      const topo = pilhaTemplates[pilhaTemplates.length - 1];
      if (topo.profundidadeChaves === 0) {
        pilhaTemplates.pop();
        codigoLimpo += " ";
        indice++;
        const inicioTemplateTexto = indice;

        let fechado = false;
        while (indice < codigo.length) {
          const c = codigo[indice];
          if (c === "\\") {
            codigoLimpo += "  ";
            indice += 2;
            coluna += 2;
            continue;
          }
          if (c === "`") {
            codigoLimpo += " ";
            indice++;
            coluna++;
            fechado = true;
            tokens.push({ tipo: "string", inicio: inicioTemplateTexto, fim: indice, texto: codigo.slice(inicioTemplateTexto, indice) });
            break;
          }
          if (c === "$" && codigo[indice + 1] === "{") {
            tokens.push({ tipo: "string", inicio: inicioTemplateTexto, fim: indice, texto: codigo.slice(inicioTemplateTexto, indice) });
            codigoLimpo += "  ";
            indice += 2;
            coluna += 2;
            pilhaTemplates.push(topo);
            break;
          }
          if ("\r\n\u2028\u2029".includes(c)) {
            codigoLimpo += c;
            linha++;
            coluna = 0;
            if (c === "\r" && codigo[indice + 1] === "\n") {
              codigoLimpo += "\n";
              indice += 2;
              continue;
            }
            indice++;
            continue;
          }
          codigoLimpo += " ";
          indice++;
          coluna++;
        }

        if (!fechado && pilhaTemplates.length === 0) {
          erros.push({
            tipo: "string",
            mensagem: `String sem fechamento em ${formatarPosicao({ linha: topo.linhaInicio, coluna: topo.colunaInicio })}. `
              + `Esperado “\`”. Corrija a string para continuar a análise.`,
            indice: topo.inicio,
            linha: topo.linhaInicio,
            coluna: topo.colunaInicio,
            aspas: "`"
          });
          break;
        }
        continue;
      } else {
        topo.profundidadeChaves--;
        codigoLimpo += caractere;
        indice++;
        continue;
      }
    }

    if (caractere === "{" && pilhaTemplates.length > 0) {
      pilhaTemplates[pilhaTemplates.length - 1].profundidadeChaves++;
      codigoLimpo += caractere;
      indice++;
      continue;
    }

    // RegExp Literal /.../
    if (caractere === "/" && ehInicioRegExp(codigo, indice)) {
      let k = indice + 1;
      let dentroClasse = false;
      let fechado = false;

      while (k < codigo.length) {
        const c = codigo[k];
        if ("\r\n\u2028\u2029".includes(c)) break;
        if (c === "\\") {
          k += 2;
          continue;
        }
        if (c === "[") {
          dentroClasse = true;
          k++;
          continue;
        }
        if (c === "]") {
          dentroClasse = false;
          k++;
          continue;
        }
        if (c === "/" && !dentroClasse) {
          k++;
          fechado = true;
          while (k < codigo.length && /[a-z]/i.test(codigo[k])) {
            k++;
          }
          break;
        }
        k++;
      }

      if (fechado) {
        const tam = k - indice;
        codigoLimpo += " ".repeat(tam);
        tokens.push({ tipo: "string", inicio: indice, fim: k, texto: codigo.slice(indice, k) });
        coluna += tam - 1;
        indice = k;
        continue;
      }
    }

    codigoLimpo += caractere;
    indice++;
  }

  if (pilhaTemplates.length > 0 && erros.length === 0) {
    const topo = pilhaTemplates[0];
    erros.push({
      tipo: "string",
      mensagem: `String sem fechamento em ${formatarPosicao({ linha: topo.linhaInicio, coluna: topo.colunaInicio })}. `
        + `Esperado “\`”. Corrija a string para continuar a análise.`,
      indice: topo.inicio,
      linha: topo.linhaInicio,
      coluna: topo.colunaInicio,
      aspas: "`"
    });
  }

  return { codigoLimpo, erros, tokens };
}

function ignorarStringsEComentarios(codigo: string): string {
  return escanearCodigo(codigo).codigoLimpo;
}

function formatarPosicao(posicao: Posicao): string {
  return `linha ${posicao.linha}, coluna ${posicao.coluna}`;
}

// 5. Criação do indicador de erro com cache de linhas (O(1) após primeiro acesso)
const cacheLinhasGlobal = new Map<number, DadosLinhaCache>();

function criarIndicadorErro(
  codigo: string,
  erro: Erro,
  cacheLinhas: Map<number, DadosLinhaCache> = cacheLinhasGlobal
): IndicadorErro {
  let dadosLinha = cacheLinhas.get(erro.linha);
  if (!dadosLinha) {
    let inicioLinha = erro.indice;
    let fimLinha = erro.indice;

    while (inicioLinha > 0 && !"\r\n\u2028\u2029".includes(codigo[inicioLinha - 1])) {
      inicioLinha--;
    }

    while (fimLinha < codigo.length && !"\r\n\u2028\u2029".includes(codigo[fimLinha])) {
      fimLinha++;
    }

    dadosLinha = {
      textoLinha: codigo.slice(inicioLinha, fimLinha),
      inicioLinha
    };
    cacheLinhas.set(erro.linha, dadosLinha);
  }

  return {
    textoLinha: dadosLinha.textoLinha,
    espacosAteErro: codigo.slice(dadosLinha.inicioLinha, erro.indice).replace(/[^\t]/g, " ")
  };
}

function stringEstaFechada(texto: string): boolean {
  if (texto.length < 2 || !texto.endsWith(texto[0])) {
    return false;
  }

  let barras = 0;
  for (let indice = texto.length - 2; indice >= 0 && texto[indice] === "\\"; indice--) {
    barras++;
  }

  return barras % 2 === 0;
}

function encontrarStringIncompleta(codigo: string): { indice: number; aspas: string } | undefined {
  const analise = escanearCodigo(codigo);
  const erroString = analise.erros.find(e => e.tipo === "string");
  if (erroString && erroString.aspas) {
    return { indice: erroString.indice, aspas: erroString.aspas };
  }
}

// 6. Análise com pilha LIFO
function analisarCodigo(codigo: string): Analise {
  cacheLinhasGlobal.clear();
  const scan = escanearCodigo(codigo);
  const codigoLimpo = scan.codigoLimpo;
  const pilha: DelimitadorAberto[] = [];
  const erros: Erro[] = [...scan.erros];

  if (erros.length > 0) {
    return { erros, codigoLimpo };
  }

  let linha = 1;
  let coluna = 0;

  for (let indice = 0; indice < codigoLimpo.length; indice++) {
    const caractere = codigoLimpo[indice];
    coluna++;

    if ("\r\n\u2028\u2029".includes(caractere)) {
      if (caractere === "\r" && codigoLimpo[indice + 1] === "\n") {
        indice++;
      }
      linha++;
      coluna = 0;
      continue;
    }

    if (pares[caractere]) {
      pilha.push({ simbolo: caractere, indice, linha, coluna });
      continue;
    }

    if (!")]}".includes(caractere)) {
      continue;
    }

    const abertura = pilha.pop();
    const posicao = formatarPosicao({ linha, coluna });

    if (!abertura) {
      erros.push({
        mensagem: `“${caractere}” sem abertura correspondente em ${posicao}.`,
        indice,
        linha,
        coluna
      });
    } else if (caractere !== pares[abertura.simbolo]) {
      erros.push({
        mensagem: `“${caractere}” incompatível em ${posicao}. `
          + `Esperado “${pares[abertura.simbolo]}” para “${abertura.simbolo}” `
          + `aberto em ${formatarPosicao(abertura)}.`,
        indice,
        linha,
        coluna
      });
    }
  }

  for (const abertura of pilha) {
    erros.push({
      mensagem: `“${abertura.simbolo}” sem fechamento correspondente `
        + `em ${formatarPosicao(abertura)}. Esperado “${pares[abertura.simbolo]}”.`,
      indice: abertura.indice,
      linha: abertura.linha,
      coluna: abertura.coluna
    });
  }

  return {
    erros: erros.sort((primeiro, segundo) => primeiro.indice - segundo.indice),
    codigoLimpo
  };
}

// 7. Extração de Identificadores, Parâmetros e Escopos
function extrairVinculosDestruturacao(
  texto: string,
  nomes: Set<string>,
  propriedades: Set<string>,
  escopoAtual?: DeclaracaoEscopo | null,
  declaracoesComEscopo?: DeclaracaoEscopo[]
): void {
  let i = 0;
  while (i < texto.length) {
    while (i < texto.length && /[\s,;]/.test(texto[i])) i++;
    if (i >= texto.length) break;

    if (texto.slice(i, i + 3) === "...") {
      i += 3;
      while (i < texto.length && /\s/.test(texto[i])) i++;
    }

    if (texto[i] === "{" || texto[i] === "[") {
      i++;
      continue;
    }
    if (texto[i] === "}" || texto[i] === "]") {
      i++;
      continue;
    }

    const match = texto.slice(i).match(/^([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)/u);
    if (!match) {
      i++;
      continue;
    }

    const id = match[1];
    i += id.length;

    let j = i;
    while (j < texto.length && /\s/.test(texto[j])) j++;

    if (j < texto.length && texto[j] === ":") {
      propriedades.add(id);
      i = j + 1;
      continue;
    }

    if (!palavrasReservadas.has(id)) {
      nomes.add(id);
      propriedades.add(id);
      if (declaracoesComEscopo) {
        declaracoesComEscopo.push({
          nome: id,
          inicio: escopoAtual ? escopoAtual.inicio : 0,
          fim: escopoAtual ? escopoAtual.fim : Infinity
        });
      }
    }

    if (j < texto.length && texto[j] === "=") {
      i = j + 1;
      let nivel = 0;
      while (i < texto.length) {
        const c = texto[i];
        if ("([{".includes(c)) nivel++;
        else if (")]}".includes(c)) {
          if (nivel === 0) break;
          nivel--;
        } else if (c === "," && nivel === 0) {
          break;
        }
        i++;
      }
    }
  }
}

function encontrarNomesDefinidos(codigo: string, codigoLimpoPreexistente?: string): NomesDefinidos {
  const codigoLimpo = codigoLimpoPreexistente ?? ignorarStringsEComentarios(codigo);
  const nomes = new Set<string>();
  const propriedades = new Set<string>();
  const declaracoesComEscopo: DeclaracaoEscopo[] = [];

  const escoposFuncao: DeclaracaoEscopo[] = [];
  const padraoBlocosFuncao = /\b(?:function\b\s*\*?\s*[\p{ID_Start}$_]?[\p{ID_Continue}$\u200c\u200d]*\s*\([^)]*\)|\([^)]*\)\s*=>|[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*\s*=>)\s*\{/gu;
  for (const m of codigoLimpo.matchAll(padraoBlocosFuncao)) {
    const inicioBloco = (m.index ?? 0) + m[0].length - 1;
    let nivel = 1;
    let fimBloco = inicioBloco + 1;
    while (fimBloco < codigoLimpo.length && nivel > 0) {
      if (codigoLimpo[fimBloco] === "{") nivel++;
      else if (codigoLimpo[fimBloco] === "}") nivel--;
      fimBloco++;
    }
    escoposFuncao.push({ nome: "bloco", inicio: inicioBloco, fim: fimBloco - 1 });
  }

  function obterEscopoParaIndice(indice: number): DeclaracaoEscopo | null {
    for (const escopo of escoposFuncao) {
      if (indice >= escopo.inicio && indice <= escopo.fim) {
        return escopo;
      }
    }
    return null;
  }

  const padraoVar = /\b(?:const|let|var)\s+([^;\r\n]+)/g;
  for (const match of codigoLimpo.matchAll(padraoVar)) {
    const escopo = obterEscopoParaIndice(match.index ?? 0);
    let inicio = 0;
    let fimNome = -1;
    let nivel = 0;
    const texto = match[1];

    for (let indice = 0; indice <= texto.length; indice++) {
      const caractere = texto[indice];
      if (indice === texto.length || (caractere === "," && nivel === 0)) {
        extrairVinculosDestruturacao(
          texto.slice(inicio, fimNome < 0 ? indice : fimNome),
          nomes,
          propriedades,
          escopo,
          declaracoesComEscopo
        );
        inicio = indice + 1;
        fimNome = -1;
      } else if (caractere === "=" && nivel === 0 && fimNome < 0) {
        fimNome = indice;
      } else if ("([{".includes(caractere)) {
        nivel++;
      } else if (")]}".includes(caractere)) {
        nivel = Math.max(0, nivel - 1);
      }
    }
  }

  const padraoFuncaoClasse = /\b(?:function\b\s*\*?|class\b)\s*([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)/gu;
  for (const m of codigoLimpo.matchAll(padraoFuncaoClasse)) {
    nomes.add(m[1]);
    declaracoesComEscopo.push({ nome: m[1], inicio: 0, fim: Infinity });
  }

  const padraoCabecalhoFuncao = /\bfunction\b\s*\*?\s*(?:[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)?\s*\(/gu;
  for (const m of codigoLimpo.matchAll(padraoCabecalhoFuncao)) {
    const inicioParen = (m.index ?? 0) + m[0].length - 1;
    let nivel = 1;
    let fimParen = inicioParen + 1;
    while (fimParen < codigoLimpo.length && nivel > 0) {
      if (codigoLimpo[fimParen] === "(") nivel++;
      else if (codigoLimpo[fimParen] === ")") nivel--;
      fimParen++;
    }
    if (nivel === 0) {
      const listaParams = codigoLimpo.slice(inicioParen + 1, fimParen - 1);
      const escopo = obterEscopoParaIndice(fimParen);
      extrairVinculosDestruturacao(listaParams, nomes, propriedades, escopo, declaracoesComEscopo);
    }
  }

  const padraoArrow = /\(([^)]*)\)\s*=>|([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)\s*=>/gu;
  for (const m of codigoLimpo.matchAll(padraoArrow)) {
    const params = m[1] ?? m[2];
    const escopo = obterEscopoParaIndice((m.index ?? 0) + m[0].length);
    extrairVinculosDestruturacao(params, nomes, propriedades, escopo, declaracoesComEscopo);
  }

  const padraoMetodos = /([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)\s*\(([^()]*)\)\s*\{/gu;
  for (const m of codigoLimpo.matchAll(padraoMetodos)) {
    if (!palavrasReservadas.has(m[1]) && m[1] !== "constructor") {
      nomes.add(m[1]);
      propriedades.add(m[1]);
    }
    extrairVinculosDestruturacao(m[2], nomes, propriedades, obterEscopoParaIndice(m.index ?? 0), declaracoesComEscopo);
  }

  const padraoCamposClasse = /(?:[{;\r\n]\s*)([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)\s*=/gu;
  for (const m of codigoLimpo.matchAll(padraoCamposClasse)) {
    if (!palavrasReservadas.has(m[1])) {
      propriedades.add(m[1]);
    }
  }

  const padraoCamposObjeto = /(?:[{,]\s*)([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)\s*(?:[:=,}]|$)/gu;
  for (const m of codigoLimpo.matchAll(padraoCamposObjeto)) {
    if (!palavrasReservadas.has(m[1])) {
      propriedades.add(m[1]);
    }
  }

  return { nomes, propriedades, declaracoesComEscopo, codigoLimpo };
}

function nomeFoiDefinido(texto: string, indice: number, definidos: NomesDefinidos): boolean {
  const codigo = definidos.codigoLimpo;
  let anterior = indice - 1;
  while (anterior >= 0 && /\s/.test(codigo[anterior])) anterior--;

  if (codigo[anterior] === "." && codigo.slice(anterior - 2, anterior + 1) !== "...") {
    let fimDono = anterior - 1;
    while (fimDono >= 0 && /[\s?]/.test(codigo[fimDono])) fimDono--;
    let inicioDono = fimDono;
    while (inicioDono >= 0 && /[\p{ID_Continue}$\u200c\u200d]/u.test(codigo[inicioDono])) inicioDono--;
    const dono = codigo.slice(inicioDono + 1, fimDono + 1);
    return definidos.propriedades.has(texto) && (definidos.nomes.has(dono) || dono === "this");
  }

  if (definidos.propriedades.has(texto)) {
    if (definidos.declaracoesComEscopo) {
      const declaracaoLocal = definidos.declaracoesComEscopo.find(d => d.nome === texto && d.fim !== Infinity);
      if (declaracaoLocal && (indice < declaracaoLocal.inicio || indice > declaracaoLocal.fim)) {
        let proximo = indice + texto.length;
        while (proximo < codigo.length && /\s/.test(codigo[proximo])) proximo++;
        if (codigo[proximo] === ":" || codigo[proximo] === "=" || codigo[anterior] === "{" || codigo[anterior] === ",") {
          return true;
        }
        return false;
      }
    }
    return true;
  }

  if (definidos.declaracoesComEscopo) {
    const match = definidos.declaracoesComEscopo.find(
      d => d.nome === texto && indice >= d.inicio && indice <= d.fim
    );
    if (match) return true;
    if (definidos.declaracoesComEscopo.some(d => d.nome === texto)) {
      return false;
    }
  }

  return definidos.nomes.has(texto);
}

// 8. Destaque de Sintaxe no Editor
const padraoDestaques = new RegExp(
  [
    /\/\*[\s\S]*?(?:\*\/|$)/.source,
    /\/\/[^\r\n\u2028\u2029]*/.source,
    /"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n\u2028\u2029])*"?/.source,
    /'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n\u2028\u2029])*'?/.source,
    /`(?:\\[\s\S]|[^`\\])*`?/.source,
    padraoNumeros.source,
    padraoPalavras.source
  ].join("|"),
  "gu"
);

function destacarCodigo(codigo: string, codigoLimpoPreexistente?: string): void {
  const fragmento = document.createDocumentFragment();
  const definidos = encontrarNomesDefinidos(codigo, codigoLimpoPreexistente);
  let inicio = 0;

  for (const trecho of codigo.matchAll(padraoDestaques)) {
    const texto = trecho[0];
    let classe = "";

    if (/^["'`]/.test(texto)) {
      classe = stringEstaFechada(texto) ? "string" : "";
    } else if (/^(?:\d|\.\d)/.test(texto)) {
      classe = "numero";
    } else if (texto === "true" || texto === "false") {
      classe = "booleano";
    } else if (palavrasReservadas.has(texto)) {
      classe = "palavra-reservada";
    } else if (nomeFoiDefinido(texto, trecho.index ?? 0, definidos)) {
      classe = "identificador";
    }

    if (!classe) {
      continue;
    }

    fragmento.append(document.createTextNode(codigo.slice(inicio, trecho.index)));

    const destaque = document.createElement("span");
    destaque.className = classe;
    destaque.textContent = texto;
    fragmento.append(destaque);

    inicio = (trecho.index ?? 0) + texto.length;
  }

  fragmento.append(document.createTextNode(codigo.slice(inicio) + "\n "));
  codigoDestacado.replaceChildren(fragmento);
}

function sincronizarRolagem(): void {
  camadaDestaque.scrollTop = campoCodigo.scrollTop;
  camadaDestaque.scrollLeft = campoCodigo.scrollLeft;
}

function atualizarEstatisticas(): void {
  const contadorLinhas = document.getElementById("contador-linhas");
  const contadorCaracteres = document.getElementById("contador-caracteres");
  const codigo = campoCodigo.value;

  if (contadorLinhas) {
    const totalLinhas = codigo ? codigo.split(/\r\n|\r|\n/).length : 1;
    contadorLinhas.textContent = `${totalLinhas} ${totalLinhas === 1 ? "linha" : "linhas"}`;
  }

  if (contadorCaracteres) {
    contadorCaracteres.textContent = `${codigo.length} caracteres`;
  }
}

// 9. Exibição Otimizada do Resultado com Fragmento e Limite de Renderização
function limparResultado(): void {
  painelResultado.className = "resultado neutro";
  resumoResultado.textContent = "Aguardando análise";
  listaErros.replaceChildren();
  listaErros.hidden = true;
}

function atualizarEditor(): void {
  const codigo = campoCodigo.value;
  limparResultado();
  destacarCodigo(codigo);
  sincronizarRolagem();
  atualizarEstatisticas();
}

function mostrarResultado(): void {
  const codigo = campoCodigo.value;
  limparResultado();

  if (codigo.trim() === "") {
    destacarCodigo(codigo);
    sincronizarRolagem();
    resumoResultado.textContent = "Digite um código para analisar";
    return;
  }

  const analise = analisarCodigo(codigo);
  destacarCodigo(codigo, analise.codigoLimpo);
  sincronizarRolagem();
  painelResultado.className = `resultado ${analise.erros.length ? "erro" : "sucesso"}`;

  if (analise.erros.length === 0) {
    resumoResultado.textContent = "Nenhum erro de delimitadores foi encontrado.";
    return;
  }

  resumoResultado.textContent = analise.erros.length === 1
    ? "1 erro encontrado:"
    : `${analise.erros.length} erros encontrados:`;

  const fragmento = document.createDocumentFragment();
  const limiteMaximoVisual = 100;
  const totalErros = analise.erros.length;
  const errosParaRenderizar = analise.erros.slice(0, limiteMaximoVisual);
  const cacheLinhas = new Map<number, DadosLinhaCache>();

  for (const erro of errosParaRenderizar) {
    const item = document.createElement("li");
    const mensagem = document.createElement("p");
    mensagem.textContent = erro.mensagem;

    const indicador = criarIndicadorErro(codigo, erro, cacheLinhas);
    const localizacao = document.createElement("pre");
    const linha = document.createElement("code");
    const numeroLinha = String(erro.linha);
    const margem = " ".repeat(numeroLinha.length);

    linha.textContent = `${numeroLinha} | ${indicador.textoLinha}\n${margem} | ${indicador.espacosAteErro}\u2191 aqui`;
    localizacao.className = "localizacao-erro";
    localizacao.setAttribute("aria-label", `Local do erro: linha ${erro.linha}, coluna ${erro.coluna}`);
    localizacao.append(linha);
    item.append(mensagem, localizacao);
    fragmento.append(item);
  }

  if (totalErros > limiteMaximoVisual) {
    const itemMais = document.createElement("li");
    const aviso = document.createElement("p");
    aviso.textContent = `... e mais ${totalErros - limiteMaximoVisual} erros detectados. Corrija os primeiros erros para continuar.`;
    itemMais.append(aviso);
    fragmento.append(itemMais);
  }

  listaErros.append(fragmento);
  listaErros.hidden = false;
}

// 10. Eventos e Código do Algoritmo para Apresentação
botaoAnalisar.addEventListener("click", mostrarResultado);
campoCodigo.addEventListener("input", atualizarEditor);
campoCodigo.addEventListener("scroll", sincronizarRolagem);

campoCodigo.addEventListener("keydown", evento => {
  if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") {
    evento.preventDefault();
    mostrarResultado();
  }
});

const botaoExemploSucesso = document.getElementById("botao-exemplo-sucesso");
const botaoExemploErro = document.getElementById("botao-exemplo-erro");
const botaoLimpar = document.getElementById("botao-limpar");
const botaoCopiar = document.getElementById("botao-copiar");
const botaoCopiarAlgoritmo = document.getElementById("botao-copiar-algoritmo");

if (botaoExemploSucesso) {
  botaoExemploSucesso.addEventListener("click", () => {
    campoCodigo.value = `// Código JavaScript válido para apresentação\nfunction calcularDesconto(valor, taxa) {\n  const valido = true;\n  if (valor > 100 && valido) {\n    return valor * (1 - taxa);\n  }\n  return valor;\n}\n\nconst total = calcularDesconto(250, 0.15);\nconsole.log("Total final:", total);`;
    atualizarEditor();
    mostrarResultado();
  });
}

if (botaoExemploErro) {
  botaoExemploErro.addEventListener("click", () => {
    campoCodigo.value = `// Demonstração de erros de delimitadores e strings\nfunction testarAnalise() {\n  const numeros = [1, 2, 3);\n  const mensagem = "string sem fechamento;\n  if (numeros.length > 0) {\n    return true;\n  }\n`;
    atualizarEditor();
    mostrarResultado();
  });
}

if (botaoLimpar) {
  botaoLimpar.addEventListener("click", () => {
    campoCodigo.value = "";
    atualizarEditor();
    campoCodigo.focus();
  });
}

if (botaoCopiar) {
  botaoCopiar.addEventListener("click", async () => {
    if (!campoCodigo.value) return;
    try {
      await navigator.clipboard.writeText(campoCodigo.value);
      const original = botaoCopiar.innerHTML;
      botaoCopiar.textContent = "Copiado!";
      setTimeout(() => { botaoCopiar.innerHTML = original; }, 1800);
    } catch {}
  });
}

let textoCodigoAlgoritmo = "";

function renderizarAlgoritmoDestacado(codigoTexto: string): void {
  const fragmento = document.createDocumentFragment();
  const linhas = codigoTexto.split(/\r\n|\r|\n/);

  for (let indice = 0; indice < linhas.length; indice++) {
    const linhaTexto = linhas[indice];
    const linhaEl = document.createElement("span");
    linhaEl.className = "linha-codigo";

    const numeroEl = document.createElement("span");
    numeroEl.className = "numero-linha";
    numeroEl.textContent = String(indice + 1);

    const conteudoEl = document.createElement("span");
    conteudoEl.className = "texto-linha";

    let inicio = 0;
    for (const trecho of linhaTexto.matchAll(padraoDestaques)) {
      const texto = trecho[0];
      let classe = "";

      if (texto.startsWith("//") || texto.startsWith("/*")) {
        classe = "comentario";
      } else if (/^["'`]/.test(texto)) {
        classe = stringEstaFechada(texto) ? "string" : "";
      } else if (/^(?:\d|\.\d)/.test(texto)) {
        classe = "numero";
      } else if (texto === "true" || texto === "false" || texto === "null") {
        classe = "booleano";
      } else if (palavrasReservadas.has(texto)) {
        classe = "palavra-reservada";
      } else if (/^[a-zA-Z_$]/.test(texto)) {
        classe = "identificador";
      }

      if (classe) {
        if ((trecho.index ?? 0) > inicio) {
          conteudoEl.append(document.createTextNode(linhaTexto.slice(inicio, trecho.index)));
        }
        const span = document.createElement("span");
        span.className = classe;
        span.textContent = texto;
        conteudoEl.append(span);
        inicio = (trecho.index ?? 0) + texto.length;
      }
    }

    if (inicio < linhaTexto.length) {
      conteudoEl.append(document.createTextNode(linhaTexto.slice(inicio)));
    } else if (linhaTexto.length === 0) {
      conteudoEl.append(document.createTextNode(" "));
    }

    linhaEl.append(numeroEl, conteudoEl);
    fragmento.append(linhaEl);
  }

  codigoAnalise.replaceChildren(fragmento);
}

if (botaoCopiarAlgoritmo) {
  botaoCopiarAlgoritmo.addEventListener("click", async () => {
    const textoParaCopiar = textoCodigoAlgoritmo || codigoAnalise.textContent;
    if (!textoParaCopiar) return;
    try {
      await navigator.clipboard.writeText(textoParaCopiar);
      const original = botaoCopiarAlgoritmo.innerHTML;
      botaoCopiarAlgoritmo.textContent = "Copiado!";
      setTimeout(() => { botaoCopiarAlgoritmo.innerHTML = original; }, 1800);
    } catch {}
  });
}

atualizarEditor();
editorCodigo.classList.add("com-destaque");

textoCodigoAlgoritmo = `// ============================================================================
// 1. MAPEAMENTO DE DELIMITADORES & DISCRIMINAÇÃO LÉXICA
// ============================================================================
const pares = ${JSON.stringify(pares, null, 2)};

// Diferencia operador de divisão / de expressões regulares literais /.../flags
${ehInicioRegExp.toString()}

// ============================================================================
// 2. SCANNER LÉXICO (STRINGS, REGEX, COMENTÁRIOS E TEMPLATE INTERPOLATIONS)
// ============================================================================
${escanearCodigo.toString()}

// ============================================================================
// 3. ANÁLISE SINTÁTICA COM ESTRUTURA DE DADOS PILHA (LIFO)
// Complexidade de Tempo: O(n) linear • Espaço: O(n)
// ============================================================================
${analisarCodigo.toString()}`;

codigoAnalise.textContent = textoCodigoAlgoritmo;
renderizarAlgoritmoDestacado(textoCodigoAlgoritmo);
