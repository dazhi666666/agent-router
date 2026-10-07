// 附件存储：dsh 作曲器上传的图片/文件落到 dataDir/attachments/，
// 消息里的图片以 attachment 引用块下发（客户端凭 attachmentId 走 session/attachment 取回字节），
// 文件则以「已保存到磁盘路径」的注记随消息正文发给 CLI。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJson } from './sessions.mjs';

// 图片媒体类型嗅探 + 尺寸探测（PNG/GIF/JPEG/WebP），session/attachment 的 schema 只收这四种
function probeImage(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n') {
    return { mediaType: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) {
    return { mediaType: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off += 1; continue; }
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mediaType: 'image/jpeg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
    return { mediaType: 'image/jpeg', width: 0, height: 0 };
  }
  if (buf.length >= 16 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mediaType: 'image/webp', width: 0, height: 0 };
  }
  return null;
}

export class Attachments {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'attachments');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  /** 保存一份上传内容，返回 fileUploads/upload 形状的回执与（图片才有的）尺寸信息 */
  save(buf, name = 'file') {
    const attachmentId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    const safeName = String(name).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120) || 'file';
    const file = path.join(this.dir, `${attachmentId}-${safeName}`);
    fs.writeFileSync(file, buf);
    const image = probeImage(buf);
    const meta = {
      attachmentId, receiptId, name: safeName, bytes: buf.length, file,
      mediaType: image?.mediaType || 'application/octet-stream',
      width: image?.width || 0, height: image?.height || 0,
    };
    writeJson(path.join(this.dir, `${attachmentId}.json`), meta);
    return meta;
  }
  byReceipt(receiptId) {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        const meta = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        if (meta.receiptId === receiptId) return meta;
      }
    } catch {}
    return null;
  }
  get(attachmentId) {
    if (!/^[a-f0-9-]{36}$/.test(String(attachmentId))) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(this.dir, `${attachmentId}.json`), 'utf8'));
      return { meta, buf: fs.readFileSync(meta.file) };
    } catch { return null; }
  }
}
