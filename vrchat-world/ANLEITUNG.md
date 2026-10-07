# FurrBox-Karte in eine VRChat-Welt einbauen

Damit zeigt der **Instanz-Tracker** in FurrBox eine Live-Karte der Welt von oben, mit
den Profilbildern der Leute an ihrer Position. Fährst du mit der Maus über ein Bild,
siehst du den Namen.

VRChat gibt die Positionen von Spielern sonst nirgends heraus. Deshalb muss die Welt sie
selbst melden. Das geht nur in Welten, an denen ihr etwas ändern dürft (eigene Welt oder
der Ersteller baut es ein).

## So geht's (Unity mit VRChat World SDK + UdonSharp)

1. `FurrBoxMap.cs` in den `Assets`-Ordner des Welt-Projekts ziehen.
2. In der Szene ein leeres GameObject anlegen (Rechtsklick → *Create Empty*) und
   `FurrBoxMap` nennen.
3. Im Inspector auf **Add Component** klicken und **FurrBoxMap** wählen.
4. Zwei weitere leere GameObjects anlegen: `Karte Ecke A` und `Karte Ecke B`. Setz sie
   auf zwei gegenüberliegende Ecken der Welt (von oben gesehen, z. B. unten links und
   oben rechts). Alles dazwischen wird auf der Karte gezeigt.
5. Die beiden Ecken in die Felder **Corner A** und **Corner B** von FurrBoxMap ziehen.
6. Optional: ein Bild der Welt von oben machen (Kamera nach unten richten, genau auf die
   beiden Ecken zuschneiden), hochladen und den direkten Bild-Link (`https://…`) bei
   **Map Image Url** eintragen. Ohne Bild zeigt FurrBox ein Raster.
   Aus Sicherheitsgründen lädt FurrBox das Bild nur von diesen Seiten:
   imgur (`i.imgur.com`), GitHub (`raw.githubusercontent.com`, `*.github.io`),
   catbox (`files.catbox.moe`), ImgBB (`i.ibb.co`) und PostImages (`i.postimg.cc`).
7. Welt wie gewohnt hochladen.

## Was passiert dabei?

- Alle 2 Sekunden schreibt die Welt auf dem PC jedes Spielers eine Zeile ins
  VRChat-Protokoll: Spieler-Nummer, Position (nur von oben, ohne Höhe) und Blickrichtung.
- Die FurrBox-Desktop-App liest das Protokoll auf deinem PC und zeichnet die Karte.
- Es wird nichts an einen Server geschickt.
