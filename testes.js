// Execute node testes.js. A página não depende deste arquivo nem do Node.js.
const verificar = require("node:assert/strict");
const arquivos = require("node:fs");
const caminho = require("node:path");
const ambiente = require("node:vm");

function criarNo(texto = "") {
  return {
    textContent: texto,
    value: "",
    scrollTop: 0,
    scrollLeft: 0,
    classList: { add() {} },
    filhos: [],
    ouvintes: {},
    append(...filhos) { this.filhos.push(...filhos); },
    replaceChildren(...filhos) { this.filhos = filhos; },
    setAttribute() {},
    addEventListener(evento, funcao) { this.ouvintes[evento] = funcao; }
  };
}

function lerTexto(no) {
  return no.filhos.length ? no.filhos.map(lerTexto).join("") : no.textContent;
}

const elementos = {};
for (const id of ["codigo", "botao-analisar", "painel-resultado", "resumo-resultado",
  "lista-erros", "editor-codigo", "camada-destaque", "codigo-destacado", "codigo-analise"]) {
  elementos[id] = criarNo();
}

const contexto = {
  document: {
    getElementById: id => elementos[id],
    createDocumentFragment: () => criarNo(),
    createTextNode: texto => criarNo(texto),
    createElement: nome => {
      verificar.ok(["li", "span", "p", "pre", "code"].includes(nome));
      return criarNo();
    }
  }
};

ambiente.runInNewContext(
  arquivos.readFileSync(caminho.join(__dirname, "script.js"), "utf8"), contexto
);

const analisar = contexto.analisarCodigo;

// Delimitadores dentro de strings, comentários e strings escapadas são ignorados.
for (const codigo of [
  "({[]})",
  'const texto = "([{";',
  "const texto = '})]';",
  'const texto = `([\n}];`;',
  String.raw`const texto = "aspa: \" ([{";`,
  String.raw`const texto = 'aspa: \' )]}';`,
  String.raw`const texto = "barra: \\"; []`,
  '// } " return\n[]',
  '/* [ " const\n} */ ()',
  "// }\r[]",
  "// }\r\n[]",
  "// }\u2028[]",
  '"antes\\\r\ndepois"',
  "(".repeat(10000) + ")".repeat(10000)
]) {
  verificar.equal(analisar(codigo).erros.length, 0, codigo);
}

// Metadados de posição e lista completa, ordenada pela localização no texto.
verificar.match(analisar("\r\n  ]").erros[0].mensagem, /linha 2, coluna 3/);
verificar.match(analisar("\n  [").erros[0].mensagem, /linha 2, coluna 3/);
verificar.match(analisar("/* (\n ] */\n  }").erros[0].mensagem, /linha 3, coluna 3/);
verificar.match(analisar("const lista = [").erros[0].mensagem, /coluna 15/);
verificar.deepEqual(Array.from(analisar(")\n]\n}").erros, erro => erro.indice), [0, 2, 4]);
verificar.deepEqual(Array.from(analisar("( ] { ( ]").erros, erro => erro.indice), [2, 4, 8]);

// Regressão da imagem: uma troca de ] por ) não deve virar quatro avisos.
const exemploImagem = [
  "function verificarNumeros() {",
  "    const numeros = [1, 2, 3);",
  "",
  "    if (numeros[0] === 1) {",
  "        console.log(numeros);",
  "    }",
  "}"
].join("\n");
verificar.equal(analisar(exemploImagem).erros.length, 1);
verificar.match(analisar(exemploImagem).erros[0].mensagem, /linha 2, coluna 29/);
verificar.ok(analisar(exemploImagem).erros[0].mensagem.includes("Esperado “]”"));

// O destaque aparece ao digitar, antes de clicar, sem alterar texto ou seleção.
const codigoDestaque = 'const texto = "if <img src=x onerror=alert(1)>"; // return\nlet ifTotal = true;';
elementos.codigo.value = codigoDestaque;
elementos.codigo.selectionStart = 5;
elementos.codigo.selectionEnd = 10;
elementos.codigo.ouvintes.input();
verificar.equal(elementos.codigo.value, codigoDestaque);
verificar.equal(elementos.codigo.selectionStart, 5);
verificar.equal(elementos.codigo.selectionEnd, 10);
verificar.equal(elementos["resumo-resultado"].textContent, "Aguardando análise");
verificar.equal(lerTexto(elementos["codigo-destacado"]), codigoDestaque + "\n ");

