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


// 3. Pares de delimitadores, padrões compilados e regras de destaque
const pares = { "(": ")", "[": "]", "{": "}" };
const padraoTextos = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n\u2028\u2029]*|"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n\u2028\u2029])*"?|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n\u2028\u2029])*'?|`(?:\\[\s\S]|[^`\\])*`?/g;
const padraoNumeros = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n?|\d[\d_]*n|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?/;
const padraoPalavras = /[\p{ID_Continue}$\u200c\u200d]+/u;
// Textos vêm primeiro para não destacar números ou palavras dentro deles.
const padraoDestaques = new RegExp([padraoTextos.source, padraoNumeros.source, padraoPalavras.source].join("|"), "gu");
const palavrasReservadas = new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
    "finally", "for", "function", "if", "implements", "import", "in",
    "instanceof", "interface", "let", "new", "null", "package", "private",
    "protected", "public", "return", "static", "super", "switch", "this",
    "throw", "try", "typeof", "var", "void", "while", "with", "yield"
]);


// Expressões regulares compiladas uma única vez no escopo global para máxima performance
const padraoNomeIdentificador = "[\\p{ID_Start}$_][\\p{ID_Continue}$\\u200c\\u200d]*";
const padraoInicioNome = new RegExp(`^(?:\\.\\.\\.)?(${padraoNomeIdentificador})`, "u");
const padraoDeclaracaoVariaveis = /\b(?:const|let|var)\s+([^;\r\n]+)/g;
const padraoDeclaracaoFuncaoClasse = new RegExp(`\\b(?:function\\b\\s*\\*?|class\\b)\\s*(${padraoNomeIdentificador})`, "gu");
const padraoParametrosFuncao = new RegExp(`\\bfunction\\b\\s*\\*?\\s*(?:${padraoNomeIdentificador})?\\s*\\(([^()]*)\\)`
    + `|\\(([^()]*)\\)\\s*=>|(${padraoNomeIdentificador})\\s*=>`, "gu");
const padraoMetodos = new RegExp(`(${padraoNomeIdentificador})\\s*\\(([^()]*)\\)\\s*\\{`, "gu");
const padraoCampos = new RegExp(`(?:[{,]\\s*(${padraoNomeIdentificador})\\s*:)|(?:[{;]\\s*(${padraoNomeIdentificador})\\s*=)`, "gu");
// 4. Preparação do texto, posições e indicador visual
// Escopo: delimitadores, strings e comentários comuns.
// Literais /regex/ e interpolações ${...} em crases exigem um parser.
// Esta análise não valida toda a sintaxe de JavaScript/TypeScript.
function ignorarStringsEComentarios(codigo) {
    // Espaços mantêm os índices originais; quebras mantêm as linhas originais.
    return codigo.replace(padraoTextos, trecho => trecho.replace(/[^\r\n\u2028\u2029]/g, " "));
}


function formatarPosicao(posicao) {
    return `linha ${posicao.linha}, coluna ${posicao.coluna}`;
}


// Cria uma cópia da linha do usuário, preservando tabs para a seta alinhar diretamente sob o caractere.
function criarIndicadorErro(codigo, erro) {
    let inicioLinha = erro.indice;
    let fimLinha = erro.indice;
    while (inicioLinha > 0 && !"\r\n\u2028\u2029".includes(codigo[inicioLinha - 1])) {
        inicioLinha--;
    }
    while (fimLinha < codigo.length && !"\r\n\u2028\u2029".includes(codigo[fimLinha])) {
        fimLinha++;
    }
    return {
        textoLinha: codigo.slice(inicioLinha, fimLinha),
        espacosAteErro: codigo.slice(inicioLinha, erro.indice).replace(/[^\t]/g, " ")
    };
}


function stringEstaFechada(texto) {
    if (texto.length < 2 || !texto.endsWith(texto[0])) {
        return false;
    }
    // Uma quantidade ímpar de barras antes da aspa faz dela parte do texto.
    let barras = 0;
    for (let indice = texto.length - 2; indice >= 0 && texto[indice] === "\\"; indice--) {
        barras++;
    }
    return barras % 2 === 0;
}


function encontrarStringIncompleta(codigo) {
    for (const trecho of codigo.matchAll(padraoTextos)) {
        const texto = trecho[0];
        const aspas = texto[0];
        if (texto.startsWith("/*") && !texto.endsWith("*/")) {
            return { indice: trecho.index, esperado: "*/" };
        }
        if (['"', "'", "`"].includes(aspas) && !stringEstaFechada(texto)) {
            return { indice: trecho.index, esperado: aspas };
        }
    }
}


