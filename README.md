# Ecowitt WS90 Card

Carte Lovelace personnalisée pour Home Assistant, pensée pour afficher les
données d'une station météo — conçue à l'origine pour une station **Ecowitt
WS90**, mais elle fonctionne avec n'importe quelle entité capteur exposant
température, humidité, vent, pluie, luminosité, UV ou pression, quelle que
soit leur source (intégration Ecowitt, Météo-France, capteurs personnalisés,
capteurs modèles...).

Deux vues, accessibles via un bouton en haut de la carte :

- **Instantané** : graphe combiné température/humidité, ligne vent avec
  boussole, puis luminosité/UV, pluie et pression — avec mini-graphiques de
  tendance en option, et un panneau de records de la station.
- **Historique** : un graphique par métrique (température, humidité, vent,
  pluie, luminosité/UV, pression), avec période sélectionnable (24 h / 7 j /
  30 j / 1 an ou dates personnalisées), badges min/max, infobulle au survol,
  et une rose des vents.

La carte est autonome : aucune dépendance externe (pas d'ApexCharts, pas de
Chart.js) — tous les graphiques sont dessinés en Canvas 2D natif.

## Aperçu des fonctionnalités

| Fonctionnalité | Détail |
|---|---|
| Vue Instantané | Valeurs en direct pour chaque métrique configurée |
| Mini-graphiques | Tendance récente sous temp./humidité/vent/rafales/UV/luminosité/pression, durée réglable (1h à 7j), activables/désactivables |
| Boussole | Représentation visuelle de la direction du vent |
| Records de la station | Min/max historiques (température, humidité, rafale, pluie, UV) — calculés automatiquement, sans automation à créer |
| Vue Historique | Un graphique par métrique, avec badges min/max réels |
| Période personnalisée | Sélecteur de deux dates en plus des périodes prédéfinies |
| Rose des vents | Répartition direction/force du vent sur la période choisie |
| Infobulle | Valeur et date au survol d'un graphique historique |
| Couleur liée au thème | S'adapte automatiquement au thème Home Assistant actif |

## Prérequis

- Home Assistant récent (avec le composant `recorder` activé, actif par
  défaut).
- Les fonctionnalités de la vue Historique, les mini-graphiques et les
  records nécessitent que vos capteurs aient des **statistiques long terme**
  activées côté Home Assistant (voir la section [Dépannage](#dépannage) si
  un graphique reste vide).
- HACS, si vous installez via un dépôt personnalisé (recommandé). Une
  installation manuelle est aussi possible.

## Installation

### Via HACS (dépôt personnalisé)

Cette carte n'étant pas dans le magasin par défaut de HACS, il faut
l'ajouter comme dépôt personnalisé :

1. Dans Home Assistant : **HACS > menu ⋮ (en haut à droite) > Dépôts
   personnalisés**.
2. Collez l'URL du dépôt GitHub de la carte, catégorie **Plugin**, puis
   validez.
3. La carte apparaît dans **HACS > Frontend** : cliquez dessus puis
   **Télécharger**.
4. HACS ajoute normalement la ressource Lovelace automatiquement. Si ce
   n'est pas le cas, ajoutez-la manuellement (voir étape 2 ci-dessous).
5. Rechargez la page (Ctrl+F5) avant d'ajouter la carte à un tableau de
   bord.

### Installation manuelle

1. Copiez `ecowitt-ws90-card.js` dans `<config>/www/` (par exemple
   `<config>/www/ecowitt-ws90-card.js`).
2. Dans **Paramètres > Tableaux de bord > Ressources**, ajoutez une
   ressource :
   - URL : `/local/ecowitt-ws90-card.js`
   - Type : **Module JavaScript**
3. Rechargez la page (Ctrl+F5).

> Si vous mettez à jour le fichier manuellement par la suite, un simple
> Ctrl+F5 ne suffit pas toujours à faire recharger le module par le
> navigateur. Ajoutez un paramètre à l'URL de la ressource (ex.
> `/local/ecowitt-ws90-card.js?v=2`) pour forcer le rechargement.

## Ajouter la carte à un tableau de bord

1. Ouvrez un tableau de bord en mode édition, **Ajouter une carte**, puis
   cherchez **"Ecowitt WS90 Card"**.
2. Un éditeur visuel permet de sélectionner vos entités (champ par champ)
   et les options d'affichage, sans écrire de YAML.
3. Vous pouvez aussi passer en mode YAML — exemple complet ci-dessous.

```yaml
type: custom:ecowitt-ws90-card
title: Station météo
default_mode: instant        # ou "historical"
default_period: 24h          # 24h | 7d | 30d | 1y
show_records: true
show_mini_graphs: true
mini_graph_period: 24h        # 1h | 6h | 12h | 24h | 48h | 7d
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
  pressure: sensor.pressure
```