const fragmento = elementos["codigo-destacado"].filhos[0];
verificar.deepEqual(
  fragmento.filhos.filter(no => no.className === "palavra-reservada").map(no => no.textContent),
  ["const", "let"]
);

// A palavra deixa de ser destacada quando passa a fazer parte de outro nome.
elementos.codigo.value = "constante";
elementos.codigo.ouvintes.input();
verificar.equal(
  elementos["codigo-destacado"].filhos[0].filhos.filter(no => no.className === "palavra-reservada").length,
  0
);

// Números e strings têm cores próprias, sem destacar o conteúdo dos comentários.
function trechosColoridos(codigo) {
  elementos.codigo.value = codigo;
  elementos.codigo.ouvintes.input();
  verificar.equal(lerTexto(elementos["codigo-destacado"]), codigo + "\n ");
  return elementos["codigo-destacado"].filhos[0].filhos
    .filter(no => no.className)
    .map(no => [no.className, no.textContent]);
}

verificar.deepEqual(
  trechosColoridos('true false trueValue falseValue "true false" // true false'),
  [
    ["booleano", "true"], ["booleano", "false"],
    ["string", '"true false"']
  ]
);

verificar.deepEqual(
  trechosColoridos('let total = 1; var ativo = true; const nome = "total"; total += 2; console.log(nome, ativo); // total')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["total", "ativo", "nome", "total", "nome", "ativo"]
);
verificar.deepEqual(
  trechosColoridos('const /* comentário */ ação = 1; ação; const $saldo = 2; $saldo;')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["ação", "ação", "$saldo", "$saldo"]
);

// Funções, parâmetros, classes e propriedades recebem a mesma cor de identificador.
verificar.deepEqual(
  trechosColoridos('function somar(valor) { const {total} = valor; return total; } class Pessoa {} const a = 1, b = 2; somar(a); Pessoa.nome;')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["somar", "valor", "total", "valor", "total", "Pessoa", "a", "b", "somar", "a", "Pessoa"]
);

// APIs prontas não recebem rosa, mesmo quando há uma função local com nome igual.
verificar.deepEqual(
  trechosColoridos('function log(valor) { return valor; } log(1); console.log(2); Math.max(1, 2); document.querySelector("body");')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["log", "valor", "valor", "log"]
);
verificar.deepEqual(
  trechosColoridos('const dobrar = valor => valor * 2; const somar = (a, b) => a + b; console.log(dobrar(3));')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["dobrar", "valor", "valor", "somar", "a", "b", "a", "b", "dobrar"]
);
verificar.deepEqual(
  trechosColoridos('const pessoa = {nome: "Ana"}; pessoa.nome; console.nome; const numeros = [1]; numeros.length;')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["pessoa", "nome", "pessoa", "nome", "numeros", "numeros"]
);
verificar.deepEqual(
  trechosColoridos('const objeto = { log(valor) { return valor; } }; objeto.log(1); console.log(2);')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["objeto", "log", "valor", "valor", "objeto", "log"]
);
verificar.deepEqual(
  trechosColoridos('function juntar(...itens) { return itens; } juntar(1);')
    .filter(([classe]) => classe === "identificador").map(([, texto]) => texto),
  ["juntar", "itens", "itens", "juntar"]
);

verificar.deepEqual(
  trechosColoridos('const item2 = [10, 3.14, .5, 2e-3, 0xFF, 0b10, 0o7, 1_000, 42n]; // 99 "texto"'),
  [
    ["palavra-reservada", "const"],
    ["identificador", "item2"],
    ["numero", "10"], ["numero", "3.14"], ["numero", ".5"], ["numero", "2e-3"],
    ["numero", "0xFF"], ["numero", "0b10"], ["numero", "0o7"],
    ["numero", "1_000"], ["numero", "42n"]
  ]
);

