# FurrBox Mobile Native App

Diese Mobile-App ist als Capacitor-App vorbereitet. Damit kann dieselbe Next.js-Oberflaeche als Android-App in Android Studio und spaeter als iOS-App in Xcode gebaut werden.

## Android Studio

```powershell
npm install
npm --workspace mobile run android:sync
npm --workspace mobile run android:open
```

Danach oeffnet sich Android Studio mit `mobile/android`. Dort kannst du ein Handy/Emulator waehlen und `Run` druecken.

Direkt per Konsole:

```powershell
npm --workspace mobile run android:run
```

## Apple / iOS

Die iOS-Struktur ist vorbereitet, aber iOS kann nicht auf Windows gebaut werden. Dafuer brauchst du macOS mit Xcode:

```bash
npm install
npm --workspace mobile run ios:sync
npm --workspace mobile run ios:open
```

Dann in Xcode Signierung/Team einstellen und auf iPhone oder Simulator starten.

## Wichtig

Die App verbindet sich mit dem FurrBox Backend:

```text
http://5.249.162.130:4000
```

Wenn Android im Emulator lokal testen soll, kann der Server trotzdem remote bleiben. Fuer iOS App Store / TestFlight sollte spaeter HTTPS fuer Backend und Mobile-Distribution gesetzt werden.