Tous les champs sous `entities` sont **facultatifs** : n'indiquez que ceux
que vous possédez, les sections correspondantes (valeur, mini-graphique,
graphique historique, record) apparaissent ou disparaissent automatiquement.

### Référence des options

| Option | Valeurs | Défaut | Description |
|---|---|---|---|
| `title` | texte libre | `"Station météo"` | Titre affiché en haut de la carte |
| `default_mode` | `instant` \| `historical` | `instant` | Vue affichée à l'ouverture |
| `default_period` | `24h` \| `7d` \| `30d` \| `1y` | `24h` | Période par défaut de la vue Historique |
| `show_records` | `true` \| `false` | `true` | Afficher le panneau des records |
| `show_mini_graphs` | `true` \| `false` | `true` | Afficher les mini-graphiques en vue Instantané |
| `mini_graph_period` | `1h` \| `6h` \| `12h` \| `24h` \| `48h` \| `7d` | `24h` | Durée affichée par les mini-graphiques |
| `entities.*` | `entity_id` | — | Voir tableau ci-dessous |

### Référence des entités

| Clé | Donnée attendue | Unité |
|---|---|---|
| `temperature` | Température extérieure | °C |
| `humidity` | Humidité relative | % |
| `wind_speed` | Vitesse du vent | km/h |
| `wind_gust` | Rafales | km/h |
| `wind_direction` | Direction du vent (0-360°) | ° |
| `rain_rate` | Intensité de pluie instantanée | mm/h |
| `rain_daily` | Cumul de pluie du jour | mm |
| `solar_radiation` | Luminosité / rayonnement solaire | W/m² |
| `uv_index` | Index UV | — |
| `pressure` | Pression atmosphérique | hPa |

Pour retrouver l'`entity_id` exact de vos capteurs : **Outils de
développement > États**, et filtrez par le nom de votre appareil ou
intégration météo.

Si une donnée dont vous avez besoin n'est disponible que comme **attribut**
d'une autre entité (fréquent avec les intégrations météo type Météo-France,
qui exposent tout sur une seule entité `weather.xxx`), créez un capteur
modèle pour l'extraire :

```yaml
template:
  - sensor:
      - name: "Direction du vent"
        unique_id: wind_direction_maison
        unit_of_measurement: "°"
        state_class: measurement
        state: "{{ state_attr('weather.ma_station', 'wind_bearing') }}"
```

`state_class: measurement` est important : sans lui, Home Assistant ne
calcule aucune statistique pour ce capteur, ce qui empêche la vue
Historique, les mini-graphiques et les records de fonctionner pour cette
donnée (voir [Dépannage](#dépannage)).

## Personnalisation de la couleur

Toute la carte utilise une seule couleur, reprise automatiquement du thème
Home Assistant actif (`--primary-color`). Pour la personnaliser sans
dépendre du thème, utilisez `card-mod` :

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

## Dépannage

**Un graphique ou un mini-graphique reste vide alors que l'entité affiche
une valeur.**
La vue Historique, les mini-graphiques et les records reposent sur les
statistiques long terme de Home Assistant, pas sur la simple valeur actuelle
de l'entité. Deux causes possibles :
- Le capteur vient d'être ajouté : les statistiques s'accumulent à partir de
  maintenant, il faut laisser passer un peu de temps (quelques minutes pour
  voir les premiers points, en fonction de la période choisie).
- Le capteur n'a pas d'attribut `state_class: measurement` (fréquent pour
  les capteurs modèles créés sans cette ligne, voir exemple ci-dessus) :
  vérifiez dans **Outils de développement > États**, attributs de
  l'entité. Sans cette ligne, aucune statistique ne sera jamais calculée,
  quel que soit le temps écoulé. Vous pouvez aussi vérifier la présence de
  l'entité dans **Outils de développement > Statistiques**.

**Les records n'affichent qu'une date, sans heure.**
Normal : ils sont calculés à partir de statistiques agrégées par jour, qui
ne conservent pas l'heure précise à laquelle le pic a eu lieu.

**La rose des vents semble légèrement décalée près du Nord (0°/360°).**
Home Assistant stocke une moyenne arithmétique classique par intervalle
(pas une moyenne circulaire), ce qui peut légèrement fausser une direction
moyenne calculée sur un intervalle qui chevauche le Nord. L'effet est
marginal sur les périodes courtes (24h/7j) et un peu plus visible sur "1 an"
(moyennes journalières agrégées).

**La rose des vents ne s'affiche pas du tout.**
Elle nécessite que `wind_direction` **et** `wind_speed` soient tous les deux
configurés.

**La période "1 an" met du temps à charger.**
Normal sur les installations avec beaucoup d'historique ; le chargement se
fait une seule fois par sélection de période.
