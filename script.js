"use strict";
// 2. Elementos da página
function obterElemento(id) {
    const elemento = document.getElementById(id);
    if (!elemento) {
        throw new Error(`Elemento #${id} não encontrado.`);
    }
    return elemento;
}
const campoCodigo = obterElemento("codigo");
const botaoAnalisar = obterElemento("botao-analisar");
const painelResultado = obterElemento("painel-resultado");
const resumoResultado = obterElemento("resumo-resultado");
const listaErros = obterElemento("lista-erros");
const editorCodigo = obterElemento("editor-codigo");
const camadaDestaque = obterElemento("camada-destaque");
const codigoDestacado = obterElemento("codigo-destacado");
const codigoAnalise = obterElemento("codigo-analise");
// 3. Pares de delimitadores e regras de destaque
const pares = { "(": ")", "[": "]", "{": "}" };
const padraoTextos = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n\u2028\u2029]*|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|`(?:\\[\s\S]|[^`\\])*`?/g;
const padraoNumeros = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n?|\d[\d_]*n|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?/;
const padraoPalavras = /[\p{ID_Continue}$\u200c\u200d]+/u;
// Textos vêm primeiro para não destacar números ou palavras dentro deles.
const padraoDestaques = new RegExp([padraoTextos.source, padraoNumeros.source, padraoPalavras.source].join("|"), "gu");
const palavrasReservadas = new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
    "false", "finally", "for", "function", "if", "implements", "import", "in",
    "instanceof", "interface", "let", "new", "null", "package", "private",
    "protected", "public", "return", "static", "super", "switch", "this",
    "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield"
]);
// 4. Preparação do texto e formatação das posições
// shortcut: regex e expressões em crases exigem leitura léxica mais completa; ampliar se forem usadas.
function ignorarStringsEComentarios(codigo) {
    // Espaços mantêm os índices originais; quebras mantêm as linhas originais.
    return codigo.replace(padraoTextos, trecho => trecho.replace(/[^\r\n\u2028\u2029]/g, " "));
}
function formatarPosicao(posicao) {
    return `linha ${posicao.linha}, coluna ${posicao.coluna}`;
}
function posicaoNoIndice(codigo, indiceDesejado) {
    let linha = 1;
    let coluna = 0;
    for (let indice = 0; indice < indiceDesejado; indice++) {
        const caractere = codigo[indice];
        if (caractere === "\r" && codigo[indice + 1] === "\n") {
            indice++;
            linha++;
            coluna = 0;
        }
        else if ("\r\n\u2028\u2029".includes(caractere)) {
            linha++;
            coluna = 0;
        }
        else {
            coluna++;
        }
    }
    return { linha, coluna: coluna + 1 };
}
function encontrarAspasDuplasAbertas(codigo) {
    let estado = "normal";
    let indiceAbertura = -1;
    for (let indice = 0; indice < codigo.length; indice++) {
        const caractere = codigo[indice];
        const proximo = codigo[indice + 1];
        if (estado === "comentario-linha") {
            if ("\r\n\u2028\u2029".includes(caractere))
                estado = "normal";
            continue;
        }
        if (estado === "comentario-bloco") {
            if (caractere === "*" && proximo === "/") {
                estado = "normal";
                indice++;
            }
            continue;
        }
        if (estado === "aspas-simples" || estado === "aspas-duplas" || estado === "crase") {
            if (caractere === "\\") {
                indice++;
            }
            else if ((estado === "aspas-simples" && caractere === "'")
                || (estado === "aspas-duplas" && caractere === '"')
                || (estado === "crase" && caractere === "`")) {
                estado = "normal";
            }
            continue;
        }
        if (caractere === "/" && proximo === "/") {
            estado = "comentario-linha";
            indice++;
        }
        else if (caractere === "/" && proximo === "*") {
            estado = "comentario-bloco";
            indice++;
        }
        else if (caractere === "'") {
            estado = "aspas-simples";
        }
        else if (caractere === '"') {
            estado = "aspas-duplas";
            indiceAbertura = indice;
        }
        else if (caractere === "`") {
            estado = "crase";
        }
    }
    if (estado !== "aspas-duplas")
        return [];
    return [{
            mensagem: `Aspas duplas abertas em ${formatarPosicao(posicaoNoIndice(codigo, indiceAbertura))}. Feche as aspas duplas (\").`,
            indice: indiceAbertura
        }];
}
// 5. Análise com pilha: independente dos elementos da página
function analisarCodigo(codigo) {
    const codigoLimpo = ignorarStringsEComentarios(codigo);
    const pilha = [];
    const erros = [];
    let linha = 1;
    let coluna = 0;
    for (let indice = 0; indice < codigoLimpo.length; indice++) {
        const caractere = codigoLimpo[indice];
        coluna++;
        if ("\r\n\u2028\u2029".includes(caractere)) {
            // No Windows, \r\n representa uma única quebra de linha.
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
                indice
            });
        }
        else if (caractere !== pares[abertura.simbolo]) {
            // Consumimos o par incompatível para não repetir a mesma abertura como outro erro.
            erros.push({
                mensagem: `“${caractere}” incompatível em ${posicao}. `
                    + `Esperado “${pares[abertura.simbolo]}” para “${abertura.simbolo}” `
                    + `aberto em ${formatarPosicao(abertura)}.`,
                indice
            });
        }
    }
    for (const abertura of pilha) {
        erros.push({
            mensagem: `“${abertura.simbolo}” sem fechamento correspondente `
                + `em ${formatarPosicao(abertura)}. Esperado “${pares[abertura.simbolo]}”.`,
            indice: abertura.indice
        });
    }
    return {
        erros: [...erros, ...encontrarAspasDuplasAbertas(codigo)]
            .sort((primeiro, segundo) => primeiro.indice - segundo.indice)
    };
}
// 6. Destaque no próprio campo: texto digitado nunca é interpretado como HTML
function destacarCodigo(codigo) {
    const fragmento = document.createDocumentFragment();
    let inicio = 0;
    for (const trecho of codigo.matchAll(padraoDestaques)) {
        const texto = trecho[0];
        let classe = "";
        if (/^["'`]/.test(texto)) {
            classe = "string";
        }
        else if (/^(?:\d|\.\d)/.test(texto)) {
            classe = "numero";
        }
        else if (palavrasReservadas.has(texto)) {
            classe = "palavra-reservada";
        }
        if (!classe) {
            continue;
        }
        fragmento.append(document.createTextNode(codigo.slice(inicio, trecho.index)));
        const destaque = document.createElement("span");
        destaque.className = classe;
        destaque.textContent = texto;
        fragmento.append(destaque);
        inicio = trecho.index + texto.length;
    }
    // A linha extra permite alinhar a rolagem até o fim, inclusive após Enter.
    fragmento.append(document.createTextNode(codigo.slice(inicio) + "\n "));
    codigoDestacado.replaceChildren(fragmento);
}
function sincronizarRolagem() {
    camadaDestaque.scrollTop = campoCodigo.scrollTop;
    camadaDestaque.scrollLeft = campoCodigo.scrollLeft;
}
// 7. Exibição do resultado e limpeza ao editar
function limparResultado() {
    painelResultado.className = "resultado neutro";
    resumoResultado.textContent = "Aguardando análise";
    listaErros.replaceChildren();
    listaErros.hidden = true;
}
function atualizarEditor() {
    const codigo = campoCodigo.value;
    limparResultado();
    destacarCodigo(codigo);
    sincronizarRolagem();
}
function mostrarResultado() {
    const codigo = campoCodigo.value;
    limparResultado();
    if (codigo.trim() === "") {
        destacarCodigo(codigo);
        sincronizarRolagem();
        resumoResultado.textContent = "Digite um código para analisar";
        return;
    }
    const analise = analisarCodigo(codigo);
    destacarCodigo(codigo);
    sincronizarRolagem();
    painelResultado.className = `resultado ${analise.erros.length ? "erro" : "sucesso"}`;
    if (analise.erros.length === 0) {
        resumoResultado.textContent = "Nenhum erro de delimitadores foi encontrado.";
        return;
    }
    resumoResultado.textContent = analise.erros.length === 1
        ? "1 erro encontrado:"
        : `${analise.erros.length} erros encontrados:`;
    for (const erro of analise.erros) {
        const item = document.createElement("li");
        item.textContent = erro.mensagem;
        listaErros.append(item);
    }
    listaErros.hidden = false;
}
// 8. Eventos e código disponível para explicar durante a apresentação
botaoAnalisar.addEventListener("click", mostrarResultado);
campoCodigo.addEventListener("input", atualizarEditor);
campoCodigo.addEventListener("scroll", sincronizarRolagem);
atualizarEditor();
editorCodigo.classList.add("com-destaque");
codigoAnalise.textContent = `const pares = ${JSON.stringify(pares, null, 2)};\n\n`
    + `const padraoTextos = ${padraoTextos};\n\n`
    + [ignorarStringsEComentarios, formatarPosicao, posicaoNoIndice, encontrarAspasDuplasAbertas, analisarCodigo]
        .map(funcao => funcao.toString())
        .join("\n\n");
