// Teste automático do programa compilado (usado no GitHub Actions).
// Abre o executável com CONVERSOR_SMOKE definido; o programa procura atualização como de costume,
// abre a janela principal, confere se a interface e o leitor de PDF carregaram e se fecha sozinho.
// Falha se o programa sumir sem abrir a janela, travar ou não carregar a interface.
//
// Uso: node scripts/smoke-test.js <executável> [argumentos extras]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [exe, ...extras] = process.argv.slice(2);
if (!exe) {
  console.error("Informe o caminho do executável.");
  process.exit(2);
}

const resultado = path.join(os.tmpdir(), `conversor-smoke-${Date.now()}.json`);
const proc = spawn(exe, extras, { env: { ...process.env, CONVERSOR_SMOKE: resultado }, stdio: "inherit" });

const limite = setTimeout(() => {
  console.error("Tempo esgotado: o programa não terminou o teste em 120 segundos.");
  proc.kill();
}, 120000);

proc.on("error", (e) => {
  clearTimeout(limite);
  console.error("Não foi possível abrir o programa:", e.message);
  process.exit(1);
});

proc.on("exit", (codigo) => {
  clearTimeout(limite);
  let r = null;
  try { r = JSON.parse(fs.readFileSync(resultado, "utf8")); } catch { /* sem resultado = falha */ }
  if (r) {
    console.log("Registro do programa:");
    for (const linha of r.registro || []) console.log("  " + linha);
    console.log("Detalhes:", JSON.stringify(r.detalhes));
  } else {
    console.error("O programa fechou sem gravar o resultado do teste (sumiu antes de abrir a janela principal?).");
  }
  if (codigo === 0 && r && r.ok) {
    console.log(`TESTE OK: versão ${r.versao} abriu a janela principal com o conversor carregado.`);
    process.exit(0);
  }
  console.error(`TESTE FALHOU (código de saída ${codigo}).`);
  process.exit(1);
});
