# onda.

Um player de música pessoal para desktop, feito com HTML, CSS e JavaScript puro. Sem contas, anúncios, serviços externos ou etapa de build.

## Executar

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

## Armazenamento e privacidade

Os áudios são copiados para o **IndexedDB** do navegador. As preferências ficam no **localStorage**. Nada é enviado a um servidor; o servidor acima somente entrega os arquivos do app. Não são necessárias chaves, variáveis de ambiente ou conexão com serviços de música.

As músicas ficam disponíveis na mesma origem (protocolo, endereço e porta), no mesmo perfil de navegador. Não há sincronização entre dispositivos. O app não monitora automaticamente pastas do computador: é preciso importar os arquivos pela interface. Apagar os dados do site ou do navegador também apaga a coleção local. O espaço disponível depende da cota do navegador; **mantenha uma cópia dos arquivos originais**.

Esta é uma aplicação web. Não há aplicativo Android nem empacotamento nativo nesta etapa.

## Estrutura

```text
index.html   Interface, ícones locais e janelas de diálogo
styles.css   Estilos e adaptação de layout
app.js       Reprodução, importação e interações
storage.js   Persistência e transações do IndexedDB
```

Nenhuma fonte, imagem, script ou dependência é carregada da internet.
