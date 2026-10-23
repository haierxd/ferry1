'use strict';
const express = require('express');

function createConversationsRouter({ pool }) {
  const router = express.Router();
  const detailColumns = 'CAST(id AS CHAR) AS id, title, question, answer, model, tokens, UNIX_TIMESTAMP(created_at) AS created_at';
  const serialize = row => ({ ...row, created_at: new Date(Number(row.created_at) * 1000).toISOString() });
  function badRequest(res, message) {
    return res.status(400).json({ message, code: 'invalid_input' });
  }
  function validId(id) {
    return typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
  }
  async function checkOwner(req, res) {
    if (!validId(req.params.id)) { badRequest(res, '会话编号无效。'); return false; }
    const [rows] = await pool.execute('SELECT user_id FROM conversations WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ message: '会话不存在。', code: 'not_found' }); return false; }
    if (String(rows[0].user_id) !== req.userId) {
      res.status(403).json({ message: '无权访问此会话。', code: 'forbidden' }); return false;
    }
    return true;
  }

  router.post('/', async (req, res) => {
    const body = req.body || {};
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const answer = typeof body.answer === 'string' ? body.answer : '';
    const model = body.model == null ? null : typeof body.model === 'string' ? body.model.trim() : undefined;
    if (!question || Buffer.byteLength(question, 'utf8') > 65535) return badRequest(res, '问题不能为空，且不能超过 65535 字节。');
    if (!answer.trim() || Buffer.byteLength(answer, 'utf8') > 900000) return badRequest(res, '回答不能为空，且不能超过 900000 字节。');
    if (model === undefined || (model && Array.from(model).length > 100)) return badRequest(res, '模型名称不能超过 100 字符。');
    const title = Array.from(question).slice(0, 30).join('');
    // Ownership always comes from verified JWT middleware. Ignore any body.user_id.
    const [result] = await pool.execute('INSERT INTO conversations (user_id, title, question, answer, model) VALUES (?, ?, ?, ?, ?)',
      [req.userId, title, question, answer, model || null]);
    res.status(201).json({ message: '会话已保存。', conversation: { id: String(result.insertId), title } });
  });

  router.get('/', async (req, res) => {
    const rawLimit = req.query.limit ?? '20';
    const rawOffset = req.query.offset ?? '0';
    if (typeof rawLimit !== 'string' || typeof rawOffset !== 'string' || !/^\d{1,3}$/.test(rawLimit) || !/^\d{1,10}$/.test(rawOffset)) {
      return badRequest(res, '分页参数无效。');
    }
    const limit = Number(rawLimit); const offset = Number(rawOffset);
    if (limit < 1 || limit > 100 || offset > 2147483647) return badRequest(res, 'limit 需为 1–100，offset 需为有效的非负整数。');
    const [rows] = await pool.execute('SELECT CAST(id AS CHAR) AS id, title, LEFT(question, 100) AS question, UNIX_TIMESTAMP(created_at) AS created_at FROM conversations WHERE user_id = ? ORDER BY conversations.created_at DESC, conversations.id DESC LIMIT ? OFFSET ?',
      [req.userId, limit + 1, offset]);
    res.json({ items: rows.slice(0, limit).map(serialize), limit, offset, has_more: rows.length > limit });
  });

  router.get('/:id', async (req, res) => {
    if (!await checkOwner(req, res)) return;
    const [rows] = await pool.execute(`SELECT ${detailColumns} FROM conversations WHERE id = ? AND user_id = ? LIMIT 1`, [req.params.id, req.userId]);
    if (!rows[0]) return res.status(404).json({ message: '会话不存在。', code: 'not_found' });
    res.json({ conversation: serialize(rows[0]) });
  });

  router.delete('/:id', async (req, res) => {
    if (!await checkOwner(req, res)) return;
    const [result] = await pool.execute('DELETE FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!result.affectedRows) return res.status(404).json({ message: '会话不存在。', code: 'not_found' });
    res.json({ message: '会话已删除。', id: req.params.id });
  });
  return router;
}
module.exports = { createConversationsRouter };
