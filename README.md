# onda.

Um player de música pessoal para desktop, feito com HTML, CSS e JavaScript puro. Instalável como **PWA**, com janela própria e acesso offline. Sem contas, anúncios ou etapa de build.

## Instalar no PC

Depois de ativar a publicação abaixo, o endereço do app será **https://sqjoao.github.io/Music/**.

1. Abra esse endereço no **Chrome ou Edge** com conexão à internet.
2. Abra **Configurações** (engrenagem) e clique em **Instalar no computador**. Também é possível usar a opção **Instalar onda** do menu ou da barra de endereço do navegador.
3. Confirme a instalação. O onda aparecerá entre os aplicativos do computador e abrirá em uma janela própria.
4. Aguarde a mensagem **Disponível offline neste dispositivo** nas configurações. Depois disso, abra pelo atalho mesmo sem internet e importe suas músicas normalmente.

Para instalar em outro PC, repita os passos usando **o mesmo endereço**. Não é preciso baixar o código, instalar Python ou manter o VS Code aberto. No Safari do Mac, a alternativa é **Arquivo → Adicionar ao Dock**. O nome da opção de instalação pode variar conforme a versão do navegador.

Este é um app instalado pelo navegador, não um instalador `.exe`. Ele usa o navegador como base, mas funciona em sua própria janela. O navegador precisa continuar instalado.

### Publicar o endereço uma única vez

O projeto está pronto para hospedagem estática pelo GitHub Pages, sem configurar servidor ou adicionar dependências:

1. Abra [Settings → Pages do repositório](https://github.com/sqjoao/Music/settings/pages).
2. Em **Build and deployment**, escolha **Deploy from a branch**.
3. Selecione a branch **main**, pasta **/(root)**, e clique em **Save**.
4. Aguarde o GitHub mostrar que a publicação terminou e abra o endereço informado por ele.

O arquivo `.nojekyll` mantém a publicação como arquivos estáticos. O código-fonte já enviado ao GitHub não significa que o site já foi publicado.

**Cada PC mantém sua própria biblioteca.** Músicas e playlists não são enviadas ao GitHub nem sincronizadas entre computadores: importe os arquivos em cada dispositivo. Dados que você já importou em `localhost`/Live Server continuam nessa origem e não aparecem automaticamente no endereço do GitHub Pages.

### Atualizações

O app verifica novas versões quando é aberto ou volta a ficar online. Nas configurações, **Atualizar app** aparece quando uma versão está pronta. Esse botão reinicia o player; a atualização não interrompe uma música automaticamente. Fechar todas as janelas do app e reabrir também permite aplicar a próxima versão. Músicas, playlists e preferências continuam salvas.

Ao modificar e publicar os arquivos do app, incremente `CACHE_VERSION` em `sw.js`. O navegador baixa o conjunto novo antes de oferecê-lo para uso offline. O cache contém só os arquivos da interface; os áudios continuam no IndexedDB.

## Desenvolver no VS Code

No **VS Code**, abra a pasta do projeto, instale a extensão **Live Server** e use **Open with Live Server** no arquivo `index.html`.

Como alternativa, use Python:

Na pasta do projeto, inicie um servidor de arquivos estáticos:

```sh
cd /workspace/Music
python3 -m http.server 8000 --bind 0.0.0.0
```

Em uma máquina local, abra `http://localhost:8000` no navegador. Também é possível usar outro servidor estático, como a extensão Live Server. Sirva os arquivos por HTTP em localhost ou por HTTPS; abrir `index.html` diretamente com `file://` não carrega os módulos JavaScript corretamente.

## Adicionar músicas

- Clique em **Adicionar músicas** ou arraste arquivos de áudio para a janela.
- Para adicionar uma pasta, use **Importar uma pasta inteira**. Navegadores compatíveis também permitem arrastar a pasta para o app.
- Se a playlist estiver aberta, a importação também adicionará as faixas a ela.
- Use nomes como `Artista - Música.mp3` para separar artista e título. Sem esse padrão, o nome do arquivo vira o título. Esta versão não lê tags ID3 ou capas embutidas.
- Arquivos com o mesmo nome, tamanho e data de modificação são tratados como duplicados. Arquivos inválidos ou sem suporte no navegador não são adicionados.

O navegador precisa permitir armazenamento local. MP3, WAV, OGG, M4A, AAC, FLAC e outros formatos são aceitos para verificação, mas a reprodução depende dos codecs disponíveis no navegador e no sistema operacional.

## Recursos

- Reproduzir, pausar, avançar, voltar, buscar na faixa e ajustar ou silenciar o volume.
- Fila, ordem aleatória, repetição da fila ou de uma música.
- Criar, renomear e excluir playlists; adicionar e remover faixas sem duplicar os arquivos.
- Favoritas, busca por nome/artista e ordenação.
- Atalhos de teclado, controles acessíveis e integração com as teclas de mídia quando o navegador oferece suporte.
- Restauração da biblioteca, playlists, volume, fila e posição da última faixa. A reprodução nunca recomeça automaticamente ao abrir a página.

## Aparência

Clique na **engrenagem** ao lado de **Adicionar músicas** para abrir as configurações:

- **Tema:** claro, escuro ou seguindo o sistema. No modo Sistema, o app acompanha mudanças de aparência do dispositivo.
- **Cor de destaque:** escolha uma das cores prontas, use o seletor de cor ou informe um código hexadecimal. A mudança aparece na hora.
- **Restaurar padrão:** volta ao tema do sistema e à cor grafite, sem alterar músicas, playlists ou reprodução.

A aparência é salva automaticamente neste navegador. O texto dos controles mantém contraste mesmo com cores muito claras ou escuras.

## Armazenamento e privacidade

Os áudios são copiados para o **IndexedDB** do navegador. As preferências ficam no **localStorage**. Nada é enviado a um servidor; o servidor acima somente entrega os arquivos do app. Não são necessárias chaves, variáveis de ambiente ou conexão com serviços de música.

As músicas ficam disponíveis na mesma origem (protocolo, endereço e porta), no mesmo perfil de navegador. Não há sincronização entre dispositivos. O app não monitora automaticamente pastas do computador: é preciso importar os arquivos pela interface. Apagar os dados do site ou do navegador também apaga a coleção local. O espaço disponível depende da cota do navegador; **mantenha uma cópia dos arquivos originais**.

Esta é uma aplicação web. Não há aplicativo Android nem empacotamento nativo nesta etapa.

## Estrutura

```text
index.html     Interface, ícones locais e janelas de diálogo
styles.css     Estilos e adaptação de layout
appearance.js  Temas, cores e preferências de aparência
app.js         Reprodução, importação e interações
storage.js     Persistência e transações do IndexedDB
pwa.js         Instalação, acesso offline e atualização
sw.js          Cache dos arquivos do app
manifest.webmanifest  Identidade e configuração da instalação
icons/         Ícones do app
tests/pwa_smoke.py  Testes de instalação, cache, atualização e áudio offline
```

Nenhuma fonte, imagem, script ou dependência de terceiros é carregada pelo app.

### Validação de desenvolvimento

Com Python, Playwright para Python e Chromium disponíveis, execute:

```sh
python3 tests/pwa_smoke.py
```

O teste usa uma cópia temporária do projeto para validar `/Music/`, fechamento e reabertura offline com áudio real, dados salvos e atualização sem interromper a reprodução. Ele não altera os arquivos do app nem executa uma instalação no sistema operacional. `CHROMIUM_EXECUTABLE` permite indicar outro executável de Chromium. Essas ferramentas são apenas para desenvolvimento; não são necessárias para instalar ou usar o onda.
