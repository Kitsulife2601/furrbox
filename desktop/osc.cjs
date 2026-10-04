// OSC to VRChat (UDP 127.0.0.1:9000 – VRChat's standard OSC input). Only what FurrBox needs:
// writing text into the chatbox. OSC must be switched on in VRChat (Action Menu → Options → OSC).
const dgram = require("node:dgram");

const VRCHAT_OSC_PORT = 9000;

/** OSC string: UTF-8, zero-terminated, padded to a multiple of 4 bytes. */
function oscString(text) {
  const raw = Buffer.from(text, "utf8");
  const out = Buffer.alloc(Math.ceil((raw.length + 1) / 4) * 4);
  raw.copy(out);
  return out;
}

function send(packet) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.send(packet, VRCHAT_OSC_PORT, "127.0.0.1", (error) => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

/** /chatbox/input "text" true false – send immediately, without the notification sound. */
function chatboxPacket(text) {
  // Line breaks are allowed (VRChat shows them), everything else is squeezed to single spaces.
  const clean = String(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 9)
    .join("\n")
    .slice(0, 144);
  if (!clean) throw new Error("Der Text ist leer.");
  return Buffer.concat([oscString("/chatbox/input"), oscString(",sTF"), oscString(clean)]);
}

function sendChatbox(text) {
  return send(chatboxPacket(text));
}

module.exports = { sendChatbox, chatboxPacket };
