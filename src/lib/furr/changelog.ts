// "Neuigkeiten" shown under FurrSettings → System → Updates.
// Newest first. Add an entry whenever something users notice changes (server or desktop).

export type ChangelogEntry = {
  date: string; // YYYY-MM-DD
  version?: string; // desktop version, if the change came with a desktop release
  title: string;
  items: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-30",
    title: "Whitelist fürs Team & Neuigkeiten",
    items: [
      "Supporter und Moderatoren können jetzt in der FurrWhitelist Leute freischalten und entfernen.",
      "Die Whitelist komplett ein- oder ausschalten dürfen weiterhin nur Owner und Dev.",
      "Neu: Diese Neuigkeiten-Liste unter FurrSettings → System → Updates.",
    ],
  },
  {
    date: "2026-09-30",
    title: "Nur für den Fish-Server",
    items: [
      "Beim Login wird geprüft, ob du auf dem Fish-Discord-Server bist – nur Server-Mitglieder kommen rein.",
      "Wer noch nicht auf dem Server ist, kann nach dem Beitritt einfach auf „Erneut prüfen“ klicken.",
      "Neu: FurrWhitelist – Mitglieder ohne Staff-Rolle brauchen eine Freischaltung.",
    ],
  },
  {
    date: "2026-09-29",
    version: "2.0.6",
    title: "Zentraler Server & neuer Discord-Bot",
    items: [
      "Die Desktop-App verbindet sich automatisch mit dem zentralen FurrBox-Server – alle teilen dieselben Dateien, Chats und Presence.",
      "Neuer Discord-Bot: Moderation, Mitglieder- und Status-Sync laufen über die FurrBox-Brücke.",
    ],
  },
  {
    date: "2026-09-28",
    version: "2.0.3",
    title: "Installer, Boot-Animation & Auto-Update",
    items: [
      "FurrBox-Installer im eigenen Design, Discord-Login ohne Einrichtung.",
      "Boot-Animation beim Hochfahren.",
      "Automatische Updates über GitHub mit Neustart-Hinweis.",
      "Desktop-Symbole lassen sich mit der Maus verschieben, Hintergrund anpassbar.",
    ],
  },
  {
    date: "2026-09-28",
    version: "2.0.0",
    title: "FurrBox 2.0",
    items: [
      "FurrBox wurde komplett neu aufgebaut: FurrFS, FurrChat, FurrPresence, FurrEvidence, Terminal und Browser.",
      "Login mit Discord, Staff-Rollen vom Fish-Server schalten die Team-Tools frei.",
    ],
  },
];