verificar.deepEqual(
  trechosColoridos('"if 123"; \'return 42\'; `texto 9`; /* 77 "ignorado" */'),
  [["string", '"if 123"'], ["string", "'return 42'"], ["string", "`texto 9`"]]
);
verificar.deepEqual(
  trechosColoridos(String.raw`"aspa: \" 123"`),
  [["string", String.raw`"aspa: \" 123"`]]
);
// O verde só aparece quando a aspa de fechamento é digitada; removê-la desfaz a cor.
for (const aspas of ['"', "'", "`"]) {
  const incompleta = aspas + "if 123";
  verificar.deepEqual(trechosColoridos(incompleta), []);
  verificar.deepEqual(trechosColoridos(incompleta + aspas), [["string", incompleta + aspas]]);
  verificar.deepEqual(trechosColoridos(incompleta), []);
}
verificar.deepEqual(trechosColoridos(String.raw`"aspa: \"`), []);
verificar.deepEqual(trechosColoridos('""; \'\'; ``'), [
  ["string", '""'], ["string", "''"], ["string", "``"]
]);

// A aspa ausente da imagem não deve pintar as próximas linhas nem gerar erros em cascata.
const exemploStringIncompleta = exemploImagem.replace("[1, 2, 3)", '["fdsf]');
const errosDaString = analisar(exemploStringIncompleta).erros;
verificar.equal(errosDaString.length, 1);
verificar.match(errosDaString[0].mensagem, /String sem fechamento em linha 2, coluna 22/);

const coresDaString = trechosColoridos(exemploStringIncompleta);
verificar.deepEqual(coresDaString.filter(([classe]) => classe === "string"), []);
verificar.ok(coresDaString.some(([classe, texto]) => classe === "palavra-reservada" && texto === "if"));
verificar.equal(analisar(exemploStringIncompleta.replace('["fdsf]', '["fdsf"]')).erros.length, 0);

for (const codigo of ['"', "'", "`", String.raw`"aspa: \"`, '"texto\n', "'texto\r\n"]) {
  verificar.equal(analisar(codigo).erros.length, 1, codigo);
  verificar.match(analisar(codigo).erros[0].mensagem, /String sem fechamento em linha 1, coluna 1/);
}

elementos.codigo.scrollTop = 84;
elementos.codigo.scrollLeft = 32;
elementos.codigo.ouvintes.scroll();
verificar.equal(elementos["camada-destaque"].scrollTop, 84);
verificar.equal(elementos["camada-destaque"].scrollLeft, 32);

elementos.codigo.value = codigoDestaque;
elementos["botao-analisar"].ouvintes.click();
verificar.equal(elementos["painel-resultado"].className, "resultado sucesso");

elementos.codigo.value = exemploImagem;
elementos["botao-analisar"].ouvintes.click();
verificar.equal(elementos["lista-erros"].filhos.length, 1);
verificar.equal(elementos["resumo-resultado"].textContent, "1 erro encontrado:");
const textoErroPrimeiro = lerTexto(elementos["lista-erros"].filhos[0]);
verificar.match(textoErroPrimeiro, /const numeros = \[1, 2, 3\);/);
verificar.match(textoErroPrimeiro, /\u2191 aqui/);

const analiseExemplo = analisar(exemploImagem);
verificar.equal(typeof analiseExemplo.erros[0].linha, "number");
verificar.equal(typeof analiseExemplo.erros[0].coluna, "number");
verificar.equal(analiseExemplo.erros[0].linha, 2);

elementos.codigo.ouvintes.input();
verificar.equal(elementos["resumo-resultado"].textContent, "Aguardando análise");
verificar.equal(elementos["lista-erros"].filhos.length, 0);
verificar.equal(lerTexto(elementos["codigo-destacado"]), exemploImagem + "\n ");

elementos.codigo.value = "const\n";
elementos.codigo.ouvintes.input();
verificar.equal(lerTexto(elementos["codigo-destacado"]), "const\n\n ");

for (const vazio of ["", " \n\t "]) {
  elementos.codigo.value = vazio;
  elementos["botao-analisar"].ouvintes.click();
  verificar.equal(elementos["resumo-resultado"].textContent, "Digite um código para analisar");
  verificar.equal(elementos["painel-resultado"].className, "resultado neutro");
}

// ============================================================================
// NOVOS TESTES DE REGRESSÃO — AUDITORIA DE 10 BUGS
// ============================================================================

