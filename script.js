const campoCodigo = document.getElementById("codigo");
const botaoAnalisar = document.getElementById("botao-analisar");
const resultadoAnalise = document.getElementById("resultado");

function iniciarAnalise() {
  // trim() permite tratar um campo com apenas espaços como vazio.
  if (campoCodigo.value.trim() === "") {
    resultadoAnalise.textContent = "Digite um código para analisar";
    return;
  }

 resultadoAnalise.textContent = analisarParenteses(campoCodigo.value);
}

botaoAnalisar.addEventListener("click", iniciarAnalise);

function analisarParenteses(codigo) {
    const pilha = [];

    for (const caractere of codigo) {
        if (caractere === "(") {
            pilha.push(caractere);
        }

        if (caractere === ")") {
            if (pilha.length === 0) {
                return "Erro: fechamento sem abertura";
            }

            pilha.pop();
        }
    }

    if (pilha.length > 0) {
        return "Erro: abertura sem fechamento";
    }

    return "Parênteses corretos";
}