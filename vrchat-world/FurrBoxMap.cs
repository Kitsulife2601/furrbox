// FurrBox-Karte für VRChat-Welten (UdonSharp).
// Schreibt alle paar Sekunden die Position aller Spieler ins VRChat-Protokoll des eigenen PCs.
// Die FurrBox-Desktop-App liest das Protokoll und zeigt im Instanz-Tracker eine Live-Karte.
// Es wird nichts ins Internet geschickt – jeder Spieler schreibt nur in sein eigenes Protokoll.
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;

[UdonBehaviourSyncMode(BehaviourSyncMode.None)]
public class FurrBoxMap : UdonSharpBehaviour
{
    [Tooltip("Eine Ecke des Kartenbereichs (z. B. ein leeres GameObject unten links in der Welt).")]
    public Transform cornerA;

    [Tooltip("Die gegenüberliegende Ecke des Kartenbereichs (oben rechts).")]
    public Transform cornerB;

    [Tooltip("Optional: Link (https://…) zu einem Bild der Welt von oben, genau auf die beiden Ecken zugeschnitten.")]
    public string mapImageUrl = "";

    [Tooltip("Wie oft die Positionen geschrieben werden (Sekunden).")]
    public float interval = 2f;

    private VRCPlayerApi[] players = new VRCPlayerApi[90];
    private float nextTick;
    private float nextInfo;

    private void Start()
    {
        LogInfo();
    }

    private void LogInfo()
    {
        if (cornerA != null && cornerB != null)
        {
            Vector3 a = cornerA.position;
            Vector3 b = cornerB.position;
            Debug.Log("[FurrBoxMap] b|" + D(Mathf.Min(a.x, b.x)) + "|" + D(Mathf.Min(a.z, b.z)) + "|" + D(Mathf.Max(a.x, b.x)) + "|" + D(Mathf.Max(a.z, b.z)));
        }
        if (mapImageUrl != null && mapImageUrl.StartsWith("https://"))
        {
            Debug.Log("[FurrBoxMap] i|" + mapImageUrl);
        }
    }

    public override void OnPlayerJoined(VRCPlayerApi player)
    {
        if (!Utilities.IsValid(player)) return;
        Debug.Log("[FurrBoxMap] n|" + player.playerId + "|" + player.displayName);
    }

    private void Update()
    {
        if (Time.time < nextTick) return;
        nextTick = Time.time + Mathf.Max(0.5f, interval);

        // Karteninfos ab und zu wiederholen (falls FurrBox erst später gestartet wurde).
        if (Time.time > nextInfo)
        {
            nextInfo = Time.time + 60f;
            LogInfo();
        }

        int count = VRCPlayerApi.GetPlayerCount();
        if (players.Length < count) players = new VRCPlayerApi[count + 10];
        VRCPlayerApi.GetPlayers(players);

        string line = "[FurrBoxMap] t";
        for (int i = 0; i < count; i++)
        {
            VRCPlayerApi p = players[i];
            if (!Utilities.IsValid(p)) continue;
            Vector3 pos = p.GetPosition();
            int rot = Mathf.RoundToInt(p.GetRotation().eulerAngles.y);
            line += "|" + p.playerId + ":" + D(pos.x) + ":" + D(pos.z) + ":" + rot;
        }
        Debug.Log(line);
    }

    // Meter -> Dezimeter als ganze Zahl (unabhängig von der Spracheinstellung des PCs).
    private string D(float meters)
    {
        return Mathf.RoundToInt(meters * 10f).ToString();
    }
}
