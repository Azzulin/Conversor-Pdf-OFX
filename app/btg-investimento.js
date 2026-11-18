// Leitor do "Extrato da Conta Investimento" do BTG Pactual.
//
// Neste PDF só as datas e os valores são texto; descrições, títulos e número da conta são desenhos
// (contornos vetoriais). Por isso:
//   - datas, valores e saldos vêm do texto do PDF e são conferidos linha a linha pelo saldo;
//   - descrições e conta são lidas por OCR (Tesseract), feito no próprio computador.
// Se o OCR não estiver disponível, os lançamentos saem como "Crédito"/"Débito" e a conta fica para preencher.
(function () {
  "use strict";
  const RE_DATA = /^\d{2}\/\d{2}\/\d{2}$/;
  const RE_VALOR = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const valor = s => parseFloat(s.replace(/\./g, "").replace(",", "."));
  const r2 = v => Math.round(v * 100) / 100;
  const ymd = s => `20${s.slice(6, 8)}${s.slice(3, 5)}${s.slice(0, 2)}`;

  // Reconhece pelo SAC do BTG e por linhas só com "data valor saldo" (as descrições não viram texto)
  function reconhece(texto) {
    if (!/0800-772-2827/.test(texto)) return false;
    const linhas = texto.split("\n").filter(l => /^\d{2}\/\d{2}\/\d{2} -?[\d.]+,\d{2} -?[\d.]+,\d{2}$/.test(l.trim()));
    return linhas.length >= 2;
  }

  /* ---------- linhas com posição ---------- */
  async function linhasDoPdf(pdf) {
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      // Neste PDF o pdf.js devolve um caractere por item: junta por linha e depois em palavras pela distância
      const grupos = [];
      for (const it of tc.items) {
        const s = typeof it.str === "string" ? it.str : "";
        if (!s) continue;
        const y = it.transform[5];
        let g = grupos.find(g => Math.abs(g.y - y) <= 2);
        if (!g) { g = { y, its: [] }; grupos.push(g); }
        g.its.push({ s, x: it.transform[4], w: it.width || 0 });
      }
      grupos.sort((a, b) => b.y - a.y);
      for (const g of grupos) {
        g.its.sort((a, b) => a.x - b.x);
        g.ws = [];
        let atual = null, fim = null;
        for (const it of g.its) {
          for (const [k, ch] of [...it.s].entries()) {
            const x = it.x + (it.s.length ? it.w * (k / it.s.length) : 0);
            const xFim = it.x + (it.s.length ? it.w * ((k + 1) / it.s.length) : 0);
            if (/\s/.test(ch)) { atual = null; fim = xFim; continue; }
            if (atual && fim != null && x - fim <= 2) atual.s += ch;
            else { atual = { s: ch, x }; g.ws.push(atual); }
            fim = xFim;
          }
        }
        const d = g.ws[0];
        if (!RE_DATA.test(d.s) || d.x > 80) continue;
        const nums = g.ws.slice(1).filter(w => RE_VALOR.test(w.s)).map(w => ({ v: valor(w.s), x: w.x }));
        if (nums.length && nums.length === g.ws.length - 1) out.push({ pagina: p, y: g.y, xData: d.x, data: ymd(d.s), nums });
      }
    }
    return out;
  }

  // Maior sequência "saldo anterior → lançamentos que fecham o saldo → saldo final"
  function acharMovimento(linhas) {
    let melhor = null, atual = null;
    const fechar = () => { if (atual && atual.tx.length && (!melhor || atual.tx.length > melhor.tx.length)) melhor = atual; };
    for (const l of linhas) {
      if (l.nums.length === 1) {
        const v = l.nums[0].v;
        if (atual && atual.tx.length && Math.abs(r2(atual.saldo - v)) < 0.005) { atual.saldoFinal = v; fechar(); atual = null; continue; }
        fechar();
        atual = { saldoInicial: v, saldo: v, tx: [], saldoFinal: null };
        continue;
      }
      if (l.nums.length === 2 && atual) {
        const [mov, saldo] = l.nums;
        if (Math.abs(r2(atual.saldo + mov.v) - saldo.v) < 0.005) {
          atual.saldo = saldo.v;
          atual.tx.push({ data: l.data, valor: r2(mov.v), saldoApos: saldo.v, pagina: l.pagina, y: l.y, x0: l.xData + 48, x1: mov.x - 3 });
          continue;
        }
      }
      fechar(); atual = null;
    }
    fechar();
    return melhor;
  }

  /* ---------- OCR (Tesseract), carregado só quando precisa ---------- */
  const CDN = {
    js: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    lang: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int",
  };
  const abs = p => new URL(p, location.href).href;
  function script(src) {
    return new Promise((ok, falha) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = falha; document.head.append(s); });
  }
  let workerP = null;
  function obterWorker() {
    if (workerP) return workerP;
    workerP = (async () => {
      // 1º: cópia local (programa instalado / versão web); 2º: internet
      const opcoes = [
        { js: abs("vendor/tesseract/tesseract.min.js"), cfg: { workerPath: abs("vendor/tesseract/worker.min.js"), corePath: abs("vendor/tesseract/"), langPath: abs("vendor/tesseract/"), workerBlobURL: false } },
        { js: CDN.js, cfg: { workerPath: CDN.worker, corePath: CDN.core, langPath: CDN.lang } },
      ];
      let ultimoErro = null;
      for (const o of opcoes) {
        try {
          if (!window.Tesseract) await script(o.js);
          const w = await Promise.race([
            Tesseract.createWorker("por", 1, o.cfg),
            new Promise((_, f) => setTimeout(() => f(new Error("tempo esgotado ao iniciar o OCR")), 60000)),
          ]);
          return w;
        } catch (e) { ultimoErro = e; console.warn("OCR indisponível em", o.js, e); }
      }
      throw ultimoErro || new Error("OCR indisponível");
    })();
    workerP.catch(() => { workerP = null; });
    return workerP;
  }

  async function renderizar(pdf, numPagina, escala) {
    const page = await pdf.getPage(numPagina);
    const vp = page.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent "print": não depende de requestAnimationFrame, que para quando a janela está oculta
    await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
    return { canvas, altura: page.getViewport({ scale: 1 }).height };
  }
  function recorte(origem, x, y, w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(origem, Math.round(x), Math.round(y), c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  // Operações que aparecem no começo da descrição; corrige 1-2 letras trocadas pelo OCR (ex.: IRRE → IRRF)
  const OPERACOES = ["CUPOM", "IRRF", "IOF", "VENCIMENTO", "COMPRA", "VENDA", "RESGATE", "APLICAÇÃO", "TRANSFERÊNCIA", "AMORTIZAÇÃO",
    "JUROS", "RENDIMENTO", "DIVIDENDOS", "TAXA", "TARIFA", "TED", "PIX", "LIQUIDAÇÃO", "DÉBITO", "CRÉDITO", "ESTORNO", "PAGAMENTO"];
  function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const semAcento = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  function corrigirOperacao(t) {
    const m = t.match(/^(\S+)(.*)$/);
    if (!m || OPERACOES.includes(m[1])) return t;
    let melhor = null, md = 99;
    for (const op of OPERACOES) {
      const d = distancia(semAcento(m[1]), semAcento(op));
      if (d < md) { md = d; melhor = op; }
    }
    return melhor && md <= (melhor.length >= 8 ? 2 : 1) ? melhor + m[2] : t;
  }

  // Limpeza do OCR com erros típicos deste extrato
  function limpar(s) {
    let t = String(s || "").replace(/[|_~`´^"]/g, " ").replace(/\$/g, "S").replace(/\s+/g, " ").trim().toUpperCase();
    t = corrigirOperacao(t);
    t = t.replace(/(\s+[^A-Z0-9\s]{1,3}|\s+[À-Ý]\.?)+$/, "").replace(/[\s.,;:-]+$/, "");  // sujeira no fim
    t = t.replace(/VENC\s*[.:,;]+\s*:?\s*/g, "VENC.: ");                 // "VENC::" / "VENC:" → "VENC.:"
    // código do título no fim (ex.: CDB7240IHKA): sem espaços; "/" e "|" no meio viram "I"
    t = t.replace(/\b(CDB|LCI|LCA|CRI|CRA|LF|DEB)\s*([0-9A-Z\/ ]{4,14})$/, (m, tipo, cod) => tipo + cod.replace(/\s+/g, "").replace(/\//g, "I"));
    return t;
  }

  // O mesmo título aparece em várias linhas (CUPOM, IRRF, VENCIMENTO) com o mesmo emissor e vencimento.
  // O OCR às vezes troca um caractere do código em uma delas: usa a versão mais provável em todas.
  function harmonizarCodigos(tx) {
    const RE = /\b(CDB|LCI|LCA|CRI|CRA|LF|DEB)([0-9A-Z]{5,12})$/;
    const chave = t => {
      const venc = (t.desc.match(/VENC\.:\s*(\S+)/) || [])[1];
      const emissor = (t.desc.match(/-\s*(?:CDB|LCI|LCA|CRI|CRA|LF|DEB)\s+(\S+\s+\S+)/) || [])[1];
      return venc && emissor ? venc + "|" + emissor : null;
    };
    const grupos = new Map();
    for (const t of tx) {
      if (!t.desc || !RE.test(t.desc)) continue;
      const k = chave(t); if (!k) continue;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(t);
    }
    for (const lista of grupos.values()) {
      if (lista.length < 2) continue;
      const conta = new Map();
      for (const t of lista) { const c = t.desc.match(RE)[0]; conta.set(c, (conta.get(c) || 0) + 1); }
      // preferência: dígito logo depois do tipo (CDB1… e não CDBI…), depois a mais frequente, depois a mais curta (o OCR costuma inserir letras)
      const melhor = [...conta.entries()].sort((a, b) =>
        (/^[A-Z]{2,3}\d/.test(b[0]) - /^[A-Z]{2,3}\d/.test(a[0])) || b[1] - a[1] || a[0].length - b[0].length)[0][0];
      for (const t of lista) t.desc = t.desc.replace(RE, melhor);
    }
  }

  /* ---------- leitura completa ---------- */
  async function ler(buf, progresso) {
    const avisar = m => { try { progresso && progresso(m); } catch { /* sem tela */ } };
    const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
    const mov = acharMovimento(await linhasDoPdf(pdf));
    if (!mov) throw new Error("Extrato da Conta Investimento BTG reconhecido, mas a movimentação não foi encontrada (os saldos não fecharam).");

    const info = { banco: "BTG Pactual - Conta Investimento", bankid: "208", agencia: "", conta: "", inicio: mov.tx[0].data, fim: mov.tx[mov.tx.length - 1].data, saldo: mov.saldoFinal ?? mov.saldo, saldoInicial: mov.saldoInicial };
    const avisos = [];
    let worker = null;
    try {
      avisar("BTG Conta Investimento: preparando a leitura das descrições (OCR)…");
      worker = await obterWorker();
    } catch (e) {
      avisos.push("Não foi possível ler as descrições por OCR (leitor de imagem indisponível). Os lançamentos ficaram como \"Crédito\"/\"Débito\"; datas e valores estão corretos.");
    }

    if (worker) {
      // Conta e período: no topo das primeiras páginas, também em desenho
      for (let p = 1; p <= Math.min(2, pdf.numPages) && !info.conta; p++) {
        avisar("BTG Conta Investimento: lendo o número da conta…");
        const { canvas } = await renderizar(pdf, p, 2.5);
        await worker.setParameters({ tessedit_pageseg_mode: "3" });
        const { data } = await worker.recognize(canvas);
        const t = data.text || "";
        const mc = t.match(/Conta\s+investimento\s*:?\s*([\d.\-]{5,})/i);
        if (mc) info.conta = mc[1].replace(/\D/g, "");
        const mp = t.match(/Per[ií]odo\s+de\s+(\d{2}\/\d{2}\/\d{2,4})\s+a\s+(\d{2}\/\d{2}\/\d{2,4})/i);
        if (mp) {
          const conv = s => s.length === 8 ? ymd(s) : `${s.slice(6, 10)}${s.slice(3, 5)}${s.slice(0, 2)}`;
          info.inicio = conv(mp[1]); info.fim = conv(mp[2]);
        }
      }
      // Descrições: uma linha por vez, recortada da página renderizada
      const ESC = 4;
      await worker.setParameters({ tessedit_pageseg_mode: "7" });
      const paginas = new Map();
      for (const [i, t] of mov.tx.entries()) {
        avisar(`BTG Conta Investimento: lendo descrições (${i + 1} de ${mov.tx.length})…`);
        if (!paginas.has(t.pagina)) paginas.set(t.pagina, await renderizar(pdf, t.pagina, ESC));
        const { canvas, altura } = paginas.get(t.pagina);
        const topo = (altura - t.y - 9) * ESC;
        const img = recorte(canvas, t.x0 * ESC, topo, (t.x1 - t.x0) * ESC, 13 * ESC);
        try { t.desc = limpar((await worker.recognize(img)).data.text); } catch { t.desc = ""; }
      }
      if (mov.tx.some(t => !t.desc)) avisos.push("Algumas descrições não puderam ser lidas e ficaram como \"Crédito\"/\"Débito\".");
      avisos.push("As descrições deste extrato são imagens no PDF e foram lidas por OCR. Confira se estão corretas antes de importar.");
      if (!info.conta) avisos.push("Não consegui ler o número da conta investimento. Preencha a conta antes de baixar.");
    }
    harmonizarCodigos(mov.tx);
    for (const t of mov.tx) {
      if (!t.desc) t.desc = t.valor > 0 ? "Crédito" : "Débito";
      delete t.pagina; delete t.y; delete t.x0; delete t.x1;
    }
    return { info, tx: mov.tx, avisos };
  }

  window.LeitorBtgInvestimento = { reconhece, ler, acharMovimento, linhasDoPdf };
})();
