[English](README.md) · **Português (Brasil)**

# Book Palace

Um app simples, feito pra usar no celular, que controla um estoque de livros estante por estante, fileira por fileira e na posição exata de cada livro. Foi feito pra um estoque de livros de família: o objetivo é achar qualquer livro em segundos e saber onde guardar cada livro novo.

Ele roda direto no navegador, sem nada pra instalar, e pode ser hospedado de graça no **GitHub Pages**. Os dados ficam num banco **Firebase** (plano gratuito), com login pela conta Google.

> As telas do app são em português, onde ele se chama *Palácio dos Livros*. O código e os comentários são em inglês.

## O que ele faz

- **Estantes como "stories"**: cada estante aparece no topo com o número de livros dela.
- **Fileiras lado a lado**: cada fileira vira uma coluna, e os livros aparecem de cima pra baixo na mesma ordem em que estão da esquerda pra direita na estante.
- **Arrastar e soltar**: segure um livro e arraste pra outra posição ou outra fileira. Pela barra que aparece embaixo, dá pra mandar pra outra estante. Funciona com o dedo e com o mouse.
- **Livros sem fileira** ficam numa lista à parte. Dá pra arrastar pra mudar a ordem, ou ordenar por autor, título ou categoria.
- **Arrumar sem digitar**: depois de arrumar uma fileira de verdade, toque no último livro dela e todos os anteriores dessa lista vão pra essa fileira, na mesma ordem. Também dá pra tocar um por um.
- **Ordem A–Z sugerida**: pelo nome do autor como aparece na capa (Dan Brown fica no D). Livros do mesmo autor ficam juntos e as séries seguem a ordem dos volumes.
- **Livro novo**: o app sugere a estante (onde estão os outros livros do mesmo autor) e a posição certa na ordem A–Z. Se o livro já existir, ele avisa e oferece somar mais um exemplar.
- **Busca** por título, autor, série ou observação, mostrando onde o livro está, como "Amarela · fileira 2 · 7º".
- **Backup**: baixa o estoque como planilha (CSV) ou como arquivo de backup (JSON), e importa esse backup de volta.
- **Atualização ao vivo**: o que uma pessoa muda aparece na hora no celular da outra.

## Experimente sem configurar nada

Com `FIREBASE_CONFIG = null` em `js/config.js`, que é como o projeto vem, o app abre no **modo demonstração**: sem login, com alguns livros de exemplo, e tudo fica guardado só no seu navegador.

Pra rodar no computador, abra um terminal na pasta do projeto e rode:

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. Abrir o `index.html` direto, com dois cliques, não funciona, porque o app usa módulos JavaScript.

## Como colocar no ar com o seu estoque

### 1. Crie o projeto no Firebase

1. Entre em [console.firebase.google.com](https://console.firebase.google.com) com a sua conta Google e clique em **Criar um projeto**. O Google Analytics pode ficar desligado.
2. Na tela do projeto, clique no ícone **Web** (`</>`) pra registrar um app. Dê um nome qualquer e não marque o Firebase Hosting.
3. O Firebase mostra um objeto `firebaseConfig`. Copie e cole em `js/config.js`, no lugar de `null`:

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…"
   };
   ```

   Esses dados **não são senha** e podem ficar num repositório público. Quem protege o estoque são as regras do passo 3.

### 2. Ligue o login com Google

1. No menu do Firebase, vá em **Authentication** e clique em **Vamos começar**.
2. Em **Método de login**, ative o **Google** e salve.
3. Em **Configurações > Domínios autorizados**, adicione o endereço do seu GitHub Pages, por exemplo `seu-usuario.github.io`.

### 3. Crie o banco e libere os e-mails

1. No menu, vá em **Firestore Database** e clique em **Criar banco de dados**. Escolha o local `southamerica-east1 (São Paulo)` e o **modo de produção**.
2. Abra a aba **Regras**, apague o que estiver lá e cole o conteúdo do arquivo [`firestore.rules`](firestore.rules).
3. Troque os e-mails de exemplo pelos e-mails das contas Google de quem vai usar o estoque e clique em **Publicar**.

Pra dar acesso a mais alguém depois, é só incluir o e-mail na lista e publicar de novo.

### 4. Publique no GitHub Pages

1. Suba os arquivos pro seu repositório no GitHub, já com o `js/config.js` preenchido.
2. No repositório, vá em **Settings > Pages**. Em **Source**, escolha **Deploy from a branch**, depois a branch `main` e a pasta `/ (root)`, e salve.
3. Em um ou dois minutos o app fica disponível em `https://seu-usuario.github.io/nome-do-repositorio/`.

