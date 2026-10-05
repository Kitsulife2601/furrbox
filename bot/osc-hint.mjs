// Lokales OSC an VRChat (UDP 127.0.0.1:9000) – Bot und Desktop laufen auf demselben PC.
import dgram from "node:dgram";

const VRCHAT_OSC_PORT = 9000;
const MAX_CHARS = 144;

function oscString(text) {
  const raw = Buffer.from(text, "utf8");
  const out = Buffer.alloc(Math.ceil((raw.length + 1) / 4) * 4);
  raw.copy(out);
  return out;
}

function cleanHint(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 9)
    .join("\n")
    .slice(0, MAX_CHARS);
}

export function hintLimit() {
  return MAX_CHARS;
}

export function sendChatbox(text) {
  const clean = cleanHint(text);
  if (!clean) return Promise.reject(new Error("Der Text ist leer."));
  const packet = Buffer.concat([oscString("/chatbox/input"), oscString(",sTF"), oscString(clean)]);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.send(packet, VRCHAT_OSC_PORT, "127.0.0.1", (error) => {
      socket.close();
      if (error) reject(error);
      else resolve(clean);
    });
  });
}