// 5. Análise com pilha: independente dos elementos da página
function analisarCodigo(codigo) {
    const stringIncompleta = encontrarStringIncompleta(codigo);
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
        if (stringIncompleta && indice === stringIncompleta.indice) {
            erros.push({
                mensagem: `Texto ou comentário sem fechamento em ${formatarPosicao({ linha, coluna })}. `
                    + `Esperado “${stringIncompleta.esperado}”. Corrija o trecho para continuar a análise.`,
                indice,
                linha,
                coluna
            });
            // Os delimitadores seguintes podem pertencer ao texto da string incompleta.
            return { erros, codigoLimpo };
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
        }
        else if (caractere !== pares[abertura.simbolo]) {
            // Consumimos o par incompatível para não repetir a mesma abertura como outro erro.
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
// 6. Destaque no próprio campo: texto digitado nunca é interpretado como HTML
// shortcut: reconhecimento de declarações usuais; usar um parser se precisar resolver escopos completos.
function encontrarNomesDefinidos(codigo, codigoLimpoPreexistente) {
    const codigoLimpo = codigoLimpoPreexistente ?? ignorarStringsEComentarios(codigo);
    const nomes = new Set();
    const propriedades = new Set();
    function adicionarVinculos(texto) {
        const vinculos = texto.trim().replace(/^[{\[]|[}\]]$/g, "");
        for (const parte of vinculos.split(",")) {
            // Em declarações simples, o trecho após ':' é o tipo, não o nome.
            const semValor = parte.split("=")[0];
            const vinculo = (texto.trim().startsWith("{")
                ? semValor.split(":").pop() ?? "" : semValor.split(":")[0]).trim();
            const encontrado = vinculo.match(padraoInicioNome);
            if (encontrado && !palavrasReservadas.has(encontrado[1])) {
                nomes.add(encontrado[1]);
            }
        }
    }
    for (const declaracao of codigoLimpo.matchAll(padraoDeclaracaoVariaveis)) {
        let inicio = 0;
        let fimNome = -1;
        let nivel = 0;
        const texto = declaracao[1];
        // Vírgulas dentro de arrays, objetos ou chamadas não iniciam outra variável.
        for (let indice = 0; indice <= texto.length; indice++) {
            const caractere = texto[indice];
            if (indice === texto.length || (caractere === "," && nivel === 0)) {
                adicionarVinculos(texto.slice(inicio, fimNome < 0 ? indice : fimNome));
                inicio = indice + 1;
                fimNome = -1;
            }
            else if (caractere === "=" && nivel === 0 && fimNome < 0) {
                fimNome = indice;
            }
            else if ("([{".includes(caractere)) {
                nivel++;
            }
            else if (")]}".includes(caractere)) {
                nivel = Math.max(0, nivel - 1);
            }
        }
    }
    for (const declaracao of codigoLimpo.matchAll(padraoDeclaracaoFuncaoClasse)) {
        nomes.add(declaracao[1]);
    }
    for (const funcao of codigoLimpo.matchAll(padraoParametrosFuncao)) {
        adicionarVinculos(funcao[1] ?? funcao[2] ?? funcao[3]);
    }
    for (const metodo of codigoLimpo.matchAll(padraoMetodos)) {
        if (!palavrasReservadas.has(metodo[1])) {
            if (metodo[1] !== "constructor") {
                nomes.add(metodo[1]);
                propriedades.add(metodo[1]);
            }
            adicionarVinculos(metodo[2]);
        }
    }
    for (const campo of codigoLimpo.matchAll(padraoCampos)) {
        propriedades.add(campo[1] ?? campo[2]);
    }
    return { nomes, propriedades, codigoLimpo };
}
function nomeFoiDefinido(texto, indice, definidos) {
    const codigo = definidos.codigoLimpo;
    let anterior = indice - 1;
    while (anterior >= 0 && /\s/.test(codigo[anterior]))
        anterior--;
    if (codigo[anterior] !== "." || codigo.slice(anterior - 2, anterior + 1) === "...") {
        return definidos.nomes.has(texto) || definidos.propriedades.has(texto);
    }
    // Uma função local chamada log não muda a cor do método em console.log.
    let fimDono = anterior - 1;
    while (fimDono >= 0 && /[\s?]/.test(codigo[fimDono]))
        fimDono--;
    let inicioDono = fimDono;
    while (inicioDono >= 0 && padraoPalavras.test(codigo[inicioDono]))
        inicioDono--;
    const dono = codigo.slice(inicioDono + 1, fimDono + 1);
    return definidos.propriedades.has(texto) && (definidos.nomes.has(dono) || dono === "this");
}
// Compartilha o destaque entre o editor e a apresentação do algoritmo.
function criarDestaque(codigo, definidos) {
    const fragmento = document.createDocumentFragment();
    let inicio = 0;
    for (const trecho of codigo.matchAll(padraoDestaques)) {
        const texto = trecho[0];
        const classe = /^(?:\/\/|\/\*)/.test(texto) ? "comentario"
            : /^["'`]/.test(texto) ? (stringEstaFechada(texto) ? "string" : "")
                : /^(?:\d|\.\d)/.test(texto) ? "numero"
                    : /^(?:true|false)$/.test(texto) ? "booleano"
                        : palavrasReservadas.has(texto) ? "palavra-reservada"
                            : (definidos ? nomeFoiDefinido(texto, trecho.index, definidos)
                                : new RegExp(`^${padraoNomeIdentificador}$`, "u").test(texto)) ? "identificador" : "";
        fragmento.append(document.createTextNode(codigo.slice(inicio, trecho.index)));
        const span = document.createElement("span");
        span.className = classe;
        span.textContent = texto;
        fragmento.append(span);
        inicio = trecho.index + texto.length;
    }
    fragmento.append(document.createTextNode(codigo.slice(inicio)));
    return fragmento;
}
function destacarCodigo(codigo, codigoLimpo) {
    codigoDestacado.replaceChildren(criarDestaque(codigo, encontrarNomesDefinidos(codigo, codigoLimpo)), document.createTextNode("\n "));
}
function sincronizarRolagem() {
    camadaDestaque.scrollTop = campoCodigo.scrollTop;
    camadaDestaque.scrollLeft = campoCodigo.scrollLeft;
}
function atualizarEstatisticas() {
    const contadorLinhas = document.getElementById("contador-linhas");
    const contadorCaracteres = document.getElementById("contador-caracteres");
    const codigo = campoCodigo.value;
    if (contadorLinhas) {
        const totalLinhas = codigo ? codigo.split(/\r\n|[\r\n\u2028\u2029]/).length : 1;
        contadorLinhas.textContent = `${totalLinhas} ${totalLinhas === 1 ? "linha" : "linhas"}`;
    }
    if (contadorCaracteres) {
        contadorCaracteres.textContent = `${codigo.length} caracteres`;
    }
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
    atualizarEstatisticas();
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
    for (const erro of analise.erros) {
        const item = document.createElement("li");
        const mensagem = document.createElement("p");
        mensagem.textContent = erro.mensagem;
        const indicador = criarIndicadorErro(codigo, erro);
        const localizacao = document.createElement("pre");
        const linha = document.createElement("code");
        const numeroLinha = String(erro.linha);
        const margem = " ".repeat(numeroLinha.length);
        linha.textContent = `${numeroLinha} | ${indicador.textoLinha}\n${margem} | ${indicador.espacosAteErro}\u2191 aqui`;
        localizacao.className = "localizacao-erro";
        localizacao.setAttribute("aria-label", `Local do erro: linha ${erro.linha}, coluna ${erro.coluna}`);
        localizacao.append(linha);
        item.append(mensagem, localizacao);
        listaErros.append(item);
    }
    listaErros.hidden = false;
}
// 8. Eventos e código disponível para explicar durante a apresentação
botaoAnalisar.addEventListener("click", mostrarResultado);
campoCodigo.addEventListener("input", atualizarEditor);
campoCodigo.addEventListener("scroll", sincronizarRolagem);
// Atalho de teclado para rodar a análise: Ctrl+Enter ou Cmd+Enter
campoCodigo.addEventListener("keydown", (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") {
        evento.preventDefault();
        mostrarResultado();
    }
});
// Ações rápidas da barra de ferramentas do editor
const botaoExemploSucesso = document.getElementById("botao-exemplo-sucesso");
const botaoExemploErro = document.getElementById("botao-exemplo-erro");
const botaoLimpar = document.getElementById("botao-limpar");
const botaoCopiar = document.getElementById("botao-copiar");
const botaoCopiarAlgoritmo = document.getElementById("botao-copiar-algoritmo");
const secaoAlgoritmo = document.getElementById("secao-algoritmo");
const visualizadorAlgoritmo = document.getElementById("visualizador-algoritmo");
const botaoMinimizarAlgoritmo = document.getElementById("botao-minimizar-algoritmo");
const textoMinimizarAlgoritmo = document.getElementById("texto-minimizar-algoritmo");
const pontoMinimizarAlgoritmo = document.getElementById("ponto-minimizar-algoritmo");

function alternarMinimizarAlgoritmo(minimizar) {
    if (!secaoAlgoritmo || !visualizadorAlgoritmo) {
        return;
    }
    const deveMinimizar = typeof minimizar === "boolean"
        ? minimizar
        : !secaoAlgoritmo.classList.contains("minimizado");

    secaoAlgoritmo.classList.toggle("minimizado", deveMinimizar);
    visualizadorAlgoritmo.hidden = deveMinimizar;

    if (botaoMinimizarAlgoritmo) {
        botaoMinimizarAlgoritmo.setAttribute("aria-expanded", String(!deveMinimizar));
        botaoMinimizarAlgoritmo.title = deveMinimizar
            ? "Expandir código do algoritmo"
            : "Minimizar código do algoritmo";

        const icone = botaoMinimizarAlgoritmo.querySelector(".icone-toggle");
        if (icone) {
            icone.innerHTML = deveMinimizar
                ? '<polyline points="6 9 12 15 18 9"></polyline>'
                : '<polyline points="18 15 12 9 6 15"></polyline>';
        }
    }

    if (textoMinimizarAlgoritmo) {
        textoMinimizarAlgoritmo.textContent = deveMinimizar ? "Expandir" : "Minimizar";
    }
}

botaoMinimizarAlgoritmo?.addEventListener("click", () => alternarMinimizarAlgoritmo());
pontoMinimizarAlgoritmo?.addEventListener("click", () => alternarMinimizarAlgoritmo());
pontoMinimizarAlgoritmo?.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        alternarMinimizarAlgoritmo();
    }
});
botaoExemploSucesso?.addEventListener("click", () => {
    campoCodigo.value = `// Código JavaScript válido para apresentação\nfunction calcularDesconto(valor, taxa) {\n  const valido = true;\n  if (valor > 100 && valido) {\n    return valor * (1 - taxa);\n  }\n  return valor;\n}\n\nconst total = calcularDesconto(250, 0.15);\nconsole.log("Total final:", total);`;
    atualizarEditor();
    mostrarResultado();
});
botaoExemploErro?.addEventListener("click", () => {
    campoCodigo.value = `// Demonstração de erros de delimitadores e strings\nfunction testarAnalise() {\n  const numeros = [1, 2, 3);\n  const mensagem = "string sem fechamento;\n  if (numeros.length > 0) {\n    return true;\n  }\n`;
    atualizarEditor();
    mostrarResultado();
});
botaoLimpar?.addEventListener("click", () => {
    campoCodigo.value = "";
    atualizarEditor();
    campoCodigo.focus();
});
let textoCodigoAlgoritmo = "";
function configurarCopia(botao, obterTexto) {
    botao?.addEventListener("click", async () => {
        const texto = obterTexto();
        if (!texto)
            return;
        // Evita que cliques sucessivos sobrescrevam o rótulo original.
        const original = Array.from(botao.childNodes, no => no.cloneNode(true));
        const desativado = botao.getAttribute("aria-disabled");
        if (desativado === "true")
            return;
        botao.setAttribute("aria-disabled", "true");
        try {
            await navigator.clipboard.writeText(texto);
            botao.textContent = "Copiado!";
        }
        catch {
            botao.textContent = "Falha ao copiar";
        }
        finally {
            setTimeout(() => {
                botao.replaceChildren(...original);
                if (desativado === null)
                    botao.removeAttribute("aria-disabled");
                else
                    botao.setAttribute("aria-disabled", desativado);
            }, 1800);
        }
    });
}
function renderizarAlgoritmoDestacado(codigo) {
    // Tokeniza o texto inteiro antes de separar linhas: preserva comentários
    // e strings que ocupam mais de uma linha.
    const destaque = criarDestaque(codigo);
    const fragmento = document.createDocumentFragment();
    let conteudo;
    let numero = 0;
    function novaLinha() {
        const linha = document.createElement("span");
        linha.className = "linha-codigo";
        const contador = document.createElement("span");
        contador.className = "numero-linha";
        contador.textContent = String(++numero);
        conteudo = document.createElement("span");
        conteudo.className = "texto-linha";
        linha.append(contador, conteudo);
        fragmento.append(linha);
    }
    novaLinha();
    for (const no of Array.from(destaque.childNodes)) {
        const partes = (no.textContent ?? "").split(/\r\n|[\r\n\u2028\u2029]/);
        partes.forEach((parte, indice) => {
            if (indice)
                novaLinha();
            const trecho = no.cloneNode(false);
            trecho.textContent = parte;
            conteudo.append(trecho);
        });
    }
    codigoAnalise.replaceChildren(fragmento);
}
configurarCopia(botaoCopiar, () => campoCodigo.value);
configurarCopia(botaoCopiarAlgoritmo, () => textoCodigoAlgoritmo);
atualizarEditor();
editorCodigo.classList.add("com-destaque");
textoCodigoAlgoritmo = [
    "// Validador de delimitadores: pilha LIFO; não é um compilador completo.",
    `const pares = ${JSON.stringify(pares)};`,
    `const padraoTextos = ${padraoTextos};`,
    ignorarStringsEComentarios.toString(),
    formatarPosicao.toString(),
    criarIndicadorErro.toString(),
    stringEstaFechada.toString(),
    encontrarStringIncompleta.toString(),
    analisarCodigo.toString()
].join("\n\n");
renderizarAlgoritmoDestacado(textoCodigoAlgoritmo);
