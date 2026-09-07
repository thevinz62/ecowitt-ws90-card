# Ecowitt WS90 Card

Carte Lovelace personnalisée pour Home Assistant, dédiée à une station météo
**Ecowitt WS90** (intégration Ecowitt locale).

- Mode **Instantané** : valeurs en direct (température, humidité, vent,
  rafales, direction, pluie, luminosité, UV) + records de la station.
- Mode **Historique** : graphiques (température, humidité, vent, pluie,
  luminosité/UV) avec période sélectionnable : 24 h / 7 j / 30 j / 1 an, et
  affichage des valeurs min/max sur chaque graphique.
- Les **records** de la station (temp. min/max, humidité min/max, rafale
  max, intensité de pluie max, UV max) sont calculés à partir des
  statistiques long terme de Home Assistant (`recorder`), conservées
  indéfiniment par défaut — aucune automation ni helper n'est nécessaire.
- **Aucune dépendance externe** : les graphiques sont dessinés en Canvas 2D
  natif (pas d'ApexCharts, pas de Chart.js à charger).

## Installation

### Pour tester rapidement (sans HACS)

1. Copiez `ecowitt-ws90-card.js` dans `<config>/www/` (par exemple
   `<config>/www/ecowitt-ws90-card.js`).
2. Dans **Paramètres > Tableaux de bord > Ressources**, ajoutez une
   ressource :
   - URL : `/local/ecowitt-ws90-card.js`
   - Type : Module JavaScript
3. Rechargez la page (Ctrl+F5).

### Via HACS (dépôt personnalisé)

1. Poussez ce dossier dans un dépôt GitHub public.
2. Dans HACS > Frontend > menu ⋮ > **Dépôts personnalisés**, ajoutez
   l'URL du dépôt avec la catégorie **Plugin**.
3. Installez "Ecowitt WS90 Card" depuis HACS, puis ajoutez la ressource
   comme ci-dessus (HACS le propose généralement automatiquement).

## Configuration

La carte dispose d'un éditeur visuel (sélection des entités via l'UI), mais
peut aussi être configurée en YAML :

```yaml
type: custom:ecowitt-ws90-card
title: Station météo WS90
default_mode: instant      # ou "historical"
default_period: 24h        # 24h | 7d | 30d | 1y
show_records: true
entities:
  temperature: sensor.outdoor_temperature
  humidity: sensor.outdoor_humidity
  wind_speed: sensor.wind_speed
  wind_gust: sensor.wind_gust
  wind_direction: sensor.wind_direction
  rain_rate: sensor.rain_rate
  rain_daily: sensor.daily_rain
  solar_radiation: sensor.solar_radiation
  uv_index: sensor.uv_index
```

Tous les champs d'`entities` sont optionnels : n'incluez que ceux que vous
possédez, les sections correspondantes s'adaptent automatiquement.

> Remplacez les `sensor.xxx` par vos vrais `entity_id` (Outils de
> développement > États, filtrez sur le nom de votre passerelle Ecowitt).

## Mini-graphiques (vue instantanée)

Sous les valeurs de température, humidité, vitesse du vent et rafales, un
petit graphique de tendance (sparkline) peut s'afficher, dans le style
d'une carte météo classique (courbe + dégradé léger, sans axes).

- Activable/désactivable via la case "Afficher des mini-graphiques" dans
  l'éditeur (ou `show_mini_graphs: true/false` en YAML).
- Durée réglable indépendamment de la période de la vue Historique :
  1h / 6h / 12h / 24h / 48h / 7j (`mini_graph_period` en YAML).
- Se rafraîchissent automatiquement toutes les 5 minutes tant que la carte
  est affichée en mode Instantané.

## Couleur liée au thème

Tous les graphiques, mini-graphiques, la rose des vents et les icônes des
records utilisent une **seule et même couleur** : celle de votre thème
Home Assistant actif (`--primary-color`). Changez de thème
(clair/sombre/personnalisé) et la carte s'adapte automatiquement — aucune
distinction de couleur entre les différentes métriques.

À l'intérieur d'un même graphique à deux séries (vitesse/rafales,
luminosité/UV), la deuxième série est tracée avec la même couleur en
opacité réduite pour rester lisible. La rose des vents utilise elle aussi
une seule couleur, à quatre niveaux d'opacité croissants selon la classe
de vitesse.

La couleur reste surchargeable via `card-mod` si besoin :

```yaml
type: custom:mod-card
card:
  type: custom:ecowitt-ws90-card
  entities: { ... }
style: |
  :host {
    --ecowitt-color: #FF0000;
  }
```

## Période personnalisée (vue Historique)

En plus des périodes prédéfinies (24h/7j/30j/1an), un bouton
**Personnalisé** affiche un sélecteur de deux dates (début/fin) avec un
bouton "Appliquer". La granularité des données (5 min / heure / jour) est
choisie automatiquement selon la durée de la plage sélectionnée.

## Bordure et infobulle

Chaque graphique de la vue Historique est désormais encadré d'une fine
bordure (`--divider-color` du thème — la couleur de séparation standard de
Home Assistant ; une bordure de la couleur exacte du fond aurait été
invisible puisque les graphiques n'ont pas de fond distinct de la carte).

Un survol de la souris sur un graphique affiche une infobulle avec la date
et la ou les valeurs au point le plus proche du curseur.

## Notes techniques

- Les graphiques utilisent l'API `recorder/statistics_during_period` de
  Home Assistant, qui nécessite que vos capteurs aient un `state_class`
  (`measurement` ou `total`), ce qui est le cas par défaut pour la plupart
  des capteurs de l'intégration Ecowitt.
- Sur des installations avec beaucoup d'historique, la période "1 an"
  peut prendre quelques secondes à charger la première fois.
- La rose des vents historique croise `wind_direction` et `wind_speed` sur
  la période choisie (16 secteurs, 4 classes de vitesse). Elle nécessite
  que ces deux entités soient configurées. Comme Home Assistant stocke une
  moyenne arithmétique classique par intervalle (et non une moyenne
  circulaire), une direction moyenne calculée sur un intervalle qui
  chevauche le Nord (proche de 0°/360°) peut être légèrement faussée ;
  l'effet reste marginal sur les périodes courtes (24h/7j) et un peu plus
  visible sur "1 an" (moyennes journalières).
- Les records de la station n'affichent qu'une **date**, sans heure : ils
  sont calculés à partir de statistiques agrégées par jour
  (`period: "day"`), qui ne conservent pas l'heure précise à laquelle le
  pic a eu lieu dans la journée.
