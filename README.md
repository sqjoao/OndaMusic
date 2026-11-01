# Onda

Player pessoal para **Windows 10/11 de 64 bits**, com instalador próprio. Não precisa manter navegador, VS Code, Node.js ou Git abertos para usar.

## Instalar pelo terminal

Abra o **PowerShell** e execute:

```powershell
irm https://raw.githubusercontent.com/sqjoao/Music/main/install.ps1 | iex
```

O comando baixa o instalador da última versão publicada no [GitHub Releases](https://github.com/sqjoao/Music/releases/latest), verifica o SHA-256 e instala para o seu usuário, sem exigir administrador. O instalador cria os atalhos do Onda. Repita o mesmo comando para atualizar ou instalar em outro PC.

A primeira versão precisa terminar de ser gerada pelo workflow **Release Windows**. Se não existir uma release, o script informa que o instalador ainda não está disponível. O instalador não tem assinatura comercial: o Windows pode mostrar o SmartScreen identificando um editor desconhecido. O script mantém a verificação de HTTPS e de checksum e não altera as políticas de segurança do computador.

## Músicas incluídas no app

A tela inicial é a biblioteca, sem categorias. Coloque os áudios na pasta `musicas`, ao lado do `package.json`. Subpastas também são lidas:

```text
musicas/
  Artista - Minha música.mp3
  Outra faixa.flac
  Album/
    Faixa 01.wav
```

Ao gerar o instalador, os arquivos são copiados para os recursos do aplicativo. Eles aparecem automaticamente ao abrir o Onda, inclusive em outro PC que instalar essa mesma versão, sem importação e sem internet. O player lê os arquivos diretamente, sem duplicá-los no IndexedDB. Favoritos e playlists continuam salvos no perfil local. A duração de uma música incluída é identificada na primeira reprodução.

Para adicionar/remover músicas embutidas, altere a pasta `musicas` e gere uma nova versão. Modificar a pasta do projeto não altera um aplicativo já instalado. O instalador cresce conforme o tamanho dos áudios. A pasta está vazia nesta versão: nenhum áudio de exemplo é distribuído.

- Para gerar localmente, use `npm ci` e `npm run dist:win` no Windows. O instalador ficará em `dist`.
- Para gerar pelo workflow do GitHub, os áudios precisam estar no commit da versão. **Seu repositório é público: arquivos de música enviados para ele também ficam públicos.** Você pode manter os áudios apenas no computador e gerar o instalador localmente.
- Use nomes como `Artista - Música.mp3` para separar título e artista. Tags ID3 ainda não são lidas.
- Continua possível importar arquivos pelo botão **Adicionar músicas**; essas importações são locais e não entram nos instaladores.
- Para remover uma faixa incluída no instalador, retire-a de `musicas` e gere outra versão. O menu da faixa informa essa diferença.

Favoritas, playlists, busca, fila, repetição, aleatório, volume e atalhos continuam disponíveis. MP3, WAV, OGG, M4A, AAC, FLAC, OPUS, AIFF e WEBM são reconhecidos; a reprodução depende dos codecs do Electron.

## Personalizar

A engrenagem abre temas claro/escuro/sistema, cor de destaque, fontes comuns ou outra fonte instalada no Windows, tamanho da interface, espaçamento e cantos arredondados. Você pode escolher um wallpaper PNG/JPEG/WebP de até 20 MB, suavização do fundo, opacidade e desfoque dos painéis. As escolhas ficam salvas; restaurar a aparência não apaga suas músicas.

## Dados locais

Áudios importados e wallpaper ficam no IndexedDB; músicas embutidas ficam na pasta de recursos do programa. Playlists e preferências são locais. A pasta do perfil no Windows é `%APPDATA%\Onda`. Atualizações mantêm o mesmo perfil. Desinstalar não apaga esse perfil automaticamente.

Não há conta nem sincronização de favoritos e playlists. Outro computador recebe as músicas embutidas na versão instalada; as importadas manualmente precisam ser importadas novamente. Dados anteriormente importados no Live Server/navegador pertencem a outro perfil e não são transferidos automaticamente. Preserve os arquivos originais. O app funciona sem internet após instalado; a internet só é necessária para baixar/atualizar o instalador.

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