// BUG 1 & BUG 3: Expressões Regulares e aspas internas
verificar.equal(analisar("const regex = /[(]/;").erros.length, 0, "BUG 1.1: regex com [()]");
verificar.equal(analisar("const regex = /[{}]/;").erros.length, 0, "BUG 1.2: regex com [{}]");
verificar.equal(analisar("const regex = /\\(/;").erros.length, 0, "BUG 1.3: regex com \\(");
verificar.equal(analisar("const regex = /[\"']/;").erros.length, 0, "BUG 3: aspas dentro de regex");
verificar.equal(analisar("const div = (a + b) / 2 / c;").erros.length, 0, "Divisão matemática não é confundida com RegExp");

// BUG 2: Template Literals com expressões ${...}
const b2_1 = analisar("const resultado = `${(1]}`;");
verificar.equal(b2_1.erros.length, 1, "BUG 2.1: erro dentro de interpolação");
verificar.match(b2_1.erros[0].mensagem, /“]” incompatível/);

const b2_2 = analisar("const mensagem = `${funcao([1, 2)}`;");
verificar.ok(b2_2.erros.length >= 1, "BUG 2.2: delimitadores incompatíveis em interpolação");

const b2_3 = analisar("`antes ${ `${ (1] }` } depois`");
verificar.equal(b2_3.erros.length, 1, "BUG 2.3: template aninhado com erro");

// BUG 4: Comentário de bloco incompleto
const b4 = analisar("const numero = 10;\n\n/* Comentário não terminado");
verificar.equal(b4.erros.length, 1, "BUG 4: comentário de bloco incompleto");
verificar.match(b4.erros[0].mensagem, /Comentário de bloco iniciado na linha 3, coluna 1, mas não finalizado\./);

// BUG 5: Parâmetros com valores padrão complexos
const codB5 = "function calcular(a = Math.max(1, 2)) { return a; }";
const defB5 = contexto.encontrarNomesDefinidos(codB5);
verificar.ok(defB5.nomes.has("a"), "BUG 5: parâmetro a reconhecido com expressão default balanceada");

// BUG 6: Propriedades abreviadas de objetos
const codB6 = 'const nome = "Alef"; const usuario = { nome }; usuario.nome;';
const defB6 = contexto.encontrarNomesDefinidos(codB6);
verificar.ok(defB6.propriedades.has("nome"), "BUG 6: propriedade nome reconhecida");
verificar.ok(contexto.nomeFoiDefinido("nome", codB6.lastIndexOf("nome"), defB6), "BUG 6: usuario.nome destacado como propriedade");

// BUG 7: Desestruturação aninhada
const codB7 = "const { info: { valor } } = objeto; valor;";
const defB7 = contexto.encontrarNomesDefinidos(codB7);
verificar.ok(defB7.nomes.has("valor"), "BUG 7: variável aninhada valor reconhecida");
verificar.ok(defB7.propriedades.has("info"), "BUG 7: propriedade info reconhecida");

// BUG 8: Campos de classes sem ponto e vírgula
const codB8 = `class Pessoa {
    nome = "Alef"
    idade = 20

    apresentar() {
        return this.nome;
    }
}`;
const defB8 = contexto.encontrarNomesDefinidos(codB8);
verificar.ok(defB8.propriedades.has("nome"), "BUG 8: campo nome reconhecido sem ponto e vírgula");
verificar.ok(defB8.propriedades.has("idade"), "BUG 8: campo idade reconhecido sem ponto e vírgula");

// BUG 9: Identificadores com o mesmo nome em escopos diferentes
const codB9 = `function teste() {
    const segredo = 123;
}
console.log(segredo);`;
const defB9 = contexto.encontrarNomesDefinidos(codB9);
const idxSegredoFora = codB9.indexOf("console.log(segredo)") + 12;
verificar.equal(contexto.nomeFoiDefinido("segredo", idxSegredoFora, defB9), false, "BUG 9: segredo fora do escopo da função não é destacado");

// BUG 10: Performance com milhares de erros na mesma linha
const codB10 = "}".repeat(2000);
const inicioT = Date.now();
const resB10 = analisar(codB10);
const fimT = Date.now();
verificar.equal(resB10.erros.length, 2000, "BUG 10: contagem exata de 2000 erros preservada");
verificar.ok(fimT - inicioT < 250, `BUG 10: processamento ultra-rápido (${fimT - inicioT}ms)`);

console.log("Todos os testes passaram com sucesso: testes originais + bateria de 10 bugs!");
