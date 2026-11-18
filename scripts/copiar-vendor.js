// Copia as bibliotecas de leitura de PDF, zip e OCR para app/vendor,
// para o app funcionar sem internet.
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const destino = path.join(raiz, "app", "vendor");
const destOcr = path.join(destino, "tesseract");
fs.mkdirSync(destOcr, { recursive: true });

const arquivos = [
  ["node_modules/pdfjs-dist/build/pdf.min.js", "pdf.min.js"],
  ["node_modules/pdfjs-dist/build/pdf.worker.min.js", "pdf.worker.min.js"],
  ["node_modules/jszip/dist/jszip.min.js", "jszip.min.js"],
  // OCR (usado só no extrato da Conta Investimento BTG, cujas descrições são imagens)
  ["node_modules/tesseract.js/dist/tesseract.min.js", "tesseract/tesseract.min.js"],
  ["node_modules/tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
];
for (const [origem, nome] of arquivos) {
  fs.copyFileSync(path.join(raiz, origem), path.join(destino, nome));
  console.log(`vendor/${nome} copiado`);
}

// Núcleo do OCR: só as variantes LSTM em um arquivo (.wasm.js), que é o que o worker usa
const core = path.join(raiz, "node_modules", "tesseract.js-core");
for (const f of fs.readdirSync(core).filter((f) => /^tesseract-core-.*lstm\.wasm\.js$/.test(f))) {
  fs.copyFileSync(path.join(core, f), path.join(destOcr, f));
  console.log(`vendor/tesseract/${f} copiado`);
}

// Idioma português (baixado uma vez; se falhar, o programa usa a internet na hora do OCR)
const idioma = path.join(destOcr, "por.traineddata.gz");
const URL_IDIOMA = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz";
(async () => {
  if (fs.existsSync(idioma) && fs.statSync(idioma).size > 1000000) { console.log("vendor/tesseract/por.traineddata.gz já existe"); return; }
  try {
    const r = await fetch(URL_IDIOMA);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    fs.writeFileSync(idioma, Buffer.from(await r.arrayBuffer()));
    console.log(`vendor/tesseract/por.traineddata.gz baixado (${Math.round(fs.statSync(idioma).size / 1e6)} MB)`);
  } catch (e) {
    console.warn(`AVISO: não foi possível baixar o idioma do OCR (${e.message}). O OCR vai usar a internet.`);
  }
})();
