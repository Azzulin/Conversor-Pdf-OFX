# Conversor de Extratos OFX

Programa que converte extratos bancários em PDF para **OFX**, pronto para importar no sistema contábil.
Ele lê os lançamentos, confere com os saldos do próprio extrato e avisa quando algo não fecha.

O PDF é lido no próprio computador. Nenhum extrato é enviado para a internet.

## Bancos aceitos

| Banco | Código | Observação |
|---|---|---|
| Banco do Brasil | 001 | O extrato não traz agência/conta: preencher na tela |
| Banrisul | 041 | |
| Caixa | 104 | Extrato do gerenciador e extrato impresso do internet banking ("extrato_pdf") |
| Banco Inter | 077 | |
| C6 Bank | 336 | Só extrato em texto; PDF em imagem não é lido |
| BTG Pactual - Conta Investimento | 208 | As descrições são imagens no PDF e são lidas por OCR (confira). A agência não consta: preencher |
| iFood - Conta Digital | 595 | O extrato não traz agência. O "saldo disponível" do cabeçalho pode diferir do saldo do último dia; o OFX usa o saldo do dia |
| InfinitePay - relatório de vendas | 542 | Não é extrato de conta: cada venda aprovada entra pelo valor bruto e a taxa sai separada. Conferido pelos totais do relatório. Vendas negadas ficam de fora |
| Nubank | 0260 | |
| PagSeguro | 290 | |
| RecargaPay (Rec-Pay) | 000 | Código do banco não encontrado (o Domínio usa a conta escolhida na tela). O cabeçalho não soma rendimento CDI e cashback, por isso a tela pode mostrar uma diferença pequena |
| Sicoob | 756 | |
| Sicredi | 748 | |
| Stone | 197 | Agência/conta podem precisar de preenchimento |
| Unicred | 136 | |
| XP Investimentos | 102 | O extrato não traz agência: preencher se o sistema exigir |

PDFs escaneados ou em imagem (por exemplo, alguns extratos do C6) não têm texto e não podem ser lidos.

No **Extrato da Conta Investimento do BTG**, só datas e valores são texto; descrições e número da conta são desenhos. O programa confere datas, valores e saldos pelo texto e lê as descrições e a conta por OCR (reconhecimento de imagem), no próprio computador. Leva de 20 a 40 segundos por extrato. Sem o OCR, os lançamentos saem como "Crédito"/"Débito".

## Como baixar e instalar

1. Abra a página **Releases** deste repositório.
2. Baixe o arquivo do seu sistema:
   - **Windows:** `Conversor-Extratos-OFX-x.y.z-win-x64.exe` (instalador) ou `...-portatil.exe` (roda sem instalar)
   - **Mac:** `.dmg`
   - **Linux:** `.AppImage`
3. Abra e use.

O programa não tem assinatura digital paga. Por isso:
- **Windows:** pode aparecer "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**. Em máquinas com *Smart App Control* ligado, o Windows pode bloquear de vez; nesse caso use a versão web.
- **Mac:** na primeira vez, clique com o botão direito no app → **Abrir**.

## Atualização automática

Sempre que o programa abre, ele procura uma versão nova por até 8 segundos:

- **Tem versão nova:** baixa (mostrando o progresso), instala e reinicia sozinho. Dá para clicar em **Continuar sem esperar**; aí o download segue em segundo plano e a instalação acontece ao fechar o programa.
- **Não tem, ou está sem internet:** abre normalmente.

Funciona no **instalador do Windows** e no **AppImage do Linux**. A versão **portátil** do Windows e o **Mac** não conseguem se instalar sozinhos: eles avisam que existe versão nova e abrem a página de download.

As versões são buscadas nas Releases deste repositório, que precisa ser **público**. O programa não usa nem guarda nenhum token ou senha.

A atualização automática existe a partir da versão 1.1.0. Quem tem a 1.0.0 precisa instalar uma versão mais nova manualmente uma vez.

### Se algo der errado

O programa grava o que acontece em um arquivo de registro:

- **Windows:** `%APPDATA%\Conversor de Extratos OFX\registro.log` (cole esse endereço na barra do Explorador de Arquivos)
- **Mac:** `~/Library/Application Support/Conversor de Extratos OFX/registro.log`
- **Linux:** `~/.config/Conversor de Extratos OFX/registro.log`

Esse arquivo mostra a versão instalada, o resultado da busca por atualização e qualquer erro.

## Testes automáticos

A cada envio para a `main`, o workflow **Verificar** compila o programa e o abre de verdade no Windows e no Linux, conferindo se a janela principal aparece com o conversor carregado. O mesmo teste roda antes de publicar uma versão: se falhar, a versão não é publicada.

## Como usar

1. Arraste um ou vários PDFs para a janela (ou clique para escolher).
2. Confira os lançamentos e o selo de saldo. Se agência ou conta estiverem em destaque, preencha.
3. Clique em **Baixar OFX** e escolha a pasta. Os arquivos `.ofx` são salvos lá.

## Publicar uma nova versão

1. Atualize o campo `version` no `package.json` (ex.: `1.1.0`).
2. Crie a tag e envie:
   ```
   git tag v1.1.0
   git push origin v1.1.0
   ```
3. A aba **Actions** gera os instaladores de Windows, Mac e Linux e cria a Release automaticamente.
4. Na próxima vez que cada pessoa abrir o programa, ele se atualiza sozinho.

A versão da tag precisa ser igual à do `package.json`. É por ela que o programa compara se há algo mais novo.

Também dá para gerar os instaladores sem criar Release: **Actions → Gerar instaladores → Run workflow**. Os arquivos ficam nos *artifacts* da execução.

## Versão web (sem instalar)

**https://azzulin.github.io/Conversor-Pdf-OFX/**

O mesmo conversor, abrindo no navegador em qualquer computador: não instala nada, não precisa de conta e baixa o `.ofx` direto.
Como não é um programa, o Windows (Smart App Control / SmartScreen) não bloqueia. É a opção indicada para computadores onde o instalador é barrado.

O workflow **Publicar versão web** atualiza o site a cada envio para a `main`.

## Rodar no próprio computador (desenvolvimento)

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
```

Também dá para abrir `app/index.html` direto no navegador. Sem a pasta `app/vendor`, as bibliotecas são carregadas da internet.

## Estrutura

```
app/index.html            Interface e toda a lógica de leitura dos extratos
app/atualizacao.html      Janela "Procurando atualizações" mostrada ao abrir
main.js                   App desktop (janela, atualização automática e gravação dos arquivos)
preload.js                Ponte segura entre a interface e o app
scripts/copiar-vendor.js  Copia as bibliotecas de PDF para app/vendor
scripts/smoke-test.js     Abre o programa compilado e confere se funcionou (usado nos testes)
.github/workflows/        Build dos instaladores e publicação web
```

## Incluir um banco novo

Toda a leitura fica em `app/index.html`:

1. Crie uma função `lerNomeDoBanco(texto)` que devolve `{ info, tx }`:
   - `info`: banco, código (`bankid`), agência, conta, período, `saldoInicial` e `saldo` final quando o extrato informar.
   - `tx`: lista de `{ data: "AAAAMMDD", desc, valor, saldoApos? }`. Débitos com valor negativo. `saldoApos` é o saldo depois do lançamento, quando o extrato mostra; ele é usado na conferência.
2. Registre o banco na lista `LEITORES`, com um teste que reconheça o cabeçalho do extrato.
3. Teste com um PDF real e confira se aparece **✔ Saldo confere**.

Nunca coloque extratos de clientes no repositório. O `.gitignore` já bloqueia `.pdf`, `.ofx` e `.txt`.
