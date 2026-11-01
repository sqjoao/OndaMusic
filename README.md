# Onda

Player pessoal para **Windows 10/11 de 64 bits**, com instalador próprio. Não precisa manter navegador, VS Code, Node.js ou Git abertos para usar.

## Instalar pelo terminal

Abra o **PowerShell** e execute:

```powershell
irm https://raw.githubusercontent.com/sqjoao/Music/main/install.ps1 | iex
```

O comando baixa o instalador da última versão publicada no [GitHub Releases](https://github.com/sqjoao/Music/releases/latest), verifica o SHA-256 e instala para o seu usuário, sem exigir administrador. O instalador cria os atalhos do Onda. Repita o mesmo comando para atualizar ou instalar em outro PC.

A primeira versão precisa terminar de ser gerada pelo workflow **Release Windows**. Se não existir uma release, o script informa que o instalador ainda não está disponível. O instalador não tem assinatura comercial: o Windows pode mostrar o SmartScreen identificando um editor desconhecido. O script mantém a verificação de HTTPS e de checksum e não altera as políticas de segurança do computador.

## Biblioteca e categorias

A página inicial mostra Rock, Funk, Sertanejo, Pagode, Pop, MPB, Rap, Eletrônica e Sem categoria. Você também pode criar categorias.

- Para importar, abra **Biblioteca → Adicionar músicas**, ou abra uma categoria e importe nela. Arquivos importados dentro da categoria já ficam classificados nela.
- Arquivos também podem ser arrastados para a janela. A seleção de uma pasta com subpastas nomeadas como as categorias permite classificar as faixas pelo nome da pasta.
- Para mudar a categoria de uma música existente, abra seu menu de três pontos, escolha a categoria e clique em **Salvar categoria**.
- Favoritas, playlists, busca, fila, repetição, aleatório, volume e atalhos continuam disponíveis.
- O padrão `Artista - Música.mp3` separa artista e título. Tags ID3 ainda não são lidas. Os formatos reproduzíveis dependem dos codecs do Electron.

## Personalizar

A engrenagem abre temas claro/escuro/sistema, cor de destaque, fontes comuns ou outra fonte instalada no Windows, tamanho da interface, espaçamento e cantos arredondados. Você pode escolher um wallpaper PNG/JPEG/WebP de até 20 MB, suavização do fundo, opacidade e desfoque dos painéis. As escolhas ficam salvas; restaurar a aparência não apaga suas músicas.

## Dados locais

Os áudios e o wallpaper ficam no IndexedDB do app; playlists, categorias e preferências são locais. A pasta do perfil no Windows é `%APPDATA%\Onda`. Atualizações mantêm o mesmo perfil. Desinstalar não apaga esse perfil automaticamente.

Não há conta nem sincronização: em outro computador você precisa importar suas músicas. Dados anteriormente importados no Live Server/navegador pertencem a outro perfil e não são transferidos automaticamente. Preserve os arquivos originais. O app funciona sem internet após instalado; a internet só é necessária para baixar/atualizar o instalador.

## Desenvolvimento

Com Node.js 22.12+ (recomendado 24) instalado:

```sh
npm ci
npm start
```

Para gerar instaladores Windows no Windows:

```sh
npm run dist:win
```

O workflow em `.github/workflows/release.yml` gera as versões x64 e ARM64 e publica os instaladores com `SHA256SUMS` quando uma tag `v<versão>` é enviada. O número da tag deve corresponder ao `package.json`. Não é necessário configurar GitHub Pages. O aplicativo usa Electron com renderer isolado, sem Node.js na página, e carrega somente arquivos locais.

Os arquivos da interface continuam sendo `index.html`, `styles.css` e `app.js` (inclui reprodução, armazenamento e aparência). `desktop/main.cjs` abre a janela nativa. `package.json` e `package-lock.json` fixam a construção. `install.ps1` instala a versão publicada. Arquivos de PWA, manifestos do navegador e service workers foram removidos.