### 5. Coloque os livros

Entre com a sua conta Google e escolha uma das opções:

- **Importar um backup**: use o botão **Importar backup**, no fim da página. Ele aceita o arquivo `.json` que o próprio app gera em **Baixar backup**.
- **Começar do zero**: crie as estantes no botão **+** dos stories e cadastre os livros em **+ Livro**.

### 6. No celular

Abra o endereço no navegador e use **Adicionar à tela inicial**. O app ganha um ícone e abre como se fosse um aplicativo.

## Como os dados ficam guardados

Uma coleção `shelves` no Firestore, com um documento por estante. Os nomes dos campos são em inglês:

```json
{
  "name": "Amarela",
  "order": 5,
  "rows": 6,
  "books": [
    { "id": "b12", "title": "O Código Da Vinci", "author": "Dan Brown", "category": "SUS", "copies": 11, "row": 2 },
    { "id": "b40", "title": "Lua Nova", "author": "Stephenie Meyer", "category": "FAN", "copies": 2, "row": 0, "series": "Crepúsculo", "volume": 2 }
  ]
}
```

| Campo | O que é |
|---|---|
| `name`, `order`, `rows` | nome da estante, posição dela na lista e número de fileiras |
| `title`, `author` | título e autor |
| `category` | categoria (os códigos estão em `js/config.js`) |
| `copies` | quantidade de exemplares |
| `row` | fileira, contando de cima (`0` = sem fileira) |
| `note` | observação, como "lacrado" ou "edição de bolso" |
| `series`, `volume` | série e volume |

A posição de cada livro dentro da fileira é a ordem dele na lista. Toda mudança é gravada numa transação, então duas pessoas mexendo ao mesmo tempo não apagam o trabalho uma da outra.

O plano gratuito do Firebase (Spark) aguenta com folga um estoque de milhares de livros usado por uma família.

## Personalizar

- **Categorias e cores**: em `js/config.js`.
- **Visual**: as cores ficam no topo de `css/style.css`.
- **Ordem A–Z**: a regra está em `js/sort.js`.

## Estrutura

```
index.html            página
css/style.css         visual
js/config.js          configuração do Firebase e categorias
js/app.js             telas, edição, arrastar e soltar
js/store.js           Firebase e modo demonstração
js/sort.js            ordem A–Z por autor
data/sample.json      livros do modo demonstração
firestore.rules       quem pode ver e editar
```

## Licença

O Book Palace é software livre, sob a [GNU Affero General Public License v3.0 ou posterior](LICENSE), com termos adicionais de crédito descritos no [NOTICE](NOTICE).

Resumindo: você pode usar, estudar, modificar, compartilhar e até vender, desde que:

- mantenha o crédito ao Book Palace e a ncsf01, com link pra este repositório, visível no app (por exemplo, "Baseado no Book Palace, de ncsf01" no rodapé);
- compartilhe o código-fonte da sua versão sob a mesma licença, inclusive quando as pessoas só usam pela internet;
- não apresente uma versão modificada como se fosse a original nem dê a ela o nome "Book Palace".

O que vale são os arquivos [LICENSE](LICENSE) e [NOTICE](NOTICE); este resumo é só um guia.
