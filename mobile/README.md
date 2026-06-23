# FurrBox Mobile Companion

Handy-optimierte Web-App fuer FurrBox. Sie laeuft getrennt vom Electron-Desktop unter `mobile/`, nutzt aber denselben Backend-Server.

## Start

```powershell
npm install
npm run mobile:dev
```

Dann auf dem Handy im gleichen Netzwerk oeffnen:

```text
http://DEINE-PC-IP:3001
```

## iPhone / iPad

Auf Apple-Geraeten wird FurrBox Mobile als PWA vorbereitet:

1. Safari oeffnen.
2. Mobile-URL aufrufen.
3. Teilen-Symbol antippen.
4. `Zum Home-Bildschirm` auswaehlen.

Fuer volle PWA-Funktionen wie Service Worker, Offline-Shell und stabile Installation braucht iOS eine HTTPS-Adresse. Lokal im WLAN funktioniert die Web-App im Safari-Browser, fuer Home-Screen/Offline sollte sie spaeter ueber eine HTTPS-Domain oder einen Reverse Proxy mit Zertifikat laufen.

Fuer Produktion:

```powershell
npm run mobile:build
npm run mobile:start
```
