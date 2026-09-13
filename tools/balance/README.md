# Banc d'équilibrage

Fait jouer un bot (taux p de bons choix aux portes, évite les blocs) niveau par niveau, sans rendu (`?bot=N`).

```bash
cd tools/balance && npm i
python -m http.server 5230   # à la racine du jeu, dans un autre terminal
node balance.js "1,5,10,20,30,50" 3   # niveaux, essais par point
node debug1.js 10 1                    # trace une partie : niveau 10, p = 1
```
