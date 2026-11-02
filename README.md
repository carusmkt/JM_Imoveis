# JM Imóveis

Site do corretor e avaliador de imóveis Judson Martins.

Para testar localmente, execute `npm run dev` e abra
[o admin](http://localhost:4173/admin.html). O PIN continua o mesmo.
As fotos em `images/` não fazem parte do Git; no localhost, o admin carrega
os originais públicos do domínio configurado no CNAME.

O admin exibe os seis primeiros imóveis ativos e não padrão na bandeja
**Em destaque**, seguindo a mesma regra da página inicial. Selecione os
checkboxes para mover vários imóveis juntos, pela alça ou pelos controles
de posição. O grupo mantém sua ordem e a última organização pode ser desfeita.
As alterações entram no site ao usar **Sincronizar**, como antes.

O editor tem uma visualização de fotos inteiras, com navegação por setas e
fechamento por Escape. Nas miniaturas, marque várias fotos nos checkboxes da
barra superior e arraste pela alça para movê-las juntas com animação, mantendo
a ordem e os cômodos. Os controles de início/fim também funcionam pelo teclado.
A primeira foto é a capa; use **Salvar** no editor para manter a nova ordem.
O PIN tem um controle **Mostrar PIN / Ocultar PIN** para conferir os dígitos.
O acesso usa o valor atual do campo e aceita correções imediatas, sem esperar
a animação terminar. A digitação anterior ao carregamento do componente é
preservada; falhas ao lembrar a sessão não impedem uma entrada válida.
A nota de qualidade usa uma escala de 0 a 10:
fotos (3), descrição (2), preço (1,5), cidade e bairro (1,5), área (1) e
nome e tipo (1). Vídeo e características somam até 1 ponto de bônus para
compensar pequenas lacunas, sempre respeitando o teto de 10. Condomínio,
badges, vídeo e endereço exato não são obrigatórios para a nota máxima.

A página continua estática. O componente React `OneTimeCode` é compilado
separadamente e o bundle em `admin/dist/` deve ser incluído na publicação.
Para alterar esse componente: `npm ci` e `npm run build:admin`.
Para verificar as regras de organização e qualidade: `npm test`.

Fontes e licenças: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
