## Robô da Bet v0.2.6

### Fix: banner zumbi REAL — bug de CSS

Era um bug de CSS, não de cache.

O banner tem atributo HTML `hidden` (faz `display: none`), mas a classe
`.update-banner` define `display: flex` — que sobrescreve o `hidden`.
Resultado: o banner ficava **sempre visível**, independente do JS.

Mesmo a v0.2.5 limpando cache zumbi corretamente, o banner aparecia
em branco ("nova") porque o JS nunca chamava `banner.hidden = false`
— o CSS já o mostrava de cara.

Fix de uma linha:
```css
.update-banner[hidden] { display: none !important; }
```
