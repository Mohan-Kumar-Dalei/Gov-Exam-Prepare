const ok = (res, data = null, message = 'OK', meta = undefined) =>
  res.status(200).json({ success: true, message, data, ...(meta ? { meta } : {}) });

const created = (res, data = null, message = 'Created') =>
  res.status(201).json({ success: true, message, data });

const noContent = (res) => res.status(204).send();

module.exports = { ok, created, noContent };
