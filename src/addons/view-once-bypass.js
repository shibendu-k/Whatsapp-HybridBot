const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const logger = require('../utils/logger');

const BAIT_TEXTS = ['???', 'Ki eta?', 'Ye kya bheja?', 'Open nahi ho raha'];
const BAIT_MIN_DELAY_MS = 2000;
const BAIT_MAX_DELAY_MS = 5000;
const TEMP_DIR = process.env.TEMP_STORAGE_PATH || './temp_storage';
let tempDirReady = false;

function ensureTempDir() {
  if (tempDirReady) return;
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    tempDirReady = true;
  } catch (error) {
    logger.debug(`View-once bypass temp dir setup failed: ${error.message}`);
  }
}

function extractViewOnce(quotedMsg) {
  let message = quotedMsg;
  if (message?.ephemeralMessage?.message) message = message.ephemeralMessage.message;
  if (message?.viewOnceMessage?.message) message = message.viewOnceMessage.message;
  if (message?.viewOnceMessageV2?.message) message = message.viewOnceMessageV2.message;
  if (message?.viewOnceMessageV2Extension?.message) message = message.viewOnceMessageV2Extension.message;
  return message;
}

async function generateCaption(sock, m) {
  const isGroup = m.key.remoteJid?.endsWith('@g.us');
  let chatInfo = 'Personal Chat';

  if (isGroup) {
    try {
      const groupMeta = await sock.groupMetadata(m.key.remoteJid);
      chatInfo = `Group Chat (${groupMeta.subject})`;
    } catch (error) {
      chatInfo = 'Group Chat (Unknown Name)';
    }
  }

  const senderJid = m.key.participant || m.key.remoteJid;
  const senderNum = senderJid ? senderJid.split('@')[0] : '';
  const maskedNum = senderNum ? `xxxxxx${senderNum.slice(-4)}` : 'xxxxxx';
  const senderName = m.pushName || 'Unknown Sender';
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  return `👁️ *View Once Recovered*\n\n🕒 *Time:* ${timestamp}\n💬 *Chat:* ${chatInfo}\n👤 *Name:* ${senderName}\n📞 *Number:* ${maskedNum}`;
}

async function handleViewOnceBypass(sock, m) {
  if (!m?.message || !sock?.user?.id) return;

  const myJid = sock.user.id;

  if (!m.key.fromMe) {
    const isViewOnce = m.message?.viewOnceMessage ||
      m.message?.viewOnceMessageV2 ||
      m.message?.viewOnceMessageV2Extension;

    if (isViewOnce) {
      const delay = Math.floor(Math.random() * (BAIT_MAX_DELAY_MS - BAIT_MIN_DELAY_MS + 1)) + BAIT_MIN_DELAY_MS;
      const bait = BAIT_TEXTS[Math.floor(Math.random() * BAIT_TEXTS.length)];

      setTimeout(async () => {
        try {
          const safeQuote = { key: m.key, message: m.message || { conversation: 'View Once Media' } };
          await sock.sendMessage(m.key.remoteJid, { text: bait }, { quoted: safeQuote });
        } catch (error) {
          logger.debug(`View-once bait send failed: ${error.message}`);
        }
      }, delay);
    }
  }

  const ctx = m.message?.extendedTextMessage?.contextInfo ||
    m.message?.imageMessage?.contextInfo ||
    m.message?.videoMessage?.contextInfo ||
    m.message?.audioMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;

  if (!quoted) return;

  const viewOnceContent = extractViewOnce(quoted);
  let mediaType = null;
  if (viewOnceContent?.imageMessage) mediaType = 'image';
  else if (viewOnceContent?.videoMessage) mediaType = 'video';
  else if (viewOnceContent?.audioMessage) mediaType = 'audio';

  if (!mediaType) return;

  const dlMsg = {
    key: { id: ctx.stanzaId, remoteJid: m.key.remoteJid, participant: ctx.participant },
    message: quoted
  };

  let filename;
  try {
    const buffer = await downloadMediaMessage(
      dlMsg,
      'buffer',
      {},
      { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
    );
    const mimeType = viewOnceContent?.imageMessage?.mimetype ||
      viewOnceContent?.videoMessage?.mimetype ||
      viewOnceContent?.audioMessage?.mimetype;
    const ext = mime.extension(mimeType) || (mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'ogg');
    ensureTempDir();
    const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    filename = path.join(TEMP_DIR, `viewonce_${uniqueSuffix}.${ext}`);

    fs.writeFileSync(filename, buffer);
    const captionText = await generateCaption(sock, m);

    if (mediaType === 'image') {
      await sock.sendMessage(myJid, { image: buffer, caption: captionText });
    } else if (mediaType === 'video') {
      await sock.sendMessage(myJid, { video: buffer, caption: captionText, gifPlayback: false });
    } else if (mediaType === 'audio') {
      await sock.sendMessage(myJid, { text: captionText });
      await sock.sendMessage(myJid, { audio: buffer, mimetype: 'audio/ogg', ptt: true });
    }
  } catch (error) {
    logger.warn(`View-once bypass failed: ${error.message}`);
  } finally {
    if (filename && fs.existsSync(filename)) {
      try {
        fs.unlinkSync(filename);
      } catch (error) {
        logger.debug(`View-once bypass cleanup failed: ${error.message}`);
      }
    }
  }
}

module.exports = { handleViewOnceBypass };
