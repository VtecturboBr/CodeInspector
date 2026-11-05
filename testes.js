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
      verificar.ok(["li", "span"].includes(nome));
      return criarNo();
    }
  }
};

ambiente.runInNewContext(
  arquivos.readFileSync(caminho.join(__dirname, "script.js"), "utf8"), contexto
);

const analisar = contexto.analisarCodigo;

// Uma aspa dupla sem fechamento aparece no resultado abaixo do editor após a análise.
const erroAspasAbertas = analisar('const texto = "sem fechamento');
verificar.equal(erroAspasAbertas.erros.length, 1);
verificar.match(erroAspasAbertas.erros[0].mensagem, /Aspas duplas abertas em linha 1, coluna 15/);
verificar.match(erroAspasAbertas.erros[0].mensagem, /Feche as aspas duplas/);
verificar.equal(analisar('// " comentário\nconst ok = [];').erros.length, 0);
verificar.equal(analisar("const ok = 'aspas duplas: \"';").erros.length, 0);

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
  ["const", "let", "true"]
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
  trechosColoridos('const item2 = [10, 3.14, .5, 2e-3, 0xFF, 0b10, 0o7, 1_000, 42n]; // 99 "texto"'),
  [
    ["palavra-reservada", "const"],
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
verificar.deepEqual(trechosColoridos('"ainda digitando 123'), [["string", '"ainda digitando 123']]);

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

console.log("Todos os testes passaram: pilha, posições, vários erros, destaque e ações da página.");
